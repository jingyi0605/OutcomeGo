import { describe, expect, test } from "bun:test";
import { channelReadTarget, newestSequence } from "../src/renderer/lib/channel-read-target";

const transcript = [
  { id: "m1", sequence: "1" },
  { id: "m2", sequence: "2" },
  { id: "m3", sequence: "3" },
];
const base = {
  channelKind: "bot_dm",
  search: undefined,
  transcript,
  newestKnown: "5",
  lastReadNotificationSequence: "10",
  notificationCursor: "20",
};

describe("how far a visit marks a channel read", () => {
  test("a Bot chat is read through its newest known message, past a transcript that is behind", () => {
    expect(channelReadTarget(base)).toEqual({
      throughSequence: "5",
      throughNotificationSequence: "20",
    });
  });

  test("a notification that names an older message still reads a Bot chat to the newest", () => {
    const target = channelReadTarget({
      ...base,
      search: { messageId: "m2", readThroughSequence: "2", fromNotification: true },
    });
    expect(target).toEqual({ throughSequence: "5", throughNotificationSequence: "20" });
  });

  test("a legacy notification without a sequence is treated the same way", () => {
    const target = channelReadTarget({
      ...base,
      search: { messageId: "m2", fromNotification: true },
    });
    expect(target).toEqual({ throughSequence: "5", throughNotificationSequence: "20" });
  });

  test("a search jump into older history keeps what came after unread", () => {
    const target = channelReadTarget({ ...base, search: { messageId: "m2" } });
    expect(target).toEqual({ throughSequence: "2", throughNotificationSequence: "10" });
  });

  test("a group chat opened from a notification stops at the announced message", () => {
    const target = channelReadTarget({
      ...base,
      channelKind: "group",
      search: { messageId: "m2", readThroughSequence: "2", fromNotification: true },
    });
    expect(target).toEqual({ throughSequence: "2", throughNotificationSequence: "10" });
  });

  test("a group chat entered normally is read through the transcript's last message", () => {
    expect(channelReadTarget({ ...base, channelKind: "group" })).toEqual({
      throughSequence: "3",
      throughNotificationSequence: "20",
    });
  });

  test("the newest known message is the highest sequence, not the last one in the list", () => {
    expect(newestSequence([{ sequence: "180" }, { sequence: "45" }, { sequence: "9" }])).toBe("180");
    expect(newestSequence([{ sequence: "9" }, { sequence: "100" }, { sequence: "45" }])).toBe("100");
    expect(newestSequence([{ sequence: null }, { sequence: "x" }, {}])).toBeUndefined();
    expect(newestSequence(undefined)).toBeUndefined();
  });

  test("falls back to the transcript when the snapshot has no newest message", () => {
    expect(channelReadTarget({ ...base, newestKnown: undefined })?.throughSequence).toBe("3");
  });

  test("marks nothing when no message is known", () => {
    expect(channelReadTarget({ ...base, transcript: [], newestKnown: undefined })).toBeNull();
    expect(channelReadTarget({ ...base, newestKnown: "not-a-number", transcript: [] })).toBeNull();
  });
});
