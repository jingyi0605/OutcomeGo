import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WechatAccount } from "../../account";
import { WechatApi } from "../../api";
import { JournalStore } from "../../journal";
import { WechatMedia } from "../../media";
import { PeerBook } from "../../peers";
import { ReceiveService, type ReceiveTiming } from "../../receive";
import { Spool } from "../../spool";
import { StateStore } from "../../state";
import { IlinkSimulator } from "./ilink-simulator";

export const FAST: Partial<ReceiveTiming> = { retryMs: 5, slowRetryMs: 20, backlogPollMs: 10, pollTimeoutMs: 200, pollSlackMs: 50, probeRetryMs: 30 };

/** Resolves once `done` holds, polling briefly. Fails loudly instead of hanging. */
export const until = async (done: () => boolean | Promise<boolean>, label: string, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await done()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
};

export interface Connector {
  store: StateStore;
  api: WechatApi;
  spool: Spool;
  journal: JournalStore;
  media: WechatMedia;
  peers: PeerBook;
  receive: ReceiveService;
  account: WechatAccount;
  /** Stops everything without removing state, as a crash or a restart would leave it. */
  stop(): Promise<void>;
}

export interface Hooks {
  /** Wrap the spool's append to inject a failure. */
  beforeAppend?: (count: number) => void;
  beforeCursorWrite?: () => void;
  beforeJournalClear?: () => void;
  beforeJournalWrite?: () => void;
}

export interface World {
  root: string;
  stateDirectory: string;
  clock: { now: number };
  sim: IlinkSimulator;
  /** Starts a connector on the shared state directory, as if the process had just launched. */
  start(options?: { hooks?: Hooks; link?: boolean; timing?: Partial<ReceiveTiming> }): Promise<Connector>;
  cleanup(): Promise<void>;
}

export async function createWorld(): Promise<World> {
  const root = await mkdtemp(join(tmpdir(), "wechat-world-"));
  const stateDirectory = join(root, "state");
  const sim = new IlinkSimulator();
  const clock = { now: Date.parse("2026-11-16T08:00:00.000Z") };
  const running: Connector[] = [];

  return {
    root,
    stateDirectory,
    clock,
    sim,
    async start(options = {}) {
      const store = new StateStore(stateDirectory);
      await store.prepare();
      const spool = await Spool.open(store);
      const hooks = options.hooks ?? {};
      let appends = 0;
      const append = spool.append.bind(spool);
      spool.append = ((...args: Parameters<typeof append>) => {
        hooks.beforeAppend?.(++appends);
        return append(...args);
      }) as typeof spool.append;
      const realStore = store;
      const writeCursor = realStore.writeCursor.bind(realStore);
      realStore.writeCursor = (async (value: string) => {
        hooks.beforeCursorWrite?.();
        return writeCursor(value);
      }) as typeof realStore.writeCursor;
      const journal = new JournalStore(store);
      const journalWrite = journal.write.bind(journal);
      journal.write = (async (...args: Parameters<typeof journalWrite>) => {
        hooks.beforeJournalWrite?.();
        return journalWrite(...args);
      }) as typeof journal.write;
      const journalClear = journal.clear.bind(journal);
      journal.clear = (async () => {
        hooks.beforeJournalClear?.();
        return journalClear();
      }) as typeof journal.clear;

      const api = new WechatApi({ fetch: sim.fetch });
      const media = new WechatMedia(store, sim.fetch);
      const peers = new PeerBook(store);
      const receive = new ReceiveService({ api, store, spool, journal, media, peers, timing: { ...FAST, ...options.timing }, now: () => new Date(clock.now) });
      const account = new WechatAccount({ api, store, peers, collaborators: receive, now: () => new Date(clock.now), sessionId: () => "session-1", statusPollDelayMs: 1 });
      receive.attach(account);
      await account.initialize();
      if (options.link) {
        sim.qrStatuses = [{ status: "confirmed" }];
        await account.startLink();
        await account.finishLink("session-1");
        await until(() => account.isLinked, "link");
      }
      const connector: Connector = {
        store, api, spool, journal, media, peers, receive, account,
        async stop() {
          await receive.close();
          await spool.close();
        },
      };
      running.push(connector);
      return connector;
    },
    async cleanup() {
      await Promise.all(running.map((connector) => connector.stop().catch(() => {})));
      await rm(root, { recursive: true, force: true });
    },
  };
}
