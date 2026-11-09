import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "@aiteamos/contracts/localization";
import {
  missingKeys,
  setCurrentLocale,
  sourceTranslations,
  translate,
  translateCurrent,
} from "../src/renderer/lib/i18n-catalog";

describe("desktop interface catalog", () => {
  test("returns the English source for the default locale", () => {
    expect(translate(DEFAULT_LOCALE, "Save settings")).toBe("Save settings");
  });

  test("translates migrated strings for Simplified Chinese", () => {
    expect(translate("zh-CN", "Save settings")).toBe("保存设置");
    expect(translate("zh-CN", "Settings")).toBe("设置");
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
});
