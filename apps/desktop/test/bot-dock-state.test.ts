import { describe, expect, test } from "bun:test";
import type { ClientSnapshot } from "@outcomego/contracts";
import { countByBot } from "../src/renderer/lib/outcome-counts";
import { deriveBotDockEntries } from "../src/renderer/lib/bot-dock-state";

const state = (channelId: string) => ({
  channelId,
  lastReadSequence: "0",
  lastReadNotificationSequence: "0",
  notificationCursor: "0",
  activityUnreadCount: 0,
  notifications: [],
});
const bot = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: id,
  color: "#fff",
  icon: "round",
  status: "ready",
  notificationsEnabled: true,
  hasAvatar: false,
  updatedAt: "2026-01-01T00:00:00Z",
  dmChannelId: `dm-${id}`,
  ...overrides,
});
const channel = (
  botId: string,
  unreadCount: number,
  updatedAt = "2026-01-01T00:00:00Z",
  overrides: Record<string, unknown> = {}
) => ({
  id: `dm-${botId}`,
  kind: "bot_dm",
  members: [{ botId }],
  unreadCount,
  updatedAt,
  notificationState: state(`dm-${botId}`),
  ...overrides,
});
const snapshot = (bots: unknown[], channels: unknown[]) =>
  ({ cursor: "1", bots, channels, channelMessages: [], runs: [] }) as unknown as ClientSnapshot;

describe("Bot dock entries", () => {
  test("lists only Bots with unread messages or goals waiting, with both counts", () => {
    const entries = deriveBotDockEntries(
      snapshot([bot("a"), bot("b"), bot("c")], [channel("a", 3), channel("b", 0), channel("c", 0)]),
      { a: 1, c: 2 }
    );
    expect(entries.map(({ id, messages, goals }) => [id, messages, goals])).toEqual([
      ["a", 3, 1],
      ["c", 0, 2],
    ]);
  });

  test("puts the Bot whose chat was most recently active first", () => {
    const entries = deriveBotDockEntries(
      snapshot(
        [bot("old"), bot("new")],
        [channel("old", 1, "2026-01-01T00:00:00Z"), channel("new", 1, "2026-02-01T00:00:00Z")]
      )
    );
    expect(entries.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  test("uses attention counts and orders by the qualifying reply instead of later progress", () => {
    const focusedChannel = (id: string, unreadCount: number, createdAt?: string) =>
      channel(id, 100, "2026-03-01T00:00:00Z", {
        notificationState: {
          ...state(`dm-${id}`),
          botDock: {
            unreadCount,
            latest: createdAt ? { notificationSequence: "1", messageSequence: "1", createdAt } : null,
          },
        },
      });
    const entries = deriveBotDockEntries(snapshot(
      [bot("a"), bot("b"), bot("progress")],
      [focusedChannel("a", 2, "2026-01-01T00:00:00Z"),
        focusedChannel("b", 1, "2026-02-01T00:00:00Z"), focusedChannel("progress", 0)]
    ));
    expect(entries.map(({ id, messages }) => [id, messages])).toEqual([["b", 1], ["a", 2]]);
  });

  test("leaves muted and unavailable Bots' messages out, as the Dock badge does", () => {
    const entries = deriveBotDockEntries(
      snapshot(
        [
          bot("muted", { notificationsEnabled: false }),
          bot("gone", { status: "archived" }),
          bot("quiet"),
        ],
        [
          channel("muted", 4),
          channel("gone", 4),
          channel("quiet", 4, undefined, { notificationsMuted: true }),
        ]
      )
    );
    expect(entries).toEqual([]);
  });

  test("a muted Bot still shows its goals waiting", () => {
    const entries = deriveBotDockEntries(
      snapshot([bot("muted", { notificationsEnabled: false })], [channel("muted", 4)]),
      { muted: 2 }
    );
    expect(entries.map(({ messages, goals }) => [messages, goals])).toEqual([[0, 2]]);
  });

  test("is empty before the first snapshot", () => {
    expect(deriveBotDockEntries(null, { a: 1 })).toEqual([]);
    expect(deriveBotDockEntries(undefined)).toEqual([]);
  });

  test("counts goals per Bot", () => {
    expect(countByBot([{ botId: "a" }, { botId: "b" }, { botId: "a" }])).toEqual({ a: 2, b: 1 });
    expect(countByBot([])).toEqual({});
  });
});
