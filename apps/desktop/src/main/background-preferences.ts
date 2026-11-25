import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const supportsTray = (platform: NodeJS.Platform) => platform === "darwin" || platform === "win32";
export const shouldHideWindow = (platform: NodeJS.Platform, quitting: boolean) => supportsTray(platform) && !quitting;
export const shouldStopOnQuit = (explicit: boolean, enabled: boolean, local: boolean) => explicit && enabled && local;

interface Preferences {
  warnedOnClose: boolean;
  stopServiceOnQuit: boolean;
}

export class BackgroundPreferences {
  private current: Preferences = { warnedOnClose: false, stopServiceOnQuit: false };
  private pending: Promise<unknown>;
  constructor(private readonly path: string) {
    this.pending = readFile(path, "utf8").then(contents => {
      const saved = JSON.parse(contents);
      if (saved?.version !== 1) return;
      this.current = { warnedOnClose: saved.warnedOnClose === true, stopServiceOnQuit: saved.stopServiceOnQuit === true };
    }).catch(() => undefined);
  }

  view() { return { ...this.current }; }

  async get() { await this.pending; return this.view(); }

  set(values: Partial<Preferences>) {
    const update = this.pending.then(async () => {
      const next = { ...this.current, ...values };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, ...next }), { mode: 0o600 });
      await rename(temporary, this.path);
      this.current = next;
      return this.view();
    });
    this.pending = update.catch(() => undefined);
    return update;
  }
}
