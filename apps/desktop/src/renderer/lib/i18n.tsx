import { LOCALE_OPTIONS, normalizeLocale, type Locale } from "@aiteamos/contracts/localization";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setCurrentLocale, translate, type TranslationValues } from "./i18n-catalog";

const STORAGE_KEY = "aiteamos.locale";
const CHANGE_EVENT = "aiteamos-locale-change";

type ContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: TranslationValues) => string;
};

const Context = createContext<ContextValue | null>(null);

const initialLocale = (): Locale => {
  if (typeof window === "undefined") return normalizeLocale(undefined);
  return normalizeLocale(window.localStorage.getItem(STORAGE_KEY) ?? window.navigator.language);
};

const writeStoredLocale = (locale: Locale) => {
  window.localStorage.setItem(STORAGE_KEY, locale);
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  // Applied during render so non-component helpers (`translateCurrent`) resolve the
  // same language as the components rendering them, even on the first paint.
  setCurrentLocale(locale);
  const setLocale = (next: Locale) => {
    const normalized = normalizeLocale(next);
    writeStoredLocale(normalized);
    setLocaleState(normalized);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: normalized }));
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    const onChange = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (typeof value === "string") setLocaleState(normalizeLocale(value));
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [locale]);
  useEffect(() => {
    // Keeps the native macOS/Windows menu in sync when a language was restored from storage.
    void window.aiteamos?.setApplicationMenuLocale?.(locale).catch(() => undefined);
  }, [locale]);
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key: string, values?: TranslationValues) => translate(locale, key, values),
    }),
    [locale]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useI18n = (): ContextValue => {
  const value = useContext(Context);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
};

export { LOCALE_OPTIONS };
