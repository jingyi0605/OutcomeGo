import { describe, expect, test } from "bun:test";
import {
  BOT_DOCK_MAX_ATTACHMENTS,
  BOT_DOCK_MAX_BOTS,
  BOT_DOCK_MAX_MESSAGE,
  BOT_DOCK_MAX_ROSTER,
  BOT_DOCK_SIZE_LIMITS,
  DEFAULT_BOT_DOCK_SETTINGS,
  botDockOpenTarget,
  clampDockSize,
  clampToWorkArea,
  defaultDockPosition,
  dockAnchorFor,
  isSnoozed,
  parseBotDockMessage,
  parseBotDockSettings,
  parseBotDockState,
  placeDockComposer,
  resizeDock,
  sniffImageMime,
  snoozeDeadline,
} from "../src/main/bot-dock-model";

const bot = (overrides: Record<string, unknown> = {}) => ({
  id: "bot-1",
  name: "Probe",
  color: "#22a99d",
  icon: "round",
  channelId: "channel-1",
  messages: 2,
  goals: 0,
  ...overrides,
});
const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe("Bot dock state", () => {
  test("keeps the fields the dock renders and fills in default labels", () => {
    const state = parseBotDockState({ bots: [bot({ goals: 3 })], theme: "dark", extra: "ignored" });
    expect(state).toEqual({
      bots: [bot({ goals: 3 })],
      roster: [],
      labels: expect.objectContaining({
        messages: "Unread messages",
        goals: "Pending action",
        open: "Open OutcomeGo",
      }),
      theme: "dark",
    });
  });

  test("null means nothing to show, and an invalid payload is rejected rather than blanking the dock", () => {
    expect(parseBotDockState(null)).toBeNull();
    expect(parseBotDockState("nope")).toBeUndefined();
    expect(parseBotDockState({ bots: "nope" })).toBeUndefined();
    expect(parseBotDockState({ bots: [bot({ messages: -1 })] })).toBeUndefined();
    expect(parseBotDockState({ bots: [bot({ messages: 1.5 })] })).toBeUndefined();
    expect(parseBotDockState({ bots: [bot({ id: "" })] })).toBeUndefined();
    expect(
      parseBotDockState({ bots: Array.from({ length: BOT_DOCK_MAX_BOTS + 1 }, () => bot()) })
    ).toBeUndefined();
  });

  test("drops a Bot with nothing waiting", () => {
    const state = parseBotDockState({
      bots: [bot({ messages: 0, goals: 0 }), bot({ id: "two", messages: 0, goals: 1 })],
    });
    expect(state?.bots.map((entry) => entry.id)).toEqual(["two"]);
  });

  test("accepts only image data URLs as avatars", () => {
    const image = "data:image/png;base64,AAAA";
    expect(
      parseBotDockState({ bots: [bot({ avatarDataUrl: image })] })?.bots[0]?.avatarDataUrl
    ).toBe(image);
    expect(
      parseBotDockState({ bots: [bot({ avatarDataUrl: "https://example.com/a.png" })] })?.bots[0]
    ).not.toHaveProperty("avatarDataUrl");
    expect(
      parseBotDockState({ bots: [bot({ avatarDataUrl: "data:text/html,<script>" })] })?.bots[0]
    ).not.toHaveProperty("avatarDataUrl");
  });

  test("a click opens the chat when messages wait, otherwise the goals", () => {
    expect(botDockOpenTarget({ ...bot(), messages: 1, goals: 2 } as never)).toEqual({
      kind: "chat",
      channelId: "channel-1",
    });
    expect(botDockOpenTarget({ ...bot(), messages: 0, goals: 2 } as never)).toEqual({
      kind: "goals",
    });
  });
});

describe("Bot dock placement", () => {
  test("clamps the size the page asks for", () => {
    expect(clampDockSize(120.2, 60.1)).toEqual({ width: 121, height: 61 });
    expect(clampDockSize(1, 1)).toEqual({
      width: BOT_DOCK_SIZE_LIMITS.minWidth,
      height: BOT_DOCK_SIZE_LIMITS.minHeight,
    });
    expect(clampDockSize(99_999, 99_999)).toEqual({
      width: BOT_DOCK_SIZE_LIMITS.maxWidth,
      height: BOT_DOCK_SIZE_LIMITS.maxHeight,
    });
    expect(clampDockSize(Number.NaN, 10)).toBeNull();
    expect(clampDockSize("120", 60)).toBeNull();
  });

  test("keeps the window inside the work area, below the menu bar", () => {
    expect(clampToWorkArea({ x: -50, y: 0, width: 200, height: 70 }, workArea)).toMatchObject({
      x: 0,
      y: 25,
    });
    expect(clampToWorkArea({ x: 5000, y: 5000, width: 200, height: 70 }, workArea)).toMatchObject({
      x: 1240,
      y: 830,
    });
    expect(clampToWorkArea({ x: 100, y: 100, width: 200, height: 70 }, workArea)).toMatchObject({
      x: 100,
      y: 100,
    });
  });

  test("starts in the bottom-right corner", () => {
    const rect = defaultDockPosition({ width: 100, height: 70 }, workArea);
    expect(rect.x + rect.width).toBeLessThan(workArea.x + workArea.width);
    expect(rect.y + rect.height).toBeLessThan(workArea.y + workArea.height);
    expect(rect.x).toBeGreaterThan(workArea.width / 2);
    expect(rect.y).toBeGreaterThan(workArea.height / 2);
  });

  test("grows away from the nearer screen edge", () => {
    const left = resizeDock(
      { x: 100, y: 200, width: 100, height: 70 },
      { width: 220, height: 70 },
      workArea
    );
    expect(left).toMatchObject({ x: 100, width: 220 });
    const right = resizeDock(
      { x: 1300, y: 200, width: 100, height: 70 },
      { width: 220, height: 70 },
      workArea
    );
    expect(right.x + right.width).toBe(1400);
    expect(right.width).toBe(220);
  });

  test("never grows off the screen", () => {
    const rect = resizeDock(
      { x: 1400, y: 200, width: 40, height: 70 },
      { width: 300, height: 70 },
      workArea
    );
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1440);
  });
});

describe("Bot dock settings", () => {
  test("is off by default and keeps a saved position without enabling the dock", () => {
    expect(parseBotDockSettings(undefined)).toEqual({
      enabled: false,
      position: null,
      hiddenUntil: null,
    });
    expect(parseBotDockSettings({ position: { x: 10, y: 20, width: 90 } })).toEqual(
      {
        enabled: false,
        position: { x: 10, y: 20, width: 90 },
        hiddenUntil: null,
      }
    );
  });

  test("restores only an explicit boolean opt-in", () => {
    expect(parseBotDockSettings({ enabled: true }).enabled).toBe(true);
    expect(parseBotDockSettings({ enabled: false }).enabled).toBe(false);
    expect(parseBotDockSettings({ enabled: "true" }).enabled).toBe(false);
  });

  test("ignores a malformed position", () => {
    expect(parseBotDockSettings({ position: { x: "10", y: 20, width: 90 } }).position).toBeNull();
    expect(parseBotDockSettings({ position: { x: 10, y: 20 } }).position).toBeNull();
    expect(parseBotDockSettings({ position: { x: 10, y: 20, width: 0 } }).position).toBeNull();
    expect(
      parseBotDockSettings({ position: { x: Number.POSITIVE_INFINITY, y: 0, width: 90 } }).position
    ).toBeNull();
    expect(parseBotDockSettings({ position: { x: 1e9, y: 0, width: 90 } }).position).toBeNull();
  });
});

describe("Bot dock roster", () => {
  const rosterBot = { id: "a", name: "Aria", color: "#22a99d", icon: "round" };

  test("keeps the Bots a message can go to, in order, with image avatars only", () => {
    const state = parseBotDockState({
      bots: [],
      roster: [
        { ...rosterBot, avatarDataUrl: "data:image/png;base64,AAAA" },
        { ...rosterBot, id: "b", avatarDataUrl: "https://example.com/a.png" },
      ],
    });
    expect(state?.roster.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(state?.roster[0]?.avatarDataUrl).toBe("data:image/png;base64,AAAA");
    expect(state?.roster[1]).not.toHaveProperty("avatarDataUrl");
  });

  test("rejects a malformed or oversized roster", () => {
    expect(parseBotDockState({ bots: [], roster: "nope" })).toBeUndefined();
    expect(parseBotDockState({ bots: [], roster: [{ ...rosterBot, id: "" }] })).toBeUndefined();
    expect(
      parseBotDockState({
        bots: [],
        roster: Array.from({ length: BOT_DOCK_MAX_ROSTER + 1 }, () => rosterBot),
      })
    ).toBeUndefined();
  });
});

describe("Bot dock temporary hide", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 10, 19, hour, minute, 0, 0).getTime();

  test("5, 30 and 60 minutes end that long from now", () => {
    expect(snoozeDeadline("5m", at(10))).toBe(at(10, 5));
    expect(snoozeDeadline("30m", at(10))).toBe(at(10, 30));
    expect(snoozeDeadline("1h", at(10))).toBe(at(11));
  });

  test("today ends at the next local midnight", () => {
    expect(snoozeDeadline("today", at(10))).toBe(new Date(2026, 10, 20, 0, 0, 0, 0).getTime());
    expect(snoozeDeadline("today", at(23, 59))).toBe(new Date(2026, 10, 20, 0, 0, 0, 0).getTime());
  });

  test("is hidden only until the deadline", () => {
    const settings = { ...DEFAULT_BOT_DOCK_SETTINGS, hiddenUntil: at(10, 5) };
    expect(isSnoozed(settings, at(10))).toBe(true);
    expect(isSnoozed(settings, at(10, 5))).toBe(false);
    expect(isSnoozed(DEFAULT_BOT_DOCK_SETTINGS, at(10))).toBe(false);
  });

  test("the deadline is saved, and a malformed one is ignored", () => {
    expect(parseBotDockSettings({ hiddenUntil: 1_800_000_000_000 }).hiddenUntil).toBe(
      1_800_000_000_000
    );
    expect(parseBotDockSettings({ hiddenUntil: "soon" }).hiddenUntil).toBeNull();
    expect(parseBotDockSettings({ hiddenUntil: -5 }).hiddenUntil).toBeNull();
    expect(parseBotDockSettings({ hiddenUntil: Number.NaN }).hiddenUntil).toBeNull();
  });
});

describe("Bot dock composer placement", () => {
  test("the anchor is the side of the screen the window sits on", () => {
    expect(dockAnchorFor({ x: 1300, y: 800, width: 100, height: 60 }, workArea)).toEqual({
      right: true,
      bottom: true,
    });
    expect(dockAnchorFor({ x: 20, y: 40, width: 100, height: 60 }, workArea)).toEqual({
      right: false,
      bottom: false,
    });
  });

  test("places a separate panel above and right-aligned on the lower-right side", () => {
    const capsule = { x: 1300, y: 800, width: 100, height: 60 };
    expect(placeDockComposer(capsule, { width: 356, height: 300 }, workArea)).toEqual({
      x: 1044,
      y: 521,
      width: 356,
      height: 300,
    });
  });

  test("places the panel below and left-aligned on the upper-left side", () => {
    const capsule = { x: 40, y: 40, width: 100, height: 60 };
    expect(placeDockComposer(capsule, { width: 356, height: 300 }, workArea)).toEqual({
      x: 40,
      y: 79,
      width: 356,
      height: 300,
    });
  });

  test("without an anchor the top edge stays put, as before", () => {
    const rect = resizeDock(
      { x: 20, y: 40, width: 100, height: 60 },
      { width: 100, height: 90 },
      workArea
    );
    expect(rect.y).toBe(40);
  });
});

describe("Bot dock message", () => {
  const nonce = "11111111-2222";

  test("accepts a Bot, text and a message id, trimming the text", () => {
    expect(parseBotDockMessage({ botId: "a", content: "  hi\n", nonce })).toEqual({
      botId: "a",
      content: "hi",
      nonce,
      attachments: [],
    });
  });

  test("rejects blank, oversized or malformed messages", () => {
    expect(parseBotDockMessage(null)).toBeNull();
    expect(parseBotDockMessage({ botId: "a", content: "   ", nonce })).toBeNull();
    expect(parseBotDockMessage({ botId: "", content: "hi", nonce })).toBeNull();
    expect(parseBotDockMessage({ botId: "a", content: "hi", nonce: "short" })).toBeNull();
    expect(parseBotDockMessage({ botId: "a", content: "hi", nonce: "x".repeat(121) })).toBeNull();
    expect(
      parseBotDockMessage({ botId: "a", content: "x".repeat(BOT_DOCK_MAX_MESSAGE + 1), nonce })
    ).toBeNull();
    expect(parseBotDockMessage({ botId: "a", content: 5, nonce })).toBeNull();
  });
});

describe("Bot dock pasted images", () => {
  const nonce = "11111111-2222";
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const image = (overrides: Record<string, unknown> = {}) => ({
    bytes: png,
    fileName: "image.png",
    width: 10,
    height: 20,
    ...overrides,
  });

  test("recognises an image by its bytes, not by a claimed type", () => {
    expect(sniffImageMime(png)).toBe("image/png");
    expect(sniffImageMime(jpeg)).toBe("image/jpeg");
    expect(sniffImageMime(gif)).toBe("image/gif");
    expect(sniffImageMime(webp)).toBe("image/webp");
    expect(sniffImageMime(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });

  test("an image alone is a message, and keeps its checked type and size", () => {
    const message = parseBotDockMessage({
      botId: "a",
      content: "  ",
      nonce,
      attachments: [image()],
    });
    expect(message?.content).toBe("");
    expect(message?.attachments).toEqual([
      { bytes: png, fileName: "image.png", mimeType: "image/png", width: 10, height: 20 },
    ]);
  });

  test("accepts bytes that arrive as an ArrayBuffer and names an unnamed image", () => {
    const message = parseBotDockMessage({
      botId: "a",
      content: "look",
      nonce,
      attachments: [image({ bytes: jpeg.buffer, fileName: "" })],
    });
    expect(message?.attachments[0]?.mimeType).toBe("image/jpeg");
    expect(message?.attachments[0]?.fileName).toBe("Image.jpg");
  });

  test("accepts files but rejects invalid bytes and attachment lists", () => {
    const bad = (overrides: Record<string, unknown>) =>
      parseBotDockMessage({ botId: "a", content: "x", nonce, attachments: [image(overrides)] });
    expect(bad({
      bytes: new TextEncoder().encode("not an image"),
      mimeType: "image/png",
    })?.attachments[0]?.mimeType).toBe("application/octet-stream");
    expect(bad({ bytes: new Uint8Array() })).toBeNull();
    expect(bad({ bytes: "AAAA" })).toBeNull();
    expect(bad({ width: 0 })?.attachments[0]?.width).toBeUndefined();
    expect(bad({ height: 1.5 })?.attachments[0]?.height).toBeUndefined();
    expect(bad({ width: 200_000 })?.attachments[0]?.width).toBeUndefined();
    expect(
      parseBotDockMessage({
        botId: "a",
        content: "x",
        nonce,
        attachments: Array.from({ length: BOT_DOCK_MAX_ATTACHMENTS + 1 }, () => image()),
      })
    ).toBeNull();
    expect(parseBotDockMessage({ botId: "a", content: "x", nonce, attachments: "nope" })).toBeNull();
  });
});
