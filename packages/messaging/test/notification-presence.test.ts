import { expect, test } from "bun:test";
import { notificationRouting } from "../src/notification-presence";

test("aggregates the latest active lease for every desktop and mobile platform", async () => {
  const routing = await notificationRouting(
    {
      notificationPreferences: {
        findUnique: async () => ({ smartEnabled: true }),
      },
      notificationPresence: {
        findMany: async () => [
          { platform: "macos", expiresAt: new Date(2_000) },
          { platform: "windows", expiresAt: new Date(3_000) },
          { platform: "ios", expiresAt: new Date(2_500) },
          { platform: "ios", expiresAt: new Date(4_000) },
          { platform: "android", expiresAt: new Date(3_500) },
          { platform: "android", expiresAt: new Date(4_500) },
        ],
      },
    } as never,
    "disabled",
    new Date(1_000)
  );

  expect(routing).toEqual({
    smartEnabled: true,
    serverTime: 1_000,
    iosActiveUntil: 4_000,
    androidActiveUntil: 4_500,
    macActiveUntil: 2_000,
    windowsActiveUntil: 3_000,
  });
});
