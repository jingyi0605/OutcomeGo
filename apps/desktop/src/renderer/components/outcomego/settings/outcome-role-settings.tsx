import type { BotView } from "@outcomego/contracts";
import { useEffect, useState } from "react";
import { api } from "../../../client/outcomego-api";
import type { useFeatureSettings } from "../../../hooks/use-feature-settings";
import { useI18n } from "../../../lib/i18n";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { ModelOverrideSelect } from "./model-override-select";
import { SettingsSelectContent } from "./select-content";
import { SettingsGroup, SettingsRow, settingsSecondaryButton, settingsSelect } from "./ui";

const UNSET_ROLE_BOT = "__unset__";

export default function OutcomeRoleSettings({ features }: { features: ReturnType<typeof useFeatureSettings> }) {
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

  // In-page content of the goal-management page; it was a dialog before, so it no longer carries a dialog header or its own scroll.
  return (
    <>
      <SettingsGroup>
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
