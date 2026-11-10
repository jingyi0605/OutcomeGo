import { expect, test } from "bun:test";
import { Schema } from "effect";
import { UpdateNotificationPresenceInput } from "../src";
import {
  notificationPresenceLifetime,
  suppressMobileNotification,
} from "../src/notification-presence";

const input = {
  clientId: crypto.randomUUID(),
  sequence: 1,
  platform: "macos" as const,
  active: true,
};
test("Mac system idle cutoff and disconnected-client expiry are separate limits", () => {
  expect(notificationPresenceLifetime({ ...input, idleSeconds: 0 })).toBe(60_000);
  expect(notificationPresenceLifetime({ ...input, idleSeconds: 240 })).toBe(60_000);
  expect(notificationPresenceLifetime({ ...input, idleSeconds: 299 })).toBe(1_000);
  expect(notificationPresenceLifetime({ ...input, idleSeconds: 300 })).toBe(0);
  expect(notificationPresenceLifetime(input)).toBe(0);
  expect(notificationPresenceLifetime({ ...input, active: false, idleSeconds: 0 })).toBe(0);
  expect(notificationPresenceLifetime({ ...input, platform: "ios" })).toBe(60_000);
  expect(notificationPresenceLifetime({ ...input, platform: "windows", idleSeconds: 0 })).toBe(60_000);
  expect(notificationPresenceLifetime({ ...input, platform: "android" })).toBe(60_000);
});
test("foreground mobile clients win simultaneous activity; preference and expiry restore delivery", () => {
  const routing = {
    smartEnabled: true,
    serverTime: 10_000,
    macActiveUntil: 70_000,
    windowsActiveUntil: 0,
    iosActiveUntil: 0,
    androidActiveUntil: 0,
  };
  expect(suppressMobileNotification(routing, "ios")).toBeTrue();
  expect(suppressMobileNotification(routing, "android")).toBeTrue();
  expect(suppressMobileNotification({ ...routing, iosActiveUntil: 70_000 }, "ios")).toBeFalse();
  expect(suppressMobileNotification({ ...routing, androidActiveUntil: 70_000 }, "android")).toBeFalse();
  expect(suppressMobileNotification({ ...routing, windowsActiveUntil: 80_000 }, "ios")).toBeTrue();
  expect(suppressMobileNotification(routing, "ios", 70_000)).toBeFalse();
  expect(suppressMobileNotification({ ...routing, smartEnabled: false }, "ios")).toBeFalse();
});
test("presence API rejects invalid IDs, platforms, ordering and idle values", () => {
  const parse = Schema.decodeUnknownSync(UpdateNotificationPresenceInput);
  expect(parse(input)).toEqual(input);
  for (const patch of [
    { clientId: "x" },
    { platform: "linux" },
    { active: "true" },
    { sequence: -1 },
    { sequence: 1.5 },
    { sequence: 2_147_483_648 },
    { idleSeconds: -1 },
    { idleSeconds: Infinity },
    { idleSeconds: NaN },
  ]) {
    expect(() => parse({ ...input, ...patch })).toThrow();
  }
});
