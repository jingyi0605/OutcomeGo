import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { isAllowedWechatUrl } from "./api";

/** On-disk format version of every state file. Anything else is set aside, never guessed at. */
export const STATE_VERSION = 1;

export interface AccountFile {
  version: typeof STATE_VERSION;
  botToken: string;
  baseUrl: string;
  ilinkBotId: string;
  /** The user who scanned the code: the account owner. */
  ilinkUserId: string;
  linkedAt: string;
  /** Cool-down end after a session expiry; no business request before it. */
  pausedUntil?: string;
}

export interface CursorFile {
  version: typeof STATE_VERSION;
  /** Opaque provider cursor, saved and sent back verbatim. */
  getUpdatesBuf: string;
}

export interface PeerRecord {
  displayName?: string;
  isAccountOwner: boolean;
  lastObservedAt: string;
  /** Reply context. Lives only here, never in a tool result. */
  contextToken?: string;
  /** When the token was received, for the reply-window check. */
  receivedAt?: string;
}

export interface ContextsFile {
  version: typeof STATE_VERSION;
  peers: Map<string, PeerRecord>;
}

export type ReadOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "missing" }
  /** Unparseable or from an unknown version. The file was moved aside, not deleted. */
  | { status: "unreadable"; reason: "corrupt" | "version" };

const text = (value: unknown, max = 4096): string | undefined =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
const instant = (value: unknown): string | undefined =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseAccount = (value: unknown): AccountFile | null => {
  const source = object(value);
  const botToken = text(source?.botToken, 4096);
  const baseUrl = text(source?.baseUrl, 512);
  const ilinkBotId = text(source?.ilinkBotId, 256);
  const ilinkUserId = text(source?.ilinkUserId, 256);
  const linkedAt = instant(source?.linkedAt);
  // A tampered base URL must not be able to receive the bot token.
  if (!botToken || !baseUrl || !isAllowedWechatUrl(baseUrl) || !ilinkBotId || !ilinkUserId || !linkedAt) return null;
  const pausedUntil = instant(source?.pausedUntil);
  return { version: STATE_VERSION, botToken, baseUrl, ilinkBotId, ilinkUserId, linkedAt, ...(pausedUntil ? { pausedUntil } : {}) };
};

const parseCursor = (value: unknown): CursorFile | null => {
  const buffer = object(value)?.getUpdatesBuf;
  return typeof buffer === "string" && buffer.length <= 65_536 ? { version: STATE_VERSION, getUpdatesBuf: buffer } : null;
};

const parseContexts = (value: unknown): ContextsFile | null => {
  const peers = object(object(value)?.peers);
  if (!peers) return null;
  const result = new Map<string, PeerRecord>();
  for (const [peerId, entry] of Object.entries(peers)) {
    const record = object(entry);
    const lastObservedAt = instant(record?.lastObservedAt);
    if (!record || !peerId || peerId.length > 256 || !lastObservedAt || typeof record.isAccountOwner !== "boolean") continue;
    const displayName = text(record.displayName, 1024);
    const contextToken = text(record.contextToken, 4096);
    const receivedAt = instant(record.receivedAt);
    result.set(peerId, {
      isAccountOwner: record.isAccountOwner,
      lastObservedAt,
      ...(displayName ? { displayName } : {}),
      // A token without its receive time cannot be window-checked, so it is not usable.
      ...(contextToken && receivedAt ? { contextToken, receivedAt } : {}),
    });
  }
  return { version: STATE_VERSION, peers: result };
};

/**
 * The connector's private state directory. Every JSON file is versioned and replaced atomically
 * (temporary file, fsync, rename, directory fsync) with mode 0600, so a kill at any instant
 * leaves the old or the new content, never a half-written file.
 */
export class StateStore {
  constructor(readonly directory: string) {}

  path(...parts: string[]): string {
    return join(this.directory, ...parts);
  }

  /** Creates the directory tree with owner-only permissions and clears stale temporary files. */
  async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(this.directory)).isDirectory()) throw new Error("WeChat state directory must be a real directory");
    await chmod(this.directory, 0o700);
    for (const name of ["tmp", "exchange/inbound", "exchange/outbound", "spool"]) {
      await mkdir(this.path(name), { recursive: true, mode: 0o700 });
    }
    // Downloads and encryptions in flight when the process died are worthless.
    for (const entry of await readdir(this.path("tmp")).catch(() => [])) await rm(this.path("tmp", entry), { recursive: true, force: true });
    for (const entry of await readdir(this.directory).catch(() => []))
      if (entry.endsWith(".tmp")) await rm(this.path(entry), { force: true });
  }

  /** Atomically replaces `name` with `value` serialized as JSON. */
  async writeJson(name: string, value: unknown): Promise<void> {
    const target = this.path(name);
    // Publish only committed names in the state directory. A reader can list
    // that directory and inspect each file while another write is in flight.
    // The private staging directory is on the same filesystem for atomic rename.
    const temporary = this.path("tmp", `${basename(name)}.${randomBytes(6).toString("hex")}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(temporary, { force: true });
      throw error;
    }
    await handle.close();
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    await this.syncDirectory(target.slice(0, target.lastIndexOf("/")));
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, constants.O_RDONLY).catch(() => undefined);
    if (!handle) return;
    await handle.sync().catch(() => {});
    await handle.close();
  }

  /** Reads and validates one file. A damaged file is renamed aside so it is kept for inspection. */
  private async readJson<T>(name: string, parse: (value: unknown) => T | null): Promise<ReadOutcome<T>> {
    let raw: string;
    try {
      raw = await readFile(this.path(name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
      throw error;
    }
    let reason: "corrupt" | "version" = "corrupt";
    try {
      const value = JSON.parse(raw) as unknown;
      if (object(value)?.version !== STATE_VERSION) reason = "version";
      else {
        const parsed = parse(value);
        if (parsed) return { status: "ok", value: parsed };
      }
    } catch {
      // Falls through to quarantine.
    }
    await rename(this.path(name), this.path(`${name}.${reason === "version" ? "unsupported" : "corrupt"}`)).catch(() => {});
    return { status: "unreadable", reason };
  }

  readAccount = () => this.readJson("account.json", parseAccount);
  writeAccount = (account: Omit<AccountFile, "version">) => this.writeJson("account.json", { version: STATE_VERSION, ...account });

  readCursor = () => this.readJson("cursor.json", parseCursor);
  writeCursor = (getUpdatesBuf: string) => this.writeJson("cursor.json", { version: STATE_VERSION, getUpdatesBuf });

  readContexts = () => this.readJson("contexts.json", parseContexts);
  writeContexts = (peers: ReadonlyMap<string, PeerRecord>) =>
    this.writeJson("contexts.json", { version: STATE_VERSION, peers: Object.fromEntries(peers) });

  async remove(name: string): Promise<void> {
    await rm(this.path(name), { force: true });
    await this.syncDirectory(this.directory);
  }

  /** Deletes everything in the state directory, leaving the empty directory itself. */
  async clear(): Promise<void> {
    for (const entry of await readdir(this.directory).catch(() => [])) await rm(this.path(entry), { recursive: true, force: true });
    await this.syncDirectory(this.directory);
  }
}
