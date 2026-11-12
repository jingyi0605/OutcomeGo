import type { Locale } from "@outcomego/contracts/localization";

/**
 * "Last opened 5 minutes ago", "yesterday", "last week": when an offline computer was
 * last connected. Returns a catalog key plus interpolation values so the caller can
 * translate it, because the relative phrase itself is locale-formatted.
 */
export function lastOpenedLocale(
  at: string | null,
  locale: Locale,
  now = Date.now()
): { key: string; values?: Record<string, string> } {
  if (!at) return { key: "Not opened yet" };
  const seconds = Math.round((Date.parse(at) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86_400],
    ["week", 604_800],
    ["month", 2_592_000],
    ["year", 31_536_000],
  ];
  let [unit, size] = steps[0]!;
  for (const step of steps) if (Math.abs(seconds) >= step[1]) [unit, size] = step;
  return {
    key: "Last opened {when}",
    values: { when: format.format(Math.round(seconds / size), unit) },
  };
}

/** Composed English text, kept for callers and tests that do not render the interface. */
export function lastOpened(at: string | null, now = Date.now()) {
  const { key, values } = lastOpenedLocale(at, "en-US", now);
  return values?.when ? key.replace("{when}", values.when) : key;
}
