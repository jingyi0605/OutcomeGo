import { describe, expect, test } from "bun:test";
import { prepareMessageMarkdown } from "../../src/renderer/components/ai-elements/message-response/markdown-source";

describe("aiTeamOS in-app links", () => {
  test("preserves source-compatible settings and plugin links for safe in-app routing", () => {
    expect(
      prepareMessageMarkdown(
        "Open [Update Track](aiteamos://app/v1/settings?id=update-channel) or [Plugins](aiteamos://app/v1/plugin/add?id=calendar)."
      )
    ).toBe(
      "Open [Update Track](streamdown:aiteamos://app/v1/settings?id=update-channel) or [Plugins](streamdown:aiteamos://app/v1/plugin/add?id=calendar)."
    );
  });
});
