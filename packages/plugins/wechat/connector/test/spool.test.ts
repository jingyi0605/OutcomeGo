import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalMessage } from "@outcomego/plugin-sdk/messaging";
import { MAX_EXCHANGE_BYTES, MAX_QUEUE_ITEMS, SEEN_LIMIT, Spool } from "../spool";
import { StateStore } from "../state";

let root: string;
let store: StateStore;
let ids = 0;
const T0 = new Date("2026-11-16T08:00:00.000Z");

const message = (providerMessageId: string, extra: Partial<ExternalMessage> = {}): ExternalMessage => ({
  providerMessageId,
  peer: { id: "owner1@im.wechat", type: "direct" },
  sender: { id: "owner1@im.wechat", isAccountOwner: true },
  text: `text ${providerMessageId}`,
  occurredAt: "2026-11-16T08:00:00.000Z",
  ...extra,
});
const media = (exchangeName: string, byteSize = 10) => ({ exchangeName, fileName: "a.png", byteSize, sha256: "a".repeat(64) });

const opened: Spool[] = [];
const open = async () => {
  const spool = await Spool.open(store, { random: () => `q${++ids}` });
  opened.push(spool);
  return spool;
};

beforeEach(async () => {
  opened.length = 0;
  root = await mkdtemp(join(tmpdir(), "wechat-spool-"));
  store = new StateStore(join(root, "state"));
  await store.prepare();
  ids = 0;
});
afterEach(async () => {
  // A test that failed before closing its spool must not leak a handle into the next one.
  await Promise.all(opened.map((spool) => spool.close().catch(() => {})));
  await rm(root, { recursive: true, force: true });
});

describe("cursors", () => {
  test("ackCursor is <queueId>:<seq> and strictly increases from 1", async () => {
    const spool = await open();
    const cursors = [];
    for (const id of ["10", "20", "30"]) cursors.push((await spool.append(message(id), T0))!.ackCursor);
    expect(cursors).toEqual(["q1:1", "q1:2", "q1:3"]);
    expect(spool.read(0, 10).map((item) => item.ackCursor)).toEqual(cursors);
    await spool.close();
  });

  test("read returns only what follows a cursor, up to the limit", async () => {
    const spool = await open();
    for (const id of ["1", "2", "3", "4"]) await spool.append(message(id), T0);
    expect(spool.read(1, 2).map((item) => item.message.providerMessageId)).toEqual(["2", "3"]);
    expect(spool.read(4, 5)).toEqual([]);
    await spool.close();
  });

  test("a cursor of another queue, a malformed one or a future one is not recognised", async () => {
    const spool = await open();
    await spool.append(message("1"), T0);
    expect(spool.parseCursor("q1:1")).toBe(1);
    for (const bad of ["other:1", "q1:9", "q1:-1", "q1:x", "q1:", ":1", "q1", "", "q1:1.5"]) expect(spool.parseCursor(bad)).toBeNull();
    await spool.close();
  });

  test("seq keeps growing across acknowledgement and restart, never reusing a number", async () => {
    let spool = await open();
    await spool.append(message("1"), T0);
    await spool.append(message("2"), T0);
    await spool.ack("q1:2");
    await spool.close();
    spool = await open();
    expect((await spool.append(message("3"), T0))!.ackCursor).toBe("q1:3");
    await spool.close();
  });
});

describe("acknowledgement", () => {
  test("removes up to and including the cursor, keeps the rest", async () => {
    const spool = await open();
    for (const id of ["1", "2", "3"]) await spool.append(message(id), T0);
    expect(await spool.ack("q1:2")).toEqual({ reset: false, removed: 2 });
    expect(spool.read(0, 10).map((item) => item.message.providerMessageId)).toEqual(["3"]);
    expect(await spool.ack("q1:2")).toEqual({ reset: false, removed: 0 });
    await spool.close();
  });

  test("an unknown cursor asks the caller to start over and removes nothing", async () => {
    const spool = await open();
    await spool.append(message("1"), T0);
    expect(await spool.ack("stale-queue:7")).toEqual({ reset: true });
    expect(spool.read(0, 10)).toHaveLength(1);
    await spool.close();
  });

  test("media files go only once their message is acknowledged", async () => {
    const spool = await open();
    await writeFile(store.path("exchange", "inbound", "1-0"), "bytes");
    await writeFile(store.path("exchange", "inbound", "2-0"), "bytes");
    await spool.append(message("1", { media: [media("1-0")] }), T0);
    await spool.append(message("2", { media: [media("2-0")] }), T0);
    expect((await readdir(store.path("exchange", "inbound"))).sort()).toEqual(["1-0", "2-0"]);
    await spool.ack("q1:1");
    expect(await readdir(store.path("exchange", "inbound"))).toEqual(["2-0"]);
    await spool.close();
  });
});

describe("deduplication", () => {
  test("the same provider id is queued once", async () => {
    const spool = await open();
    expect(await spool.append(message("42"), T0)).not.toBeNull();
    expect(await spool.append(message("42", { text: "changed" }), T0)).toBeNull();
    expect(spool.stats().length).toBe(1);
    await spool.close();
  });

  test("an acknowledged id is still recognised, also after a restart", async () => {
    let spool = await open();
    await spool.append(message("42"), T0);
    await spool.ack("q1:1");
    expect(await spool.append(message("42"), T0)).toBeNull();
    await spool.close();
    spool = await open();
    expect(spool.has("42")).toBe(true);
    expect(await spool.append(message("42"), T0)).toBeNull();
    await spool.close();
  });

  test("64-bit ids stay exact strings", async () => {
    const spool = await open();
    await spool.append(message("18446744073709551615"), T0);
    await spool.append(message("18446744073709551614"), T0);
    expect(spool.read(0, 5).map((item) => item.message.providerMessageId)).toEqual(["18446744073709551615", "18446744073709551614"]);
    await spool.close();
  });

  test("the memory of acknowledged ids is bounded, but pinned ids are never evicted", async () => {
    const spool = await open();
    spool.pin(["pinned"]);
    await spool.append(message("pinned"), T0);
    await spool.ack("q1:1");
    for (let i = 0; i < SEEN_LIMIT + 50; i++) {
      await spool.append(message(`m${i}`), T0);
      await spool.ack(`q1:${i + 2}`);
    }
    expect(spool.has("pinned")).toBe(true);
    expect(spool.has("m0")).toBe(false);
    expect(spool.has(`m${SEEN_LIMIT + 49}`)).toBe(true);
    spool.unpin();
    await spool.close();
  }, 30_000);
});

describe("crash recovery", () => {
  const seed = async (count: number) => {
    const spool = await open();
    for (let i = 1; i <= count; i++) await spool.append(message(String(i), { text: `body ${i} ${"x".repeat(i * 3)}` }), T0);
    await spool.close();
  };

  test("a journal cut at any byte reopens to a clean prefix that accepts new messages", async () => {
    await seed(4);
    const journal = store.path("spool", "journal.ndjson");
    const full = await readFile(journal);
    const headerEnd = full.indexOf(10) + 1;
    for (let cut = 0; cut <= full.length; cut++) {
      await writeFile(journal, full.subarray(0, cut));
      const spool = await open();
      const kept = spool.read(0, 10).map((item) => item.message.providerMessageId);
      // Always an in-order prefix of what was written, and complete records only.
      expect(kept).toEqual(["1", "2", "3", "4"].slice(0, kept.length));
      if (cut >= full.length) expect(kept).toHaveLength(4);
      if (cut < headerEnd) expect(kept).toEqual([]);
      const next = await spool.append(message("after-crash"), T0);
      expect(next).not.toBeNull();
      expect(spool.read(0, 10).at(-1)!.message.providerMessageId).toBe("after-crash");
      await spool.close();
      // The repaired file is itself clean: every line parses.
      for (const line of (await readFile(journal, "utf8")).split("\n").filter(Boolean)) JSON.parse(line);
    }
  }, 60_000);

  test("garbage in the middle ends the valid prefix instead of crashing", async () => {
    await seed(3);
    const journal = store.path("spool", "journal.ndjson");
    const lines = (await readFile(journal, "utf8")).split("\n");
    lines.splice(2, 0, "{not json");
    await writeFile(journal, lines.join("\n"));
    const spool = await open();
    expect(spool.read(0, 10).map((item) => item.message.providerMessageId)).toEqual(["1"]);
    expect(spool.recoveredDrops).toBeGreaterThan(0);
    await spool.close();
  });

  test("an empty or missing journal starts a fresh queue", async () => {
    const spool = await open();
    expect(spool.stats().length).toBe(0);
    expect(spool.cursorFor(0)).toBe("q1:0");
    await spool.close();
    await writeFile(store.path("spool", "journal.ndjson"), "");
    const again = await open();
    expect(again.cursorFor(0)).toMatch(/^q\d+:0$/);
    await again.close();
  });

  test("an append is on disk before append() returns", async () => {
    const spool = await open();
    await spool.append(message("durable"), T0);
    expect(await readFile(store.path("spool", "journal.ndjson"), "utf8")).toContain("durable");
    await spool.close();
  });

  test("the journal is owner-only", async () => {
    const spool = await open();
    expect((await stat(store.path("spool", "journal.ndjson"))).mode & 0o777).toBe(0o600);
    await spool.close();
  });

  test("a restart keeps queued items and the same queue id", async () => {
    let spool = await open();
    await spool.append(message("1"), T0);
    await spool.close();
    spool = await open();
    expect(spool.read(0, 10).map((item) => item.ackCursor)).toEqual(["q1:1"]);
    await spool.close();
  });

  test("a restart removes exchange files no queued message refers to", async () => {
    const spool = await open();
    await spool.append(message("1", { media: [media("1-0")] }), T0);
    await spool.close();
    await writeFile(store.path("exchange", "inbound", "1-0"), "kept");
    await writeFile(store.path("exchange", "inbound", "99-0"), "orphan from a crashed download");
    const again = await open();
    expect(await readdir(store.path("exchange", "inbound"))).toEqual(["1-0"]);
    await again.close();
  });
});

describe("compaction", () => {
  test("many acknowledgements shrink the journal without losing what is queued or remembered", async () => {
    let spool = await open();
    for (let i = 1; i <= 450; i++) {
      await spool.append(message(`m${i}`), T0);
      if (i < 450) await spool.ack(`q1:${i}`);
    }
    const lines = (await readFile(store.path("spool", "journal.ndjson"), "utf8")).split("\n").filter(Boolean);
    expect(lines.length).toBeLessThan(450 * 2);
    await spool.close();
    spool = await open();
    expect(spool.read(0, 10).map((item) => item.message.providerMessageId)).toEqual(["m450"]);
    expect(spool.has("m1")).toBe(true);
    expect(await spool.append(message("m1"), T0)).toBeNull();
    expect((await spool.append(message("next"), T0))!.ackCursor).toBe("q1:451");
    await spool.close();
  }, 60_000);
});

describe("waiting", () => {
  test("an append wakes a waiting poll quickly", async () => {
    const spool = await open();
    const started = performance.now();
    const waiting = spool.waitForAppend(5000);
    setTimeout(() => void spool.append(message("1"), T0), 20);
    expect(await waiting).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
    await spool.close();
  });

  test("times out without a message", async () => {
    const spool = await open();
    expect(await spool.waitForAppend(30)).toBe(false);
    await spool.close();
  });

  test("an abort ends the wait at once and leaves no waiter behind", async () => {
    const spool = await open();
    const controller = new AbortController();
    const waiting = spool.waitForAppend(60_000, controller.signal);
    controller.abort();
    expect(await waiting).toBe(false);
    expect(await spool.waitForAppend(0)).toBe(false);
    await spool.close();
  });

  test("wakeWaiters releases a pending wait so a newer poll can take over", async () => {
    const spool = await open();
    const waiting = spool.waitForAppend(60_000);
    spool.wakeWaiters();
    await waiting;
    await spool.close();
  });
});

describe("backpressure", () => {
  test("backlogged at the item limit, clear again below 80%", async () => {
    const spool = await open();
    expect(spool.stats().backlogged).toBe(false);
    for (let i = 0; i < MAX_QUEUE_ITEMS; i++) await spool.append(message(`m${i}`), T0);
    expect(spool.stats()).toMatchObject({ length: MAX_QUEUE_ITEMS, backlogged: true });
    expect(spool.hasRoom()).toBe(false);
    await spool.ack(`q1:${MAX_QUEUE_ITEMS - Math.floor(MAX_QUEUE_ITEMS * 0.8) + 1}`);
    expect(spool.hasRoom()).toBe(true);
    expect(spool.stats().backlogged).toBe(false);
    await spool.close();
  }, 60_000);

  test("backlogged by pending media volume", async () => {
    const spool = await open();
    await spool.append(message("big", { media: [media("1-0", MAX_EXCHANGE_BYTES)] }), T0);
    expect(spool.stats()).toMatchObject({ length: 1, exchangeBytes: MAX_EXCHANGE_BYTES, backlogged: true });
    await spool.close();
  });
});

describe("reset", () => {
  test("a rebuilt queue has a new id, no messages and no files, and old cursors are rejected", async () => {
    const spool = await open();
    await writeFile(store.path("exchange", "inbound", "1-0"), "bytes");
    await spool.append(message("1", { media: [media("1-0")] }), T0);
    await spool.reset();
    expect(spool.stats().length).toBe(0);
    expect(spool.cursorFor(0)).toBe("q2:0");
    expect(await readdir(store.path("exchange", "inbound"))).toEqual([]);
    expect(spool.parseCursor("q1:1")).toBeNull();
    expect(await spool.ack("q1:1")).toEqual({ reset: true });
    expect(spool.has("1")).toBe(false);
    expect((await spool.append(message("1"), T0))!.ackCursor).toBe("q2:1");
    await spool.close();
  });
});
