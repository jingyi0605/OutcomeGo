/**
 * Shared interface-language contract.
 *
 * Every client (desktop, iOS, Android, CLI, web) resolves the interface language
 * through this module so that persisted values, fallbacks, and settings entries
 * stay identical across platforms.
 */

export const DEFAULT_LOCALE = "en-US" as const;

export const LOCALE_OPTIONS = [
  { locale: "en-US", label: "English" },
  { locale: "zh-CN", label: "简体中文" },
] as const;

export const SUPPORTED_LOCALES = LOCALE_OPTIONS.map((option) => option.locale);

export type Locale = (typeof LOCALE_OPTIONS)[number]["locale"];

/**
 * Accepts partial BCP 47 tags, legacy platform aliases, and case variants, then
 * maps them onto a supported locale. Unknown languages fall back to `fallback`
 * so a missing translation never leaves the interface blank.
 */
const LANGUAGE_ALIASES: Record<string, Locale> = {
  en: "en-US",
  "en-us": "en-US",
  "en-gb": "en-US",
  "en-ca": "en-US",
  "en-au": "en-US",
  zh: "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-hans-cn": "zh-CN",
  "zh-sg": "zh-CN",
};

export const normalizeLocale = (
  value: string | null | undefined,
  fallback: Locale = DEFAULT_LOCALE
): Locale => {
  const normalized = value?.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) return fallback;
  const direct = LANGUAGE_ALIASES[normalized];
  if (direct) return direct;
  const language = normalized.split("-")[0];
  if (!language) return fallback;
  return LANGUAGE_ALIASES[language] ?? fallback;
};

export const isSupportedLocale = (value: string | null | undefined): value is Locale =>
  SUPPORTED_LOCALES.some((locale) => locale === value);

export const localeLabel = (locale: Locale): string =>
  LOCALE_OPTIONS.find((option) => option.locale === locale)?.label ?? LOCALE_OPTIONS[0].label;
