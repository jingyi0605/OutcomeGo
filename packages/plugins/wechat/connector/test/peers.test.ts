import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FALLBACK_DISPLAY_NAME, PeerBook, REPLY_WINDOW_MS } from "../peers";
import { StateStore } from "../state";

let root: string;
let store: StateStore;
let book: PeerBook;
const T0 = new Date("2026-11-16T08:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wechat-peers-"));
  store = new StateStore(join(root, "state"));
  await store.prepare();
  book = new PeerBook(store);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const reload = async () => {
  const fresh = new PeerBook(store);
  await fresh.load();
  return fresh;
};

describe("reply tokens", () => {
  test("the newest token wins and survives a restart", async () => {
    await book.observe({ peerId: "owner", isAccountOwner: true, at: T0, contextToken: "ctx-1" });
    await book.observe({ peerId: "owner", isAccountOwner: true, at: later(60_000), contextToken: "ctx-2" });
    expect((await reload()).replyToken("owner", later(61_000))).toEqual({ token: "ctx-2", receivedAt: later(60_000).toISOString() });
  });

  test("a message without a token does not erase a valid one", async () => {
    await book.observe({ peerId: "owner", isAccountOwner: true, at: T0, contextToken: "ctx-1" });
    await book.observe({ peerId: "owner", isAccountOwner: true, at: later(1000), contextToken: null });
    expect(book.replyToken("owner", later(2000))?.token).toBe("ctx-1");
  });

  test("an older replayed message cannot replace or extend a newer token", async () => {
    await book.observe({ peerId: "owner", isAccountOwner: true, at: later(10_000), contextToken: "newer" });
    await book.observe({ peerId: "owner", isAccountOwner: true, at: T0, contextToken: "older" });
    expect(book.replyToken("owner", later(11_000))).toEqual({ token: "newer", receivedAt: later(10_000).toISOString() });
  });

  test("the window closes one hour before the believed 24-hour lifetime", async () => {
    await book.observe({ peerId: "owner", isAccountOwner: true, at: T0, contextToken: "ctx" });
    expect(REPLY_WINDOW_MS).toBe(23 * 3600_000);
    expect(book.tokenState("owner", later(REPLY_WINDOW_MS - 1))).toBe("usable");
    expect(book.tokenState("owner", later(REPLY_WINDOW_MS))).toBe("expired");
    expect(book.replyToken("owner", later(REPLY_WINDOW_MS))).toBeNull();
  });

  test("an unknown peer has no token", () => {
    expect(book.tokenState("nobody")).toBe("missing");
  });

  test("clearTokens keeps who was seen, invalidateToken drops one", async () => {
    await book.observe({ peerId: "a", isAccountOwner: true, at: T0, contextToken: "ca", displayName: "Alice" });
    await book.observe({ peerId: "b", isAccountOwner: false, at: T0, contextToken: "cb" });
    await book.invalidateToken("b");
    expect(book.tokenState("b", T0)).toBe("missing");
    expect(book.tokenState("a", T0)).toBe("usable");
    await book.clearTokens();
    const fresh = await reload();
    expect(fresh.tokenState("a", T0)).toBe("missing");
    expect(fresh.list({ limit: 10, afterPeerId: null }, true, T0).peers.map((p) => p.peerId)).toEqual(["a", "b"]);
  });

  test("clearAll forgets everyone", async () => {
    await book.observe({ peerId: "a", isAccountOwner: true, at: T0, contextToken: "ca" });
    await book.clearAll();
    expect((await reload()).size).toBe(0);
  });
});

describe("owner window", () => {
  test("reports the owner's latest window only, not another peer's", async () => {
    expect(book.ownerWindow(T0)).toEqual({ open: false, expiresAt: null });
    await book.observe({ peerId: "stranger", isAccountOwner: false, at: later(5000), contextToken: "x" });
    expect(book.ownerWindow(later(6000)).open).toBe(false);
    await book.observe({ peerId: "owner", isAccountOwner: true, at: T0, contextToken: "c" });
    expect(book.ownerWindow(later(1000))).toEqual({ open: true, expiresAt: later(REPLY_WINDOW_MS).toISOString() });
    expect(book.ownerWindow(later(REPLY_WINDOW_MS + 1)).open).toBe(false);
  });
});

describe("list", () => {
  const seed = async (count: number) => {
    for (let i = 0; i < count; i++)
      await book.observe({ peerId: `peer-${String(i).padStart(3, "0")}`, isAccountOwner: i === 0, at: later(i * 1000), contextToken: i === 0 ? "ctx" : null });
  };

  test("an empty book gives an empty page", () => {
    expect(book.list({ limit: 20, afterPeerId: null }, true)).toEqual({ peers: [], nextAfterPeerId: null });
  });

  test("pages in stable id order with a cursor and a null end", async () => {
    await seed(5);
    const first = book.list({ limit: 2, afterPeerId: null }, true, later(5000));
    expect(first.peers.map((p) => p.peerId)).toEqual(["peer-000", "peer-001"]);
    expect(first.nextAfterPeerId).toBe("peer-001");
    const second = book.list({ limit: 2, afterPeerId: first.nextAfterPeerId }, true, later(5000));
    expect(second.peers.map((p) => p.peerId)).toEqual(["peer-002", "peer-003"]);
    const last = book.list({ limit: 2, afterPeerId: second.nextAfterPeerId }, true, later(5000));
    expect(last.peers.map((p) => p.peerId)).toEqual(["peer-004"]);
    expect(last.nextAfterPeerId).toBeNull();
    // Exactly full last page: no phantom next page.
    expect(book.list({ limit: 5, afterPeerId: null }, true, later(5000)).nextAfterPeerId).toBeNull();
  });

  test("order does not depend on observation order", async () => {
    await book.observe({ peerId: "z", isAccountOwner: false, at: T0 });
    await book.observe({ peerId: "a", isAccountOwner: false, at: later(1000) });
    expect(book.list({ limit: 10, afterPeerId: null }, true).peers.map((p) => p.peerId)).toEqual(["a", "z"]);
  });

  test("uses the fixed fallback name and never invents one", async () => {
    await book.observe({ peerId: "a", isAccountOwner: true, at: T0 });
    await book.observe({ peerId: "b", isAccountOwner: true, at: T0, displayName: "Bob" });
    const names = book.list({ limit: 10, afterPeerId: null }, true).peers.map((p) => p.displayName);
    expect(names).toEqual([FALLBACK_DISPLAY_NAME, "Bob"]);
  });

  test("canReply needs a sendable account, the owner, and a live token", async () => {
    await book.observe({ peerId: "owner", isAccountOwner: true, at: T0, contextToken: "c" });
    await book.observe({ peerId: "stranger", isAccountOwner: false, at: T0, contextToken: "c2" });
    await book.observe({ peerId: "notoken", isAccountOwner: true, at: T0 });
    const reply = (accountCanSend: boolean, now: Date) =>
      Object.fromEntries(book.list({ limit: 10, afterPeerId: null }, accountCanSend, now).peers.map((p) => [p.peerId, p.canReply]));
    expect(reply(true, later(1000))).toEqual({ notoken: false, owner: true, stranger: false });
    expect(reply(false, later(1000)).owner).toBe(false);
    expect(reply(true, later(REPLY_WINDOW_MS + 1)).owner).toBe(false);
  });

  test("a page never carries a token, even in its serialized form", async () => {
    await book.observe({ peerId: "owner", isAccountOwner: true, at: T0, contextToken: "ctx-super-secret" });
    expect(JSON.stringify(book.list({ limit: 10, afterPeerId: null }, true))).not.toContain("ctx-super-secret");
  });

  test("listing makes no writes", async () => {
    await seed(3);
    const before = await Bun.file(store.path("contexts.json")).text();
    book.list({ limit: 10, afterPeerId: null }, true);
    expect(await Bun.file(store.path("contexts.json")).text()).toBe(before);
  });
});

describe("persistence ordering", () => {
  test("many overlapping observations end at the newest snapshot", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => book.observe({ peerId: `p${i}`, isAccountOwner: false, at: later(i) })));
    expect((await reload()).size).toBe(20);
  });
});
