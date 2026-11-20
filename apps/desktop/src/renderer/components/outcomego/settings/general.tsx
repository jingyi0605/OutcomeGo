import { SettingsSelectContent } from "./select-content";
import { PrivateSettingValue } from "./private-value";
import { SmartNotificationSettings } from "./smart-notifications";
import { Copy } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { signOut } from "../../../client/auth";
import { API_BASE } from "../../../client/http";
import { useAuthSession } from "../../../hooks/use-auth-session";
import { useFeatureSettings } from "../../../hooks/use-feature-settings";
import { accountPresentation } from "../../../lib/account";
import { LOCALE_OPTIONS, useI18n } from "../../../lib/i18n";
import {
  normalizeThemePreference,
  readThemePreference,
  setThemePreference,
  type ThemePreference,
} from "../../../lib/theme";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import type { MicrophoneControlProps } from "./microphone";
import {
  InteractiveSwitch,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  SkeletonControl,
  settingsSelect,
  settingsSecondaryButton,
} from "./ui";
import { MicrophoneAccessSkeleton } from "./microphone-skeleton";
const MicrophoneSettings = lazy(() =>
  import("./microphone").then((module) => ({ default: module.MicrophoneSettings }))
);
const BotDockSettings = lazy(() => import("./bot-dock-settings"));
const TimeZoneSettings = lazy(() =>
  import("./time-zone").then((module) => ({ default: module.TimeZoneSettings }))
);

function MicrophoneSkeleton() {
  return (
    <>
      <SectionLabel>System</SectionLabel>
      <SettingsGroup>
        <SettingsRow stackControl title="Microphone" control={<SkeletonControl width={124} />} />
        <SettingsRow
          stackControl
          title="Microphone access"
          control={<MicrophoneAccessSkeleton />}
        />
      </SettingsGroup>
    </>
  );
}

// Reuse the selector already loaded for Theme; device discovery stays lazy.
// The render prop is called as a function, so the translated label lives in a real
// component element instead of a hook inside the caller's render.
const MicrophoneControl = ({ options, ...props }: MicrophoneControlProps) => {
  const { t } = useI18n();
  return (
    <Select {...props}>
      <SelectTrigger
        aria-label={t("Microphone")}
        className={`${settingsSelect} w-auto max-w-[220px] [&>span]:truncate`}
      >
        <SelectValue />
      </SelectTrigger>
      <SettingsSelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SettingsSelectContent>
    </Select>
  );
};

export const renderMicrophoneControl = (props: MicrophoneControlProps) => (
  <MicrophoneControl {...props} />
);

/** Optional modules, each off until the owner switches it on. */
export function FeatureSettings() {
  const { t } = useI18n();
  const features = useFeatureSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goalLabel = t("Enable goal management for bots");
  const streamLabel = t("Stream bot replies");
  return (
    <>
      <SectionLabel>{t("Features")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          title={goalLabel}
          description={t(
            "Shows the Outcomes entry and the idea capture button, and lets your bots register and manage goals in conversation."
          )}
          control={
            <InteractiveSwitch
              label={goalLabel}
              checked={features.outcomesEnabled}
              disabled={!features.loaded || saving}
              onChange={(value) => {
                setSaving(true);
                setError(null);
                features
                  .update({ outcomesEnabled: value })
                  .catch(() => setError(t("Couldn't save this setting. Try again.")))
                  .finally(() => setSaving(false));
              }}
            />
          }
        />
        <SettingsRow
          title={streamLabel}
          control={
            <InteractiveSwitch
              label={streamLabel}
              checked={features.streamBotReplies}
              disabled={!features.loaded || saving}
              onChange={(value) => {
                setSaving(true);
                setError(null);
                features
                  .update({ streamBotReplies: value })
                  .catch(() => setError(t("Couldn't save this setting. Try again.")))
                  .finally(() => setSaving(false));
              }}
            />
          }
        />
        {window.outcomego?.botDock && (
          <Suspense fallback={null}>
            <BotDockSettings />
          </Suspense>
        )}
        {(error || features.failed) && (
          <p role="alert" className="pb-3 text-xs text-destructive">
            {error ?? t("Couldn’t load this setting.")}{" "}
            {features.failed && (
              <button className="underline" onClick={features.retry} type="button">
                {t("Retry")}
              </button>
            )}
          </p>
        )}
      </SettingsGroup>
    </>
  );
}

export default function GeneralSettings() {
  const { locale, setLocale, t } = useI18n();
  const auth = useAuthSession();
  const account = accountPresentation(auth.user, auth.mode);
  const [signingOut, setSigningOut] = useState(false);
  const [accountCopied, setAccountCopied] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  const changeTheme = (value: string) => {
    const preference = normalizeThemePreference(value);
    setTheme(preference);
    setThemePreference(preference);
  };

  const copyAccount = async () => {
    if (!account.copyValue) return;
    await navigator.clipboard.writeText(account.copyValue);
    setAccountCopied(true);
    window.setTimeout(() => setAccountCopied(false), 1_500);
  };

  const logOut = async () => {
    if (auth.mode === "disabled" || signingOut) return;
    setSigningOut(true);
    await signOut();
  };

  return (
    <>
      <SectionLabel>{t("Account")}</SectionLabel>
      <SettingsGroup className="px-3.5">
        <div className="flex min-h-[72px] flex-wrap items-center gap-3 py-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-black/[0.045] text-[13px] font-medium text-foreground-secondary ring-1 ring-black/[0.035] dark:bg-white/[0.07] dark:ring-white/[0.06]">
            {account.initials}
          </span>
          <div className="min-w-[100px] flex-1">
            <div className="truncate text-[13px] font-medium">{account.name}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-foreground-secondary">
              <span className="truncate">{t(account.detail)}</span>
              {account.copyValue ? (
                <button
                  aria-label={accountCopied ? t("Account name copied") : t("Copy account name")}
                  className="grid size-5 shrink-0 place-items-center rounded text-foreground-tertiary hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]"
                  onClick={() => void copyAccount()}
                  title={accountCopied ? t("Copied") : t("Copy account name")}
                  type="button"
                >
                  <Copy className="size-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-[12px] leading-4 text-foreground-secondary">
              <span className="shrink-0">{t("Endpoint")}</span>
              <PrivateSettingValue value={API_BASE} label={t("server endpoint")} />
            </div>
          </div>
          <button
            className={`${settingsSecondaryButton} ml-auto`}
            disabled={auth.mode === "disabled" || signingOut}
            onClick={() => void logOut()}
            type="button"
          >
            {signingOut ? t("Signing Out…") : t("Sign Out")}
          </button>
        </div>
      </SettingsGroup>

      <Suspense fallback={null}>
        <TimeZoneSettings />
      </Suspense>

      <SmartNotificationSettings />

      <FeatureSettings />

      <SectionLabel>{t("Appearance")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          title={t("Language")}
          description={t("Choose the language used by the application.")}
          control={
            <Select onValueChange={(value) => setLocale(value as typeof locale)} value={locale}>
              <SelectTrigger aria-label={t("Language")} className={`${settingsSelect} w-auto`}>
                <SelectValue />
              </SelectTrigger>
              <SettingsSelectContent>
                {LOCALE_OPTIONS.map((option) => (
                  <SelectItem key={option.locale} value={option.locale}>
                    {t(option.label)}
                  </SelectItem>
                ))}
              </SettingsSelectContent>
            </Select>
          }
        />
        <SettingsRow
          anchors={["theme"]}
          control={
            <Select onValueChange={changeTheme} value={theme}>
              <SelectTrigger aria-label={t("Theme")} className={`${settingsSelect} w-auto`}>
                <SelectValue />
              </SelectTrigger>
              <SettingsSelectContent>
                <SelectItem value="system">{t("Follow System")}</SelectItem>
                <SelectItem value="light">{t("Light")}</SelectItem>
                <SelectItem value="dark">{t("Dark")}</SelectItem>
              </SettingsSelectContent>
            </Select>
          }
          title={t("Theme")}
        />
      </SettingsGroup>

      <Suspense fallback={<MicrophoneSkeleton />}>
        <MicrophoneSettings renderControl={renderMicrophoneControl} />
      </Suspense>
    </>
  );
}
