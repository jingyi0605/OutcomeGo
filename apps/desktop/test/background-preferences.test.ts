import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundPreferences, shouldHideWindow, shouldStopOnQuit } from "../src/main/background-preferences";

test.each([
  ["darwin", false, true], ["win32", false, true], ["linux", false, false],
  ["darwin", true, false], ["win32", true, false], ["linux", true, false],
] as const)("close on %s with quitting=%s hides=%s", (platform, quitting, hidden) => {
  expect(shouldHideWindow(platform, quitting)).toBe(hidden);
});

test("defaults to keeping services running and persists concurrent preference changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-background-"));
  const file = join(directory, "background-preferences.json");
  try {
    const store = new BackgroundPreferences(file);
    expect(await store.get()).toEqual({ warnedOnClose: false, stopServiceOnQuit: false });
    await Promise.all([store.set({ warnedOnClose: true }), store.set({ stopServiceOnQuit: true })]);
    expect(await new BackgroundPreferences(file).get()).toEqual({ warnedOnClose: true, stopServiceOnQuit: true });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("only an explicit quit while connected locally can stop the service", () => {
  expect(shouldStopOnQuit(true, true, true)).toBe(true);
  expect(shouldStopOnQuit(false, true, true)).toBe(false);
  expect(shouldStopOnQuit(true, false, true)).toBe(false);
  expect(shouldStopOnQuit(true, true, false)).toBe(false);
});
