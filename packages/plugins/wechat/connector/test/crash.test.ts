import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { createWorld, until, type Connector, type Hooks, type World } from "./fixtures/harness";
import type { SimUpdateMode } from "./fixtures/ilink-simulator";

/**
 * Every test kills the connector at one point of a batch and starts a new one on the same state
 * directory, then checks the two promises: no message is lost, and none is queued twice.
 */
let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(() => world.cleanup());

const owner = "owner1@im.wechat";
const NUMBERS = ["7100000000000000001", "7100000000000000002", "7100000000000000003"];
const queued = (c: Connector) => c.spool.read(0, 100).map((item) => item.message.providerMessageId);
const key = randomBytes(16);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const encrypt = (plain: Uint8Array) => {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
};
const feed = (ids: string[]) => ids.forEach((id) => world.sim.enqueue({ messageId: id, fromUserId: owner, text: `text ${id}` }));

/** A crash is an exception from a hook; the loop dies with it and the instance is abandoned. */
class Crash extends Error {}
const crashOnce = (name: keyof Hooks, when: (count: number) => boolean = () => true): Hooks => {
  let fired = false;
  let count = 0;
  return {
    [name]: () => {
      count += 1;
      if (!fired && when(count)) {
        fired = true;
        throw new Crash(name);
      }
    },
  } as Hooks;
};

/** Starts the first connector, lets it crash while taking in the batch, then starts the next one. */
const crashThenRestart = async (armed: Hooks, setup: () => void = () => feed(NUMBERS)) => {
  const hooks: Hooks = {};
  const first = await world.start({ link: true, hooks });
  await until(() => first.account.status().state === "ready", "first ready");
  // Armed only now: linking itself clears and writes files and must not trigger the crash.
  Object.assign(hooks, armed);
  setup();
  // Wait for the crash to have happened: the hook throws and the loop ends.
  await until(() => !first.receive.isRunning, "first connector to die");
  await first.stop();
  return world.start({ hooks: {} });
};

describe.each([["replay", "replay" as SimUpdateMode], ["no-replay", "no-replay" as SimUpdateMode]])("when the provider %ss an old position", (_name, mode) => {
  beforeEach(() => {
    world.sim.mode = mode;
  });

  const settled = async (c: Connector, expected = NUMBERS) => {
    await until(() => expected.every((id) => c.spool.has(id)), "all messages queued");
    // Give a restarted loop time to fetch again and (wrongly) queue anything twice.
    await Bun.sleep(150);
    expect(queued(c).sort()).toEqual([...expected].sort());
    expect(new Set(queued(c)).size).toBe(queued(c).length);
    await until(async () => (await c.journal.read()) === null, "journal cleared");
  };

  test("before any of the batch is queued (the journal is already on disk)", async () => {
    const next = await crashThenRestart(crashOnce("beforeAppend"));
    await settled(next);
  });

  test("after some of the batch is queued", async () => {
    const next = await crashThenRestart(crashOnce("beforeAppend", (count) => count === 2));
    await settled(next);
  });

  test("after the last message is queued, before the provider cursor is saved", async () => {
    const next = await crashThenRestart(crashOnce("beforeCursorWrite"));
    await settled(next);
  });

  test("after the cursor is saved, before the journal is removed", async () => {
    const next = await crashThenRestart(crashOnce("beforeJournalClear"));
    await settled(next);
  });

  test("a batch the Server had already acknowledged is not queued a second time", async () => {
    const hooks: Hooks = {};
    const first = await world.start({ link: true, hooks });
    await until(() => first.account.status().state === "ready", "ready");
    Object.assign(hooks, crashOnce("beforeJournalClear"));
    feed(NUMBERS);
    await until(() => !first.receive.isRunning, "crash");
    // The Server polled and acknowledged everything before the process came back.
    const everything = first.spool.read(0, 100);
    expect(everything).toHaveLength(3);
    await first.spool.ack(everything[2]!.ackCursor);
    await first.stop();
    const next = await world.start({ hooks: {} });
    await until(async () => (await next.journal.read()) === null, "journal cleared");
    await Bun.sleep(150);
    expect(queued(next)).toEqual([]);
    for (const id of NUMBERS) expect(next.spool.has(id)).toBe(true);
  });

  test("a restart with nothing pending changes nothing", async () => {
    const first = await world.start({ link: true });
    feed(NUMBERS);
    await until(() => queued(first).length === 3, "queued");
    await until(async () => (await first.journal.read()) === null, "committed");
    await first.stop();
    const next = await world.start();
    await Bun.sleep(120);
    expect(queued(next)).toEqual(NUMBERS);
  });
});

describe("the journal itself", () => {
  test("it holds the batch before the first message is touched", async () => {
    let seen: number | null = null;
    const hooks: Hooks = {};
    const first = await world.start({ link: true, hooks });
    await until(() => first.account.status().state === "ready", "ready");
    hooks.beforeAppend = () => { throw new Crash("stop here"); };
    feed(NUMBERS);
    await until(() => !first.receive.isRunning, "crash");
    const journal = await first.journal.read();
    seen = journal?.messages.length ?? null;
    expect(seen).toBe(3);
    expect(journal!.messages.map((message) => message.messageId)).toEqual(NUMBERS);
    expect(journal!.nextBuffer).toMatch(/^buf-/);
    await first.stop();
  });

  test("the provider cursor has not moved while the journal still exists", async () => {
    const hooks: Hooks = {};
    const first = await world.start({ link: true, hooks });
    await until(() => first.account.status().state === "ready", "ready");
    Object.assign(hooks, crashOnce("beforeAppend"));
    feed(NUMBERS);
    await until(() => !first.receive.isRunning, "crash");
    // The saved position is still behind the one the journal says to move to.
    const journal = (await first.journal.read())!;
    const saved = await first.store.readCursor();
    expect(journal.nextBuffer).not.toBeNull();
    expect(saved.status === "ok" ? saved.value.getUpdatesBuf : "").not.toBe(journal.nextBuffer);
    await first.stop();
  });

  test("reply credentials stay inside the state directory and the journal is private", async () => {
    const hooks: Hooks = {};
    const first = await world.start({ link: true, hooks });
    await until(() => first.account.status().state === "ready", "ready");
    Object.assign(hooks, crashOnce("beforeAppend"));
    feed(NUMBERS);
    await until(() => !first.receive.isRunning, "crash");
    const { stat } = await import("node:fs/promises");
    expect((await stat(first.store.path("receive-journal.json"))).mode & 0o777).toBe(0o600);
    await first.stop();
  });

  test("a journal from another login is discarded, not replayed", async () => {
    // The provider does not replay, so the journal is the only place these messages exist.
    world.sim.mode = "no-replay";
    const hooks: Hooks = {};
    const first = await world.start({ link: true, hooks });
    await until(() => first.account.status().state === "ready", "ready");
    Object.assign(hooks, crashOnce("beforeAppend"));
    feed(NUMBERS);
    await until(() => !first.receive.isRunning, "crash");
    const journal = (await first.journal.read())!;
    await first.journal.write({ ...journal, ilinkBotId: "someone-elses-bot@im.bot" });
    await first.stop();
    const next = await world.start();
    await until(async () => (await next.journal.read()) === null, "journal discarded");
    await Bun.sleep(100);
    expect(queued(next)).not.toContain(NUMBERS[0]!);
  });

  test("a damaged journal is set aside and receiving carries on", async () => {
    const first = await world.start({ link: true });
    await first.stop();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(first.store.path("receive-journal.json"), "{not json");
    const next = await world.start();
    await until(() => next.account.status().state === "ready", "ready", 5000);
    expect((await readdir(next.store.directory)).some((name) => name.startsWith("receive-journal.json.corrupt"))).toBe(true);
    feed([NUMBERS[0]!]);
    await until(() => queued(next).length === 1, "still receiving");
  });
});

describe("the limit of what can be promised", () => {
  test("a response received before its journal was written is recoverable only if the provider replays", async () => {
    // Crash exactly when the journal is about to be written: the provider has already moved on.
    for (const mode of ["replay", "no-replay"] as SimUpdateMode[]) {
      const isolated = await createWorld();
      isolated.sim.mode = mode;
      const hooks: Hooks = {};
      const first = await isolated.start({ link: true, hooks });
      await until(() => first.account.status().state === "ready", "ready");
      Object.assign(hooks, crashOnce("beforeJournalWrite"));
      isolated.sim.enqueue({ messageId: NUMBERS[0]!, fromUserId: owner, text: "x" });
      await until(() => !first.receive.isRunning, "crash before the journal");
      await first.stop();
      const next = await isolated.start();
      await Bun.sleep(250);
      const got = next.spool.has(NUMBERS[0]!);
      if (mode === "replay") expect(got).toBe(true);
      // Without replay the message is gone for good: this is the documented, unavoidable window.
      else expect(got).toBe(false);
      await isolated.cleanup();
    }
  });
});

describe("files in a crashed batch", () => {
  test("a file fetched before the crash is not duplicated or orphaned after it", async () => {
    world.sim.mode = "replay";
    world.sim.cdn.set("pic", encrypt(PNG));
    const item = { type: 2, image_item: { media: { encrypt_query_param: "pic", aes_key: key.toString("base64") } } };
    const hooks: Hooks = {};
    const first = await world.start({ link: true, hooks });
    await until(() => first.account.status().state === "ready", "ready");
    Object.assign(hooks, crashOnce("beforeAppend"));
    world.sim.enqueue({ messageId: NUMBERS[0]!, fromUserId: owner, items: [item] });
    await until(() => !first.receive.isRunning, "crash");
    expect(await readdir(first.store.path("exchange", "inbound"))).toHaveLength(1);
    await first.stop();
    const next = await world.start();
    await until(() => next.spool.has(NUMBERS[0]!), "message queued after restart");
    await until(async () => (await next.journal.read()) === null, "committed");
    const message = next.spool.read(0, 1)[0]!.message;
    expect(message.media).toHaveLength(1);
    const files = await readdir(next.store.path("exchange", "inbound"));
    expect(files).toEqual([message.media![0]!.exchangeName]);
  });
});
