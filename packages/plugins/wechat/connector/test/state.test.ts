import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STATE_VERSION, StateStore, type PeerRecord } from "../state";

let root: string;
let store: StateStore;

const account = {
  botToken: "tok-test-1",
  baseUrl: "https://acct.weixin.qq.com",
  ilinkBotId: "bot1@im.bot",
  ilinkUserId: "owner1@im.wechat",
  linkedAt: "2026-11-16T08:00:00.000Z",
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wechat-state-"));
  store = new StateStore(join(root, "state"));
  await store.prepare();
});
afterEach(() => rm(root, { recursive: true, force: true }));

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe("layout and permissions", () => {
  test("creates the owner-only directory tree", async () => {
    expect(await mode(store.directory)).toBe(0o700);
    for (const sub of ["tmp", "spool", "exchange/inbound", "exchange/outbound"]) expect((await stat(store.path(sub))).isDirectory()).toBe(true);
  });

  test("tightens a directory that was created too open", async () => {
    await rm(store.directory, { recursive: true });
    await mkdir(store.directory, { mode: 0o755 });
    await store.prepare();
    expect(await mode(store.directory)).toBe(0o700);
  });

  test("refuses a state directory that is a symlink", async () => {
    await mkdir(join(root, "elsewhere"));
    await symlink(join(root, "elsewhere"), join(root, "link"));
    await expect(new StateStore(join(root, "link")).prepare()).rejects.toThrow("real directory");
  });

  test("prepare clears leftovers of an interrupted run but keeps real state", async () => {
    await store.writeAccount(account);
    await writeFile(store.path("tmp", "download.part"), "partial");
    await writeFile(store.path("account.json.abcd.tmp"), "half");
    await store.prepare();
    expect(await readdir(store.path("tmp"))).toEqual([]);
    expect((await readdir(store.directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
    expect((await store.readAccount()).status).toBe("ok");
  });
});

describe("atomic writes", () => {
  test("writes mode 0600, newline-terminated, versioned JSON with no temporary file left", async () => {
    await store.writeAccount(account);
    expect(await mode(store.path("account.json"))).toBe(0o600);
    const raw = await readFile(store.path("account.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw).version).toBe(STATE_VERSION);
    expect((await readdir(store.directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("a failed write leaves the previous content and no temporary file", async () => {
    await store.writeAccount(account);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(store.writeJson("account.json", cyclic)).rejects.toThrow();
    expect(await store.readAccount()).toMatchObject({ status: "ok", value: { botToken: "tok-test-1" } });
    expect((await readdir(store.directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("overwriting replaces the content whole", async () => {
    await store.writeCursor("first-cursor-value");
    await store.writeCursor("second");
    expect(await store.readCursor()).toEqual({ status: "ok", value: { version: 1, getUpdatesBuf: "second" } });
  });

  test("concurrent writers never produce a torn file", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.writeCursor(`cursor-${i}`.repeat(200))));
    const outcome = await store.readCursor();
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.value.getUpdatesBuf).toMatch(/^(cursor-\d+)+$/);
  });
});

describe("reading", () => {
  test("missing files are reported as missing", async () => {
    expect(await store.readAccount()).toEqual({ status: "missing" });
    expect(await store.readCursor()).toEqual({ status: "missing" });
    expect(await store.readContexts()).toEqual({ status: "missing" });
  });

  test("a corrupt account.json counts as not linked and is kept aside", async () => {
    await writeFile(store.path("account.json"), '{"version":1,"botToken":"x"');
    expect(await store.readAccount()).toEqual({ status: "unreadable", reason: "corrupt" });
    expect(await store.readAccount()).toEqual({ status: "missing" });
    expect(await readFile(store.path("account.json.corrupt"), "utf8")).toContain("botToken");
  });

  test("an unknown version is set aside, not interpreted", async () => {
    await writeFile(store.path("account.json"), JSON.stringify({ ...account, version: 99 }));
    expect(await store.readAccount()).toEqual({ status: "unreadable", reason: "version" });
    expect((await readdir(store.directory)).includes("account.json.unsupported")).toBe(true);
  });

  test.each([
    ["no token", { ...account, botToken: "" }],
    ["no owner id", { ...account, ilinkUserId: undefined }],
    ["bad link time", { ...account, linkedAt: "soon" }],
    ["a base URL outside weixin.qq.com", { ...account, baseUrl: "https://evil.test" }],
    ["a plain-http base URL", { ...account, baseUrl: "http://acct.weixin.qq.com" }],
    ["a non-object", "account"],
  ])("rejects an account with %s", async (_label, content) => {
    await writeFile(store.path("account.json"), JSON.stringify(typeof content === "object" ? { version: 1, ...content } : content));
    expect((await store.readAccount()).status).toBe("unreadable");
  });

  test("a cursor of the wrong type is unreadable", async () => {
    await writeFile(store.path("cursor.json"), JSON.stringify({ version: 1, getUpdatesBuf: 12 }));
    expect((await store.readCursor()).status).toBe("unreadable");
  });

  test("the cooldown deadline round-trips", async () => {
    await store.writeAccount({ ...account, pausedUntil: "2026-11-16T09:00:00.000Z" });
    expect(await store.readAccount()).toMatchObject({ status: "ok", value: { pausedUntil: "2026-11-16T09:00:00.000Z" } });
  });
});

describe("peer contexts", () => {
  const peer = (overrides: Partial<PeerRecord> = {}): PeerRecord => ({
    isAccountOwner: true,
    lastObservedAt: "2026-11-16T08:00:00.000Z",
    displayName: "Alice",
    contextToken: "ctx-1",
    receivedAt: "2026-11-16T08:00:00.000Z",
    ...overrides,
  });

  test("round-trips peers", async () => {
    await store.writeContexts(new Map([["owner1@im.wechat", peer()]]));
    const outcome = await store.readContexts();
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.value.peers.get("owner1@im.wechat")).toEqual(peer());
  });

  test("a hostile peer id stays an ordinary key", async () => {
    await store.writeContexts(new Map([["__proto__", peer()], ["constructor", peer()]]));
    const outcome = await store.readContexts();
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect([...outcome.value.peers.keys()].sort()).toEqual(["__proto__", "constructor"]);
      expect(({} as Record<string, unknown>).isAccountOwner).toBeUndefined();
    }
  });

  test("a token without its receive time is dropped, because its window cannot be checked", async () => {
    await writeFile(
      store.path("contexts.json"),
      JSON.stringify({ version: 1, peers: { a: { isAccountOwner: true, lastObservedAt: "2026-11-16T08:00:00.000Z", contextToken: "ctx" } } })
    );
    const outcome = await store.readContexts();
    expect(outcome.status === "ok" && outcome.value.peers.get("a")).toEqual({ isAccountOwner: true, lastObservedAt: "2026-11-16T08:00:00.000Z" });
  });

  test("malformed peers are skipped without losing the valid ones", async () => {
    await writeFile(
      store.path("contexts.json"),
      JSON.stringify({
        version: 1,
        peers: {
          good: { isAccountOwner: false, lastObservedAt: "2026-11-16T08:00:00.000Z" },
          noTime: { isAccountOwner: true },
          wrongFlag: { isAccountOwner: "yes", lastObservedAt: "2026-11-16T08:00:00.000Z" },
          junk: 5,
        },
      })
    );
    const outcome = await store.readContexts();
    expect(outcome.status === "ok" && [...outcome.value.peers.keys()]).toEqual(["good"]);
  });
});

describe("removal", () => {
  test("remove deletes one file and clear empties the directory", async () => {
    await store.writeAccount(account);
    await store.writeCursor("buf");
    await store.remove("cursor.json");
    expect(await store.readCursor()).toEqual({ status: "missing" });
    await store.clear();
    expect(await readdir(store.directory)).toEqual([]);
    expect((await stat(store.directory)).isDirectory()).toBe(true);
  });

  test("removing a file that is not there is fine", async () => {
    await store.remove("nothing.json");
  });
});
