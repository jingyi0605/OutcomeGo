import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WechatApi } from "../api";
import { MAX_QR_REFRESHES, QR_VALIDITY_MS, SESSION_COOLDOWN_MS, WechatAccount, type AccountCollaborators } from "../account";
import { PeerBook } from "../peers";
import { StateStore } from "../state";
import { IlinkSimulator } from "./fixtures/ilink-simulator";

let root: string;
let clock: number;
let sim: IlinkSimulator;
let events: string[];

const T0 = Date.parse("2026-11-16T08:00:00.000Z");
const collaborators = (): AccountCollaborators => ({
  startReceiving: () => void events.push("start"),
  stopReceiving: async () => void events.push("stop"),
  resetQueue: async () => void events.push("reset"),
  queueLength: () => 3,
  dropped: () => ({ group: 1, self: 0, empty: 2, duplicate: 0 }),
});

const build = (options: { sessionIds?: string[] } = {}) => {
  const store = new StateStore(join(root, "state"));
  const ids = [...(options.sessionIds ?? [])];
  const account = new WechatAccount({
    api: new WechatApi({ fetch: sim.fetch }),
    store,
    peers: new PeerBook(store),
    collaborators: collaborators(),
    now: () => new Date(clock),
    sessionId: () => ids.shift() ?? "session-1",
    statusPollDelayMs: 1,
  });
  return { account, store };
};

/** Lets the background approval loop run until `done` holds. */
const until = async (done: () => boolean | Promise<boolean>, label: string) => {
  for (let i = 0; i < 400; i++) {
    if (await done()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
};

const link = async (account: WechatAccount) => {
  const started = await account.startLink();
  await account.finishLink(started.sessionId);
  return started;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wechat-account-"));
  clock = T0;
  sim = new IlinkSimulator();
  events = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("starting a link", () => {
  test("returns a session, a PNG QR code and millisecond deadlines", async () => {
    const { account } = build();
    await account.initialize();
    const started = await account.startLink();
    expect(started.sessionId).toBe("session-1");
    expect(started.qrCodeDataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(started.challengeGeneration).toBe(0);
    expect(started.expiresAt).toBe(T0 + QR_VALIDITY_MS);
    expect(started.sessionExpiresAt).toBeGreaterThan(started.expiresAt);
    expect(Number.isSafeInteger(started.expiresAt)).toBe(true);
  });

  test("the QR image encodes the provider's content and nothing else leaks into the result", async () => {
    const { account } = build();
    await account.initialize();
    const started = await account.startLink();
    expect(JSON.stringify(started)).not.toContain(sim.qr.qrcode);
    expect(JSON.stringify(started)).not.toContain(sim.qr.content);
  });

  test("concurrent starts share one session", async () => {
    const { account } = build({ sessionIds: ["a", "b"] });
    await account.initialize();
    const [one, two] = await Promise.all([account.startLink(), account.startLink()]);
    expect(one.sessionId).toBe(two.sessionId);
    expect(sim.requests.filter((r) => r.url.pathname.endsWith("get_bot_qrcode"))).toHaveLength(1);
  });

  test("a new start replaces an unfinished session", async () => {
    const { account } = build({ sessionIds: ["first", "second"] });
    await account.initialize();
    const first = await account.startLink();
    const second = await account.startLink();
    expect([first.sessionId, second.sessionId]).toEqual(["first", "second"]);
    await expect(account.finishLink("first")).rejects.toThrow("no longer active");
  });

  test("a provider failure surfaces and leaves no session behind", async () => {
    const { account } = build();
    await account.initialize();
    sim.failNext("ilink/bot/get_bot_qrcode", 7);
    await expect(account.startLink()).rejects.toThrow();
    expect((await account.linkStatus()).linking).toBe(false);
  });
});

describe("confirming", () => {
  test("wait -> scan -> confirm stores credentials and starts receiving", async () => {
    sim.qrStatuses = [{ status: "wait" }, { status: "scaned" }, { status: "confirmed" }];
    const { account, store } = build();
    await account.initialize();
    const started = await link(account);
    await until(async () => (await account.linkStatus()).linked === true, "link to finish");
    expect(await account.linkStatus()).toMatchObject({ sessionId: started.sessionId, linked: true, linking: false });
    expect(events).toContain("start");
    const saved = await store.readAccount();
    expect(saved).toMatchObject({ status: "ok", value: { ilinkBotId: "bot1@im.bot", ilinkUserId: "owner1@im.wechat", baseUrl: "https://acct.weixin.qq.com" } });
    expect((await stat(store.path("account.json"))).mode & 0o777).toBe(0o600);
    expect(account.status()).toMatchObject({ state: "bootstrapping", account: "…@im.bot".slice(0, 0) + "…" + "bot1@im.bot".slice(-4) });
    // Later requests go to the account-specific host with the new token.
    await account.api.getUpdates("", 1000);
    const last = sim.requests.at(-1)!;
    expect(last.url.hostname).toBe("acct.weixin.qq.com");
    expect(last.headers.get("authorization")).toBe(`Bearer ${sim.account.botToken}`);
  });

  test("while linking, status carries the same session and the current challenge", async () => {
    sim.qrStatuses = [{ status: "wait" }];
    const { account } = build();
    await account.initialize();
    const started = await link(account);
    const status = await account.linkStatus();
    expect(status).toMatchObject({ sessionId: started.sessionId, linked: false, linking: true, challenge: { generation: 0 } });
    expect(account.status().state).toBe("pairing");
  });

  test("confirmation never touches the old provider cursor of a different account", async () => {
    const first = build();
    await first.account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(first.account);
    await until(() => first.account.isLinked, "first link");
    await first.store.writeCursor("old-cursor");
    await first.account.peers.observe({ peerId: "owner1@im.wechat", isAccountOwner: true, at: new Date(T0), contextToken: "old-token" });
    events.length = 0;

    // A different WeChat account scans.
    sim.account = { ...sim.account, ilinkBotId: "bot2@im.bot", ilinkUserId: "owner2@im.wechat", botToken: "second-token" };
    sim.qrStatuses = [{ status: "confirmed" }];
    await first.account.startLink();
    await first.account.finishLink("session-1");
    await until(() => first.account.ownerId === "owner2@im.wechat", "account swap");
    expect(events).toEqual(["stop", "reset", "start"]);
    expect((await first.store.readCursor()).status).toBe("missing");
    expect(first.account.peers.size).toBe(0);
  });

  test("the same account scanning again keeps its peers but loses cursor and reply tokens", async () => {
    const { account, store } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "first link");
    await store.writeCursor("old-cursor");
    await account.peers.observe({ peerId: "owner1@im.wechat", isAccountOwner: true, at: new Date(T0), displayName: "Me", contextToken: "old-token" });
    events.length = 0;
    await account.startLink();
    await account.finishLink("session-1");
    await until(() => events.includes("start"), "relink");
    expect(events).toEqual(["stop", "start"]); // no queue reset for the same account
    expect((await store.readCursor()).status).toBe("missing");
    expect(account.peers.tokenState("owner1@im.wechat", new Date(T0))).toBe("missing");
    expect(account.peers.size).toBe(1);
  });

  test("the old loop is stopped before the new credentials are written", async () => {
    const { account, store } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    let tokenAtStop: string | null = null;
    const original = (account as unknown as { collaborators: AccountCollaborators }).collaborators;
    original.stopReceiving = async () => {
      const saved = await store.readAccount();
      tokenAtStop = saved.status === "ok" ? saved.value.botToken : null;
    };
    await link(account);
    await until(() => account.isLinked, "link");
    expect(tokenAtStop).toBeNull();
  });

  test("a confirmation with an unacceptable base URL is rejected and nothing is stored", async () => {
    sim.account = { ...sim.account, baseUrl: "https://evil.test" };
    sim.qrStatuses = [{ status: "confirmed" }];
    const { account, store } = build();
    await account.initialize();
    const started = await link(account);
    await until(async () => (await account.linkStatus()).authorizationError !== undefined, "rejection");
    expect(await account.linkStatus()).toMatchObject({ sessionId: started.sessionId, linked: false, linking: false, authorizationError: "wechat_base_url_rejected" });
    expect((await store.readAccount()).status).toBe("missing");
    expect(account.isLinked).toBe(false);
  });

  test("a confirmation missing its token or identity is a failed link", async () => {
    sim.account = { ...sim.account, botToken: "" };
    sim.qrStatuses = [{ status: "confirmed" }];
    const { account } = build();
    await account.initialize();
    await link(account);
    await until(async () => (await account.linkStatus()).authorizationError !== undefined, "failure");
    expect(account.isLinked).toBe(false);
  });

  test("a redirect to a foreign host is refused, to a weixin host is followed", async () => {
    sim.qrStatuses = [{ status: "scaned_but_redirect", redirect_host: "evil.test" }];
    const bad = build();
    await bad.account.initialize();
    await link(bad.account);
    await until(async () => (await bad.account.linkStatus()).authorizationError === "wechat_base_url_rejected", "refusal");
    expect(sim.requests.some((r) => r.url.hostname === "evil.test")).toBe(false);

    sim = new IlinkSimulator();
    sim.qrStatuses = [{ status: "scaned_but_redirect", redirect_host: "other.weixin.qq.com" }, { status: "wait" }];
    const good = build();
    await good.account.initialize();
    await link(good.account);
    await until(() => sim.requests.some((r) => r.url.hostname === "other.weixin.qq.com"), "follow redirect");
    expect(good.account.api.baseUrl).toBe("https://other.weixin.qq.com");
  });
});

describe("expiry and refresh", () => {
  test("an expired code is refreshed inside the same session with a new generation", async () => {
    sim.qrStatuses = [{ status: "expired" }, { status: "wait" }];
    const { account } = build();
    await account.initialize();
    const started = await link(account);
    await until(async () => ((await account.linkStatus()).challenge as { generation: number } | undefined)?.generation === 1, "refresh");
    const status = await account.linkStatus();
    expect(status.sessionId).toBe(started.sessionId);
    expect((status.challenge as { qrCodeDataUrl: string }).qrCodeDataUrl).toMatch(/^data:image\/png/);
  });

  test(`after ${MAX_QR_REFRESHES} refreshes the link ends as wechat_qr_expired`, async () => {
    sim.qrStatuses = [{ status: "expired" }];
    const { account } = build();
    await account.initialize();
    await link(account);
    await until(async () => (await account.linkStatus()).authorizationError === "wechat_qr_expired", "final expiry");
    expect(sim.requests.filter((r) => r.url.pathname.endsWith("get_bot_qrcode"))).toHaveLength(1 + MAX_QR_REFRESHES);
    expect(account.isLinked).toBe(false);
  });

  test("the session deadline ends a link whatever the provider says", async () => {
    sim.qrStatuses = [{ status: "wait" }];
    const { account } = build();
    await account.initialize();
    const started = await link(account);
    clock = started.sessionExpiresAt + 1;
    expect(await account.linkStatus()).toMatchObject({ linked: false, linking: false, authorizationError: "wechat_qr_expired" });
    await expect(account.finishLink(started.sessionId)).rejects.toThrow("no longer active");
  });

  test("a code past its own lifetime is not shown, the session stays open", async () => {
    sim.qrStatuses = [{ status: "wait" }];
    const { account } = build();
    await account.initialize();
    const started = await link(account);
    clock = started.expiresAt + 1;
    const status = await account.linkStatus();
    expect(status.linking).toBe(true);
    expect((status.challenge as { qrCodeDataUrl: string | null }).qrCodeDataUrl).toBeNull();
  });
});

describe("cancel", () => {
  test("cancelling stops the approval and matches only its own session", async () => {
    sim.qrStatuses = [{ status: "wait" }];
    const { account } = build();
    await account.initialize();
    const started = await link(account);
    expect(await account.cancelLink("someone-else")).toEqual({ cancelled: false });
    expect(await account.cancelLink(started.sessionId)).toEqual({ cancelled: true });
    expect((await account.linkStatus()).linking).toBe(false);
    const polls = sim.requests.length;
    await Bun.sleep(40);
    expect(sim.requests.length).toBe(polls);
  });

  test("cancelling a re-scan keeps the existing credentials and receive loop", async () => {
    const { account, store } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "link");
    events.length = 0;
    sim.qrStatuses = [{ status: "wait" }];
    const again = await link(account);
    await account.cancelLink(again.sessionId);
    expect(events).toEqual([]);
    expect(account.isLinked).toBe(true);
    expect((await store.readAccount()).status).toBe("ok");
    expect(await account.linkStatus()).toMatchObject({ linked: true, linking: false });
  });

  test("while re-scanning, the account is not reported linked until the new scan is confirmed", async () => {
    const { account } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "link");
    sim.qrStatuses = [{ status: "wait" }];
    await link(account);
    expect((await account.linkStatus()).linked).toBe(false);
  });
});

describe("restart and recovery", () => {
  test("credentials survive a restart and receiving resumes without a scan", async () => {
    const first = build();
    await first.account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(first.account);
    await until(() => first.account.isLinked, "link");
    events.length = 0;

    const second = build();
    await second.account.initialize();
    expect(second.account.isLinked).toBe(true);
    expect(second.account.status().state).toBe("bootstrapping");
    expect(events).toEqual(["start"]);
    expect(second.account.api.baseUrl).toBe("https://acct.weixin.qq.com");
  });

  test("a damaged account file means not linked, with no crash", async () => {
    const { account, store } = build();
    await account.initialize();
    await store.writeJson("account.json", { version: 1, botToken: "x" });
    const again = build();
    await again.account.initialize();
    expect(again.account.status()).toMatchObject({ state: "needs_pairing", reason: "not_linked" });
    expect(events).toEqual([]);
  });

  test("a cooldown that outlives the restart keeps the account paused", async () => {
    const first = build();
    await first.account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(first.account);
    await until(() => first.account.isLinked, "link");
    await first.account.reportSessionExpired();
    const second = build();
    await second.account.initialize();
    expect(second.account.status()).toMatchObject({ state: "needs_pairing", reason: "session_expired" });
    expect(second.account.canSend).toBe(false);
    // Even once the hour is up, nothing resumes by itself: the probe decides.
    clock += SESSION_COOLDOWN_MS + 1;
    const startsBefore = events.filter((event) => event === "start").length;
    const third = build();
    await third.account.initialize();
    expect(third.account.status()).toMatchObject({ state: "needs_pairing", reason: "session_expired" });
    expect(third.account.probeDueIn()).toBe(0);
    expect(third.account.canSend).toBe(false);
    // Receiving did not start on its own.
    expect(events.filter((event) => event === "start")).toHaveLength(startsBefore);
    await third.account.resumeAfterCooldown();
    expect(third.account.status().state).toBe("bootstrapping");
    expect(third.account.canSend).toBe(true);
    expect(third.account.probeDueIn()).toBeNull();
  });
});

describe("session expiry", () => {
  const linked = async () => {
    const built = build();
    await built.account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(built.account);
    await until(() => built.account.isLinked, "link");
    events.length = 0;
    return built;
  };

  test("expiry stops receiving, cools down for an hour and blocks sending", async () => {
    const { account, store } = await linked();
    await account.reportSessionExpired();
    expect(events).toEqual(["stop"]);
    expect(account.status()).toMatchObject({ state: "needs_pairing", reason: "session_expired" });
    expect(account.canSend).toBe(false);
    expect(account.inCooldown()).toBe(true);
    const saved = await store.readAccount();
    expect(saved.status === "ok" && Date.parse(saved.value.pausedUntil!)).toBe(clock + SESSION_COOLDOWN_MS);
    clock += SESSION_COOLDOWN_MS + 1;
    expect(account.inCooldown()).toBe(false);
  });

  test("a successful probe resumes", async () => {
    const { account } = await linked();
    await account.reportSessionExpired();
    clock += SESSION_COOLDOWN_MS + 1;
    await account.resumeAfterCooldown();
    expect(events).toEqual(["stop", "start"]);
    expect(account.status().state).toBe("bootstrapping");
    expect(account.canSend).toBe(true);
  });

  test("a failed probe discards credentials and cursor", async () => {
    const { account, store } = await linked();
    await store.writeCursor("buf");
    await account.reportSessionExpired();
    await account.discardCredentials();
    expect(account.isLinked).toBe(false);
    expect((await store.readAccount()).status).toBe("missing");
    expect((await store.readCursor()).status).toBe("missing");
    expect(account.status()).toMatchObject({ state: "needs_pairing", reason: "session_expired" });
  });

  test("a new scan during the cooldown replaces the credentials and cancels it", async () => {
    const { account } = await linked();
    await account.reportSessionExpired();
    sim.account = { ...sim.account, botToken: "fresh-token" };
    sim.qrStatuses = [{ status: "confirmed" }];
    await account.startLink();
    await account.finishLink("session-1");
    await until(() => !account.inCooldown() && account.canSend, "fresh link");
    expect(account.status().state).toBe("bootstrapping");
  });
});

describe("status reports", () => {
  test("poll success moves bootstrapping to ready, failure to recovering, success back", async () => {
    const { account } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "link");
    account.reportPollOk();
    expect(account.status()).toMatchObject({ state: "ready", consecutiveFailures: 0, lastPollOkAt: new Date(clock).toISOString() });
    account.reportPollFailure();
    account.reportPollFailure();
    expect(account.status()).toMatchObject({ state: "recovering", consecutiveFailures: 2 });
    expect(account.canSend).toBe(true);
    account.reportPollOk();
    expect(account.status().state).toBe("ready");
  });

  test("backlog is entered only from ready, left only from backlogged, and still allows sending", async () => {
    const { account } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "link");
    account.reportBacklog(true);
    expect(account.status().state).toBe("bootstrapping");
    account.reportPollOk();
    account.reportBacklog(true);
    expect(account.status().state).toBe("backlogged");
    expect(account.canSend).toBe(true);
    account.reportBacklog(false);
    expect(account.status().state).toBe("ready");
  });

  test("the Bot-visible status exposes no secret, identifier or cursor", async () => {
    const { account, store } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "link");
    await store.writeCursor("secret-cursor-value");
    await account.peers.observe({ peerId: "owner1@im.wechat", isAccountOwner: true, at: new Date(clock), contextToken: "ctx-secret" });
    const text = JSON.stringify(account.status());
    for (const secret of [sim.account.botToken, "secret-cursor-value", "ctx-secret", "owner1@im.wechat", "bot1@im.bot", sim.qr.qrcode]) expect(text).not.toContain(secret);
    expect(account.status()).toMatchObject({ account: "…bot".slice(0, 1) + "bot1@im.bot".slice(-4), queueLength: 3, dropped: { group: 1, self: 0, empty: 2, duplicate: 0 } });
  });

  test("the reply window reflects only the owner and closes with the cooldown", async () => {
    const { account } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "link");
    await account.peers.observe({ peerId: "owner1@im.wechat", isAccountOwner: true, at: new Date(clock), contextToken: "c" });
    expect(account.status().replyWindow.open).toBe(true);
    await account.reportSessionExpired();
    expect(account.status().replyWindow.open).toBe(false);
  });
});

describe("removal", () => {
  test("removeAccount stops receiving, says goodbye best-effort, and empties the state directory", async () => {
    const { account, store } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "confirmed" }];
    await link(account);
    await until(() => account.isLinked, "link");
    sim.failNext("ilink/bot/msg/notifystop", 1);
    expect(await account.removeAccount()).toEqual({ removed: true });
    expect(await readdir(store.directory)).toEqual([]);
    expect(account.isLinked).toBe(false);
    expect(events).toContain("stop");
    expect(sim.requests.some((r) => r.url.pathname.endsWith("notifystop"))).toBe(true);
  });

  test("a closed connector refuses further link work", async () => {
    const { account } = build();
    await account.initialize();
    await account.close();
    await expect(account.startLink()).rejects.toThrow("shutting down");
  });

  test("the state directory never contains the QR payload", async () => {
    const { account, store } = build();
    await account.initialize();
    sim.qrStatuses = [{ status: "wait" }];
    await link(account);
    for (const name of await readdir(store.directory)) {
      const path = store.path(name);
      if ((await stat(path)).isFile()) expect(await readFile(path, "utf8")).not.toContain(sim.qr.content);
    }
  });
});
