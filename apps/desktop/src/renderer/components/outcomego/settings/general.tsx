import { SettingsSelectContent } from "./select-content";
import { PrivateSettingValue } from "./private-value";
import { SmartNotificationSettings } from "./smart-notifications";
import type { BotView } from "@outcomego/contracts";
import { Copy, Settings } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { signOut } from "../../../client/auth";
import { API_BASE } from "../../../client/http";
import { api } from "../../../client/outcomego-api";
import { ModelOverrideSelect } from "./model-override-select";
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
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../../ui/dialog";
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

const UNSET_ROLE_BOT = "__unset__";

function OutcomeRoleSettings({ features }: { features: ReturnType<typeof useFeatureSettings> }) {
  const { locale, t } = useI18n();
  const [bots, setBots] = useState<BotView[]>([]);
  const [botsLoaded, setBotsLoaded] = useState(false);
  const [envDraft, setEnvDraft] = useState(features.environmentNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnvDraft(features.environmentNote ?? "");
  }, [features.environmentNote]);

  useEffect(() => {
    let active = true;
    api
      .bootstrap()
      .then((res) => {
        if (active) {
          setBots(res.bots.filter((b) => b.status === "active"));
          setBotsLoaded(true);
        }
      })
      .catch(() => {
        if (active) setBotsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const botUnavailable = (id: string | null | undefined) =>
    Boolean(id && botsLoaded && !bots.some((b) => b.id === id));

  const saveField = async (patch: Parameters<typeof features.update>[0]) => {
    setSaving(true);
    setError(null);
    try {
      await features.update(patch);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("Couldn't save this setting. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="space-y-1.5 pr-8">
        <DialogTitle>{t("Goal management settings")}</DialogTitle>
        <DialogDescription>{t("Outcome roles & environment")}</DialogDescription>
      </header>
      <SettingsGroup className="bot-scrollbar min-h-0 min-w-0 overflow-y-auto">
        <SettingsRow
          stackControl
          title={t("Planner bot")}
          description={t("Optional. Recommended: run as your primary bot identity with a stronger independent model.")}
          control={
            <div className="ml-auto grid w-[220px] grid-cols-1 gap-1.5">
              <Select
                disabled={saving}
                value={features.plannerBotId ?? UNSET_ROLE_BOT}
                onValueChange={(value) =>
                  void saveField({ plannerBotId: value === UNSET_ROLE_BOT ? null : value })
                }
              >
                <SelectTrigger aria-label={t("Planner bot")} className={`${settingsSelect} w-full [&>span:first-child]:truncate`}>
                  <SelectValue />
                </SelectTrigger>
                <SettingsSelectContent>
                  <SelectItem value={UNSET_ROLE_BOT}>{t("Unset (default workflow)")}</SelectItem>
                  {bots.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SettingsSelectContent>
              </Select>
              {botUnavailable(features.plannerBotId) && (
                <p role="alert" className="text-[11px] text-amber-600 dark:text-amber-400">
                  {t("Configured planner bot is inactive or missing; falling back until updated.")}
                </p>
              )}
            </div>
          }
        />
        <SettingsRow
          stackControl
          title={t("Planner independent model")}
          description={t("Used only for planning and replanning turns.")}
          control={
            <ModelOverrideSelect
              ariaLabel={t("Planner independent model")}
              className="ml-auto"
              defaultLabel={t("Use bot or global model")}
              value={features.plannerModel ?? null}
              disabled={saving}
              onChange={(model) => saveField({ plannerModel: model })}
            />
          }
        />
        <SettingsRow
          stackControl
          title={t("Reviewer bot")}
          description={t("Optional. Recommended: use an independent strong model to verify deliverables and prepare preliminary review summaries.")}
          control={
            <div className="ml-auto grid w-[220px] grid-cols-1 gap-1.5">
              <Select
                disabled={saving}
                value={features.reviewerBotId ?? UNSET_ROLE_BOT}
                onValueChange={(value) =>
                  void saveField({ reviewerBotId: value === UNSET_ROLE_BOT ? null : value })
                }
              >
                <SelectTrigger aria-label={t("Reviewer bot")} className={`${settingsSelect} w-full [&>span:first-child]:truncate`}>
                  <SelectValue />
                </SelectTrigger>
                <SettingsSelectContent>
                  <SelectItem value={UNSET_ROLE_BOT}>{t("Unset (one-shot prereview)")}</SelectItem>
                  {bots.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SettingsSelectContent>
              </Select>
              {botUnavailable(features.reviewerBotId) && (
                <p role="alert" className="text-[11px] text-amber-600 dark:text-amber-400">
                  {t("Configured reviewer bot is inactive or missing; falling back until updated.")}
                </p>
              )}
            </div>
          }
        />
        <SettingsRow
          stackControl
          title={t("Reviewer independent model")}
          description={t("Used only for task-level reviews and preliminary review turns.")}
          control={
            <ModelOverrideSelect
              ariaLabel={t("Reviewer independent model")}
              className="ml-auto"
              defaultLabel={t("Use bot or global model")}
              value={features.reviewerModel ?? null}
              disabled={saving}
              onChange={(model) => saveField({ reviewerModel: model })}
            />
          }
        />
        <SettingsRow
          stackControl
          className="flex-col items-stretch gap-2"
          title={t("Environment note")}
          description={t(
            "Shared only with planner and reviewer turns (up to 8,000 characters). List accounts, services, project paths, bot specialties, preferences, and restricted zones. Also describe each bot's strengths in its Description. Never store passwords, tokens, or secrets here."
          )}
          control={
            <div className="grid w-full gap-2">
              <textarea
                aria-label={t("Environment note")}
                className="min-h-24 w-full rounded-[7px] border border-[#d9d9d9] bg-transparent px-2.5 py-2 text-[13px] outline-none focus:border-ring dark:border-[#292929]"
                maxLength={8_000}
                disabled={saving}
                value={envDraft}
                onChange={(e) => setEnvDraft(e.target.value)}
                placeholder={t("Paths, accounts/services (no secrets), bot strengths, preferences, and restricted zones…")}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground-secondary">
                <span>
                  {envDraft.length} / 8000
                  {features.updatedAt
                    ? ` · ${t("Updated")} ${new Date(features.updatedAt).toLocaleString(locale)}`
                    : ""}
                </span>
                <button
                  type="button"
                  disabled={saving || envDraft.trim() === (features.environmentNote ?? "").trim()}
                  className={settingsSecondaryButton}
                  onClick={() => void saveField({ environmentNote: envDraft.trim() ? envDraft.trim() : null })}
                >
                  {saving ? t("Saving…") : t("Save note")}
                </button>
              </div>
            </div>
          }
        />
        {error && (
          <p role="alert" className="px-3 pb-3 text-xs text-destructive">
            {error}
          </p>
        )}
      </SettingsGroup>
    </>
  );
}

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
            <div className="flex items-center gap-2.5">
              {features.loaded && features.outcomesEnabled && (
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("Goal management settings")}
                      title={t("Goal management settings")}
                      className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-black/[0.06] text-foreground outline-none transition-colors hover:bg-black/[0.1] focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-white/[0.09] dark:hover:bg-white/[0.13]"
                    >
                      <Settings aria-hidden="true" className="size-4" strokeWidth={1.75} />
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[660px] grid-rows-[auto_minmax(0,1fr)] gap-3">
                    <OutcomeRoleSettings features={features} />
                  </DialogContent>
                </Dialog>
              )}
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
            </div>
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
