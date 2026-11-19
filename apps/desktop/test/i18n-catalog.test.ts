import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "@outcomego/contracts/localization";
import {
  missingKeys,
  setCurrentLocale,
  sourceTranslations,
  translate,
  translateCurrent,
} from "../src/renderer/lib/i18n-catalog";
import { checkShortcut, SHORTCUT_LABELS } from "../src/renderer/lib/keyboard-shortcut-rules";
import { defaultShortcutBindings, SHORTCUT_ACTIONS } from "../src/renderer/lib/keyboard-shortcuts";

describe("desktop interface catalog", () => {
  test("returns the English source for the default locale", () => {
    expect(translate(DEFAULT_LOCALE, "Save settings")).toBe("Save settings");
  });

  test("translates migrated strings for Simplified Chinese", () => {
    expect(translate("zh-CN", "Save settings")).toBe("保存设置");
    expect(translate("zh-CN", "Settings")).toBe("设置");
  });

  test("translates every keyboard action, its description, and its conflict message", () => {
    const bindings = defaultShortcutBindings();
    for (const action of SHORTCUT_ACTIONS) {
      const { title, description } = SHORTCUT_LABELS[action];
      const other = action === "search" ? "settings" : "search";
      expect(translate("zh-CN", title)).not.toBe(title);
      expect(translate("zh-CN", description)).not.toBe(description);
      const conflict = checkShortcut(other, bindings[action], bindings, true);
      expect(conflict).not.toBeNull();
      expect(translate("zh-CN", conflict ?? "")).toContain(translate("zh-CN", title));
    }
  });

  test("interpolates ScreenBot shortcuts and recording labels in the selected language", () => {
    const chordHint = "Press both {modifier} keys to capture your screen and send it to a Bot.";
    expect(translate("zh-CN", chordHint, { modifier: "Command" })).toBe(
      "同时按下左右两个 Command 键即可截图并发送给机器人。"
    );
    expect(translate("en-US", chordHint, { modifier: "Command" })).toBe(
      "Press both Command keys to capture your screen and send it to a Bot."
    );
    expect(translate("zh-CN", "Press {shortcut} to capture your screen and send it to a Bot.", {
      shortcut: "Ctrl+Shift+2",
    })).toBe("按 Ctrl+Shift+2 即可截图并发送给机器人。");
    expect(translate("zh-CN", "Recording a shortcut for {action}", {
      action: translate("zh-CN", "Search"),
    })).toBe("正在为「搜索」录制快捷键");
  });

  test("falls back to English when a key has no translation", () => {
    const unsupported = "This string intentionally has no Chinese translation";
    expect(translate("zh-CN", unsupported)).toBe(unsupported);
  });

  test("interpolates values in both locales", () => {
    expect(translate("en-US", "Saved {count} items", { count: 3 })).toBe("Saved 3 items");
    expect(translate("zh-CN", "Saved {count} items", { count: 3 })).toBe("Saved 3 items");
    expect(translate("zh-CN", "Saved {count} items", { count: 3 })).not.toContain("{count}");
  });

  test("keeps unknown placeholders visible instead of dropping them", () => {
    expect(translate("zh-CN", "{name} is offline", {})).toContain("{name}");
  });

  test("reports keys that no catalog can resolve", () => {
    expect(missingKeys(["Settings", "A key nobody translated"])).toEqual([
      "A key nobody translated",
    ]);
  });

  test("never stores an empty translation", () => {
    for (const [key, value] of Object.entries(sourceTranslations)) {
      expect(key.trim().length).toBeGreaterThan(0);
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  test("helpers outside React follow the mounted locale", () => {
    setCurrentLocale("zh-CN");
    expect(translateCurrent("Save settings")).toBe("保存设置");
    expect(translateCurrent("{count} others", { count: 2 })).toBe("另外 2 个");
    setCurrentLocale(DEFAULT_LOCALE);
    expect(translateCurrent("Save settings")).toBe("Save settings");
  });

  test("stores translations for every supported non-default locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(normalizeLocale(locale)).toBe(locale);
    }
  });

  test("translates inspector Overview and Library labels for Simplified Chinese", () => {
    expect(translate("zh-CN", "Bot details")).toBe("机器人详情");
    expect(translate("zh-CN", "Overview")).toBe("简介");
    expect(translate("zh-CN", "Library")).toBe("资料库");
    expect(translate("zh-CN", "Today")).toBe("今天");
    expect(translate("zh-CN", "Load more")).toBe("加载更多");
    expect(translate(DEFAULT_LOCALE, "Overview")).toBe("Overview");
    expect(translate(DEFAULT_LOCALE, "Library")).toBe("Library");
  });
});
