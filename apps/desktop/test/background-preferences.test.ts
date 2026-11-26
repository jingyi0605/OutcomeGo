import { expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyLoginItemSettings,
  AUTOSTART_HIDDEN_FLAG,
  BackgroundPreferences,
  isAutostartHiddenLaunch,
  shouldHideWindow,
  shouldStopOnQuit,
} from "../src/main/background-preferences";

test.each([
  ["darwin", false, true], ["win32", false, true], ["linux", false, false],
  ["darwin", true, false], ["win32", true, false], ["linux", true, false],
] as const)("close on %s with quitting=%s hides=%s", (platform, quitting, hidden) => {
  expect(shouldHideWindow(platform, quitting)).toBe(hidden);
});

test("defaults to keeping services running, migrates legacy preferences, and persists concurrent changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-background-"));
  const file = join(directory, "background-preferences.json");
  try {
    const store = new BackgroundPreferences(file);
    expect(await store.get()).toEqual({
      warnedOnClose: false,
      stopServiceOnQuit: false,
      launchAtLogin: false,
      launchHidden: true,
    });
    await Promise.all([
      store.set({ warnedOnClose: true }),
      store.set({ stopServiceOnQuit: true }),
      store.set({ launchAtLogin: true, launchHidden: false }),
    ]);
    expect(await new BackgroundPreferences(file).get()).toEqual({
      warnedOnClose: true,
      stopServiceOnQuit: true,
      launchAtLogin: true,
      launchHidden: false,
    });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1 });

    // Legacy v1 file without launchAtLogin / launchHidden migrates cleanly
    writeFileSync(file, JSON.stringify({ version: 1, warnedOnClose: true, stopServiceOnQuit: false }));
    expect(await new BackgroundPreferences(file).get()).toEqual({
      warnedOnClose: true,
      stopServiceOnQuit: false,
      launchAtLogin: false,
      launchHidden: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("applies Electron login item settings and detects autostart-hidden launches", () => {
  const setLoginItemSettings = mock(() => undefined);
  applyLoginItemSettings({ setLoginItemSettings }, { launchAtLogin: true, launchHidden: true }, "darwin");
  expect(setLoginItemSettings).toHaveBeenLastCalledWith({
    openAtLogin: true,
    openAsHidden: true,
    args: [AUTOSTART_HIDDEN_FLAG],
  });
  applyLoginItemSettings({ setLoginItemSettings }, { launchAtLogin: true, launchHidden: true }, "win32");
  expect(setLoginItemSettings).toHaveBeenLastCalledWith({
    openAtLogin: true,
    args: [AUTOSTART_HIDDEN_FLAG],
  });
  applyLoginItemSettings({ setLoginItemSettings }, { launchAtLogin: false, launchHidden: true }, "win32");
  expect(setLoginItemSettings).toHaveBeenLastCalledWith({
    openAtLogin: false,
    args: [],
  });

  expect(isAutostartHiddenLaunch(["OutcomeGo.exe", AUTOSTART_HIDDEN_FLAG], false)).toBe(true);
  expect(isAutostartHiddenLaunch(["OutcomeGo.exe"], true)).toBe(true);
  expect(isAutostartHiddenLaunch(["OutcomeGo.exe"], false)).toBe(false);
});

test("only an explicit quit while connected locally can stop the service", () => {
  expect(shouldStopOnQuit(true, true, true)).toBe(true);
  expect(shouldStopOnQuit(false, true, true)).toBe(false);
  expect(shouldStopOnQuit(true, false, true)).toBe(false);
  expect(shouldStopOnQuit(true, true, false)).toBe(false);
});
