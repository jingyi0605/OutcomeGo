import { expect, test } from "bun:test";
import { Schema } from "effect";
import { SendMessageInput } from "../src";
import {
  DeviceLocation,
  LocationSubmission,
  UpdateLocationSharingInput,
  userLocationEnabled,
  userLocationToolResult,
} from "../src/user-location";

const fix = {
  latitude: 1.3,
  longitude: 103.8,
  accuracyMeters: 12.5,
  capturedAt: "2026-11-17T01:00:00Z",
  device: "phone" as const,
};

test("location is optional and does not replace existing durable message fields", () => {
  const decode = Schema.decodeUnknownSync(SendMessageInput);
  const old = {
    content: "near me",
    clientId: "location-test-client",
    richText: "near me",
    isFork: true,
    replyToMessageId: "existing-reply",
  };
  expect(decode(old)).toEqual(old);
  expect(
    decode({ ...old, location: { fix, sharingRevision: crypto.randomUUID() } }).location?.fix
  ).toEqual(fix);
  expect(() =>
    decode({ content: "near me", location: { fix, sharingRevision: crypto.randomUUID() } })
  ).toThrow();
});

test("fixes and revisions reject invalid coordinates, dates, precision and ownership shortcuts", () => {
  const decode = Schema.decodeUnknownSync(DeviceLocation);
  for (const patch of [
    { latitude: 91 },
    { latitude: NaN },
    { longitude: Infinity },
    { accuracyMeters: -1 },
    { capturedAt: "yesterday" },
    { capturedAt: "2026-11-17" },
    { device: "watch" },
  ])
    expect(() => decode({ ...fix, ...patch })).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LocationSubmission)({ fix, sharingRevision: "global" })
  ).toThrow();
  expect(() => Schema.decodeUnknownSync(UpdateLocationSharingInput)({ enabled: true })).toThrow();
  expect(
    Schema.decodeUnknownSync(LocationSubmission)({
      fix,
      sharingRevision: crypto.randomUUID(),
      ownerKey: "user:other",
    })
  ).not.toHaveProperty("ownerKey");
});

test("tool results distinguish a missing fix, clamp age and preserve optional accuracy", () => {
  expect(userLocationToolResult(null)).toMatchObject({ available: false });
  const stored = { ...fix, accuracyMeters: null, capturedAt: new Date(fix.capturedAt) };
  expect(userLocationToolResult(stored, new Date("2026-11-17T01:30:00Z"))).toEqual({
    ...fix,
    accuracyMeters: undefined,
    capturedAt: stored.capturedAt.toISOString(),
    ageMinutes: 30,
  });
  expect(userLocationToolResult(stored, new Date("2026-11-17T00:00:00Z"))).toMatchObject({
    ageMinutes: 0,
  });
});

test("the backend feature is opt-in and defaults off", () => {
  for (const value of [undefined, "", "0", "false", "true"])
    expect(userLocationEnabled(value)).toBe(false);
  expect(userLocationEnabled("1")).toBe(true);
});
