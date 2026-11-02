import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";

export type SettingsLanguage = "en" | "zh";

const SETTINGS_LANGUAGE_KEY = "openteam:settings-language";

const readSettingsLanguage = (): SettingsLanguage =>
  localStorage.getItem(SETTINGS_LANGUAGE_KEY) === "zh" ? "zh" : "en";

type SettingsLanguageContextValue = {
  language: SettingsLanguage;
  setLanguage: (language: SettingsLanguage) => void;
};

const SettingsLanguageContext = createContext<SettingsLanguageContextValue | null>(null);

export function SettingsLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SettingsLanguage>(readSettingsLanguage);
  const value = useMemo(
    () => ({
      language,
      setLanguage: (next: SettingsLanguage) => {
        localStorage.setItem(SETTINGS_LANGUAGE_KEY, next);
        setLanguageState(next);
      },
    }),
    [language]
  );

  return <SettingsLanguageContext.Provider value={value}>{children}</SettingsLanguageContext.Provider>;
}

export function useSettingsLanguage() {
  const context = useContext(SettingsLanguageContext);
  if (!context) throw new Error("useSettingsLanguage must be used inside SettingsLanguageProvider");
  return context;
}

export function settingsText(language: SettingsLanguage, english: string, chinese: string) {
  return language === "zh" ? chinese : english;
}

export function SettingsLanguageSelect() {
  const { language, setLanguage } = useSettingsLanguage();
  return (
    <Select value={language} onValueChange={(value) => setLanguage(value as SettingsLanguage)}>
      <SelectTrigger
        aria-label="Settings language"
        className="h-8 w-[148px] rounded-[9px] border-black/[0.07] bg-background px-2.5 text-[12px] shadow-none dark:border-white/[0.1]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="zh">中文</SelectItem>
      </SelectContent>
    </Select>
  );
}
