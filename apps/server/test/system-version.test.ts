import { describe, expect, test } from "bun:test";
import { AITEAMOS_API_PROTOCOL_VERSION, systemVersion } from "../src/system-version";

describe("system version metadata", () => {
  test("allows compatible patch clients in the same release line by default", () => {
    expect(systemVersion({ AITEAMOS_VERSION: "1.4.2" })).toEqual({
      releaseVersion: "1.4.2",
      apiProtocolVersion: AITEAMOS_API_PROTOCOL_VERSION,
      minimumClientVersion: "1.4.0-0",
      maximumClientVersionExclusive: "1.5.0-0",
      recommendedClientVersion: "1.4.2",
      updateChannel: "stable",
    });
  });

  test("a prerelease server accepts clients of its own prerelease line", () => {
    const view = systemVersion({ AITEAMOS_VERSION: "0.1.0-beta.1" });
    expect(view.minimumClientVersion).toBe("0.1.0-0");
    expect(view.maximumClientVersionExclusive).toBe("0.2.0-0");
    expect(view.recommendedClientVersion).toBe("0.1.0-beta.1");
  });

  test("accepts explicit compatibility boundaries and rejects malformed values", () => {
    expect(
      systemVersion({
        AITEAMOS_VERSION: "2.0.0",
        AITEAMOS_MIN_CLIENT_VERSION: "1.9.0",
        AITEAMOS_MAX_CLIENT_VERSION_EXCLUSIVE: "2.1.0",
        AITEAMOS_RECOMMENDED_CLIENT_VERSION: "2.0.0",
        AITEAMOS_UPDATE_CHANNEL: "beta",
      })
    ).toMatchObject({
      minimumClientVersion: "1.9.0",
      maximumClientVersionExclusive: "2.1.0",
      recommendedClientVersion: "2.0.0",
      updateChannel: "beta",
    });
    expect(systemVersion({ AITEAMOS_VERSION: "latest" }).releaseVersion).toBe("0.0.0");
  });
});
