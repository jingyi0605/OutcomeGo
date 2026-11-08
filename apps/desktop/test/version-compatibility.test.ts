import { describe, expect, test } from "bun:test";
import {
  compareAiTeamOSVersions,
  defaultAiTeamOSCompatibilityWindow,
  isAiTeamOSVersion,
  normalizeAiTeamOSVersion,
  aiTeamOSCompatibility,
} from "@aiteamos/contracts/version-compatibility";

describe("aiTeamOS release compatibility", () => {
  test("blocks incompatible lines while allowing patch-skewed releases", () => {
    expect(aiTeamOSCompatibility("1.3.0", "1.2.0")).toBe("server-update-required");
    expect(aiTeamOSCompatibility("1.2.0", "1.3.0")).toBe("client-update-required");
    expect(aiTeamOSCompatibility("1.3.0", "1.3.0")).toBe("compatible");
    expect(aiTeamOSCompatibility("1.3.1", "1.3.0")).toBe("update-recommended");
    expect(aiTeamOSCompatibility("1.3.0", "1.3.1")).toBe("update-recommended");
    expect(aiTeamOSCompatibility("1.3.0", "1.3.0", null)).toBe("unknown");
    expect(aiTeamOSCompatibility("1.3.0", "1.3.0", 3)).toBe("client-update-required");
    expect(aiTeamOSCompatibility("1.3.0", "1.3.0", 0)).toBe("server-update-required");
  });

  test("honors a server-provided overlapping compatibility window", () => {
    expect(
      aiTeamOSCompatibility("1.3.9", "1.4.0", 2, {
        minimumClientVersion: "1.3.0",
        maximumClientVersionExclusive: "1.5.0",
      })
    ).toBe("update-recommended");
  });

  test("compares prereleases without accepting arbitrary update targets", () => {
    expect(compareAiTeamOSVersions("2.0.0", "2.0.0-rc.1")).toBe(1);
    expect(compareAiTeamOSVersions("2.0.0-rc.2", "2.0.0-rc.1")).toBeGreaterThan(0);
    expect(isAiTeamOSVersion("latest")).toBe(false);
  });

  test("implements strict SemVer normalization without the full parser dependency", () => {
    expect(normalizeAiTeamOSVersion(" v1.2.3+desktop.7 ")).toBe("1.2.3");
    expect(normalizeAiTeamOSVersion("1.2.3-rc.01")).toBeNull();
    expect(normalizeAiTeamOSVersion("01.2.3")).toBeNull();
    expect(normalizeAiTeamOSVersion("9007199254740992.0.0")).toBeNull();
    expect(defaultAiTeamOSCompatibilityWindow("2.9.4-rc.1")).toEqual({
      minimum: "2.9.0",
      maximumExclusive: "2.10.0",
    });

    const precedence = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let index = 1; index < precedence.length; index += 1) {
      expect(compareAiTeamOSVersions(precedence[index - 1] ?? "", precedence[index] ?? "")).toBe(
        -1
      );
    }
  });
});
