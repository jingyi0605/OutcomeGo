import { describe, expect, test } from "bun:test";
import {
  parseOutcomeGoDeepLink,
  SETTINGS_ANCHORS,
  settingsViewForAnchor,
} from "../src/renderer/lib/app-deep-links";

describe("OutcomeGo deep-link routing parity", () => {
  test("accepts every documented settings anchor and resolves its exact panel", () => {
    for (const anchor of SETTINGS_ANCHORS) {
      const parsed = parseOutcomeGoDeepLink(`outcomego://app/v1/settings?id=${anchor}`);
      expect(parsed).toEqual({ kind: "settings", anchor });
      if (parsed?.kind === "settings") expect(settingsViewForAnchor(parsed.anchor)).toBeString();
    }
    expect(settingsViewForAnchor("update-status")).toBe("updates");
    expect(settingsViewForAnchor("server-update")).toBe("updates");
    expect(settingsViewForAnchor("browser-network")).toBe("server");
    expect(parseOutcomeGoDeepLink("outcomego://app/v1/settings?id=local-execution")).toBeNull();
    for (const anchor of [
      "inference-provider",
      "inference-model",
      "inference-reasoning",
    ] as const) {
      expect(settingsViewForAnchor(anchor)).toBe("model");
    }
    expect(settingsViewForAnchor("web-search-provider")).toBe("providers");
    expect(settingsViewForAnchor("web-fetch-provider")).toBe("providers");
  });

  test("preserves the stable plugin id and rejects malformed or unsupported links", () => {
    expect(parseOutcomeGoDeepLink("outcomego://app/v1/plugin/add?id=google-calendar")).toEqual({
      kind: "plugin",
      pluginId: "google-calendar",
    });
    expect(parseOutcomeGoDeepLink("outcomego://app/v1/settings?id=not-a-real-anchor")).toBeNull();
    expect(parseOutcomeGoDeepLink("outcomego://app/v1/settings?id=plan")).toBeNull();
    expect(parseOutcomeGoDeepLink("outcomego://app/v1/settings?id=update-channel")).toBeNull();
    expect(parseOutcomeGoDeepLink("https://app/v1/settings?id=theme")).toBeNull();
    expect(parseOutcomeGoDeepLink("outcomego://app/v1/plugin/add?id=")).toBeNull();
  });

  test("rejects retired shared bot template links", () => {
    const template = {
      name: "Research Bot",
      title: "research",
      description: "Finds primary sources.",
      instructions: "Cite every claim.",
      icon: "leaf",
      color: "#10b981",
      notificationsEnabled: true,
    };

    const data = Buffer.from(
      JSON.stringify({ format: "outcomego.bot-template", version: 1, bot: template })
    ).toString("base64url");

    expect(parseOutcomeGoDeepLink(`outcomego://app/v1/template/add?data=${data}`)).toBeNull();
    expect(parseOutcomeGoDeepLink("outcomego://app/v1/template/add?data=broken")).toBeNull();
  });
});
