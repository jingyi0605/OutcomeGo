import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BackgroundPreferenceState } from "../renderer/lib/local-deploy-contract";

export const AUTOSTART_HIDDEN_FLAG = "--autostart-hidden";

export const supportsTray = (platform: NodeJS.Platform) =>
  platform === "darwin" || platform === "win32";
export const shouldHideWindow = (platform: NodeJS.Platform, quitting: boolean) =>
  supportsTray(platform) && !quitting;
export const shouldStopOnQuit = (explicit: boolean, enabled: boolean, local: boolean) =>
  explicit && enabled && local;

export const isAutostartHiddenLaunch = (
  argv: readonly string[] = process.argv,
  wasOpenedAsHidden = false
): boolean => wasOpenedAsHidden || argv.includes(AUTOSTART_HIDDEN_FLAG);

export interface LoginItemController {
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    openAsHidden?: boolean;
    args?: string[];
  }): void;
}

export const applyLoginItemSettings = (
  controller: LoginItemController,
  prefs: Pick<BackgroundPreferenceState, "launchAtLogin" | "launchHidden">,
  platform: NodeJS.Platform = process.platform
): void => {
  if (!supportsTray(platform)) return;
  const openAtLogin = Boolean(prefs.launchAtLogin);
  const hidden = openAtLogin && Boolean(prefs.launchHidden);
  if (platform === "darwin") {
    controller.setLoginItemSettings({
      openAtLogin,
      openAsHidden: hidden,
      args: hidden ? [AUTOSTART_HIDDEN_FLAG] : [],
    });
  } else {
    controller.setLoginItemSettings({
      openAtLogin,
      args: hidden ? [AUTOSTART_HIDDEN_FLAG] : [],
    });
  }
};

export class BackgroundPreferences {
  private current: BackgroundPreferenceState = {
    warnedOnClose: false,
    stopServiceOnQuit: false,
    launchAtLogin: false,
    launchHidden: true,
  };
  private pending: Promise<unknown>;

  constructor(private readonly path: string) {
    this.pending = readFile(path, "utf8")
      .then((contents) => {
        const saved = JSON.parse(contents);
        if (saved?.version !== 1) return;
        this.current = {
          warnedOnClose: saved.warnedOnClose === true,
          stopServiceOnQuit: saved.stopServiceOnQuit === true,
          launchAtLogin: saved.launchAtLogin === true,
          launchHidden: typeof saved.launchHidden === "boolean" ? saved.launchHidden : true,
        };
      })
      .catch(() => undefined);
  }

  view(): BackgroundPreferenceState {
    return { ...this.current };
  }

  async get(): Promise<BackgroundPreferenceState> {
    await this.pending;
    return this.view();
  }

  set(values: Partial<BackgroundPreferenceState>): Promise<BackgroundPreferenceState> {
    const update = this.pending.then(async () => {
      const next: BackgroundPreferenceState = { ...this.current, ...values };
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
