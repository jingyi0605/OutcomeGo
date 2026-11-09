import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LOCALE,
  LOCALE_OPTIONS,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "../src/localization";

describe("localization contract", () => {
  test("keeps the supported locale registry stable", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en-US", "zh-CN"]);
    expect(LOCALE_OPTIONS.map((option) => option.locale)).toEqual([...SUPPORTED_LOCALES]);
  });

  test("normalizes common OS and persisted locale values", () => {
    expect(normalizeLocale("en")).toBe("en-US");
    expect(normalizeLocale("ZH-hans-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh")).toBe("zh-CN");
  });

  test("falls back to English for invalid values", () => {
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("fr-FR", "zh-CN")).toBe("zh-CN");
  });
});
