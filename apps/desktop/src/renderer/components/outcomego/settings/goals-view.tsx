import { TASK_POLICY_FIELDS, type TaskPolicyField } from "@outcomego/contracts/task-policy";
import { useState, type ReactNode } from "react";
import type { useFeatureSettings } from "../../../hooks/use-feature-settings";
import { useI18n } from "../../../lib/i18n";
import { policyCopy, policyOptionLabel } from "./goal-policy-copy";
import { describePolicyField, parsePolicyInput, visibleGoalSettingsGroups, type GoalSettingsGroup } from "./goal-policy-fields";
import OutcomeRoleSettings from "./outcome-role-settings";
import { InteractiveSwitch, SectionLabel, SettingsGroup, SettingsRow, settingsInput, settingsSecondaryButton } from "./ui";

type Features = ReturnType<typeof useFeatureSettings>;
/** One entry of the metadata table; its `key` is the literal union the copy module is exhaustive over. */
type PolicyEntry = (typeof TASK_POLICY_FIELDS)[number];

/**
 * The goal-management page's content (specs/004.10 design §2.7): the master switch, planning and review, and one group per
 * policy group that exists. The policy rows are drawn from `TASK_POLICY_FIELDS`, so this file holds no business number
 * and a new policy key shows up here by being added to the metadata and the catalog. Groups whose feature does not
 * exist yet are not drawn, so there are no empty shells.
 */
export function GoalsSettingsView({ features }: { features: Features }) {
  const { t } = useI18n();
  const groups = visibleGoalSettingsGroups();
  const off = features.loaded && !features.outcomesEnabled;
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <GroupShell key={group.id} group={group} disabled={group.id !== "goal-management" && off}>
          {group.id === "goal-management" ? <MasterSwitch features={features} /> : null}
          {group.id === "goal-roles" ? <OutcomeRoleSettings features={features} /> : null}
          {group.policyGroup ? <PolicyFields features={features} group={group} /> : null}
        </GroupShell>
      ))}
      {off && <p className="px-2 text-[12px] text-foreground-secondary">{t("Turn on goal management to change these settings.")}</p>}
    </div>
  );
}

/** One group: titled, anchored for deep links, and (when goal management is off) visible but disabled as a whole. */
function GroupShell({ group, disabled, children }: { group: GoalSettingsGroup; disabled: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section data-settings-anchor={group.id} data-goals-disabled={disabled ? "true" : undefined} aria-label={t(group.title)}>
      <SectionLabel>{t(group.title)}</SectionLabel>
      {/* A disabled fieldset disables every control inside it, and screen readers announce it that way. */}
      <fieldset disabled={disabled} className={disabled ? "opacity-60" : undefined}>
        {children}
      </fieldset>
    </section>
  );
}

function MasterSwitch({ features }: { features: Features }) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = t("Enable goal management for bots");
  return (
    <SettingsGroup>
      <SettingsRow
        title={label}
        description={t("Shows the Outcomes entry and the idea capture button, and lets your bots register and manage goals in conversation.")}
        control={
          <InteractiveSwitch
            label={label}
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
      {error && <p role="alert" className="pb-3 text-xs text-destructive">{error}</p>}
    </SettingsGroup>
  );
}

/** Every metadata field of one group, in the metadata's order. */
export function PolicyFields({ features, group }: { features: Features; group: GoalSettingsGroup }) {
  const fields = TASK_POLICY_FIELDS.filter((entry) => entry.group === group.policyGroup);
  return (
    <SettingsGroup>
      {fields.map((entry) => (
        <PolicyRow key={entry.key} entry={entry} stored={features.taskPolicy?.[entry.key]} features={features} />
      ))}
    </SettingsGroup>
  );
}

function PolicyRow({ entry, stored, features }: { entry: PolicyEntry; stored: number | boolean | string | undefined; features: Features }) {
  const { t } = useI18n();
  const shown = describePolicyField(entry, stored);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The words come from the copy module, whose exhaustive switch makes a missing key a type error.
  const copy = policyCopy(entry.key);
  const title = copy.title;
  const text = draft ?? (shown.value === null ? "" : String(shown.value));

  const save = async (value: number | boolean | string | null) => {
    setSaving(true);
    setError(null);
    try {
      await features.update({ taskPolicy: { [entry.key]: value } });
      setDraft(null);
    } catch {
      // The old value stays on screen: nothing was saved, so nothing is shown as saved.
      setDraft(null);
      setError(t("Couldn't save this setting. Try again."));
    } finally {
      setSaving(false);
    }
  };
  const commit = () => {
    if (draft === null) return;
    const parsed = parsePolicyInput(entry, draft);
    if (!parsed.ok) {
      setError(rangeMessage(entry, t));
      return;
    }
    void save(parsed.value);
  };

  return (
    <div data-policy-key={entry.key} data-can-restore={shown.canRestore ? "true" : "false"}>
      <SettingsRow
        stackControl
        title={title}
        description={copy.description}
        control={
          <div className="ml-auto grid w-[220px] grid-cols-1 gap-1.5">
            {entry.type === "boolean" ? (
              <InteractiveSwitch label={title} checked={shown.value === true} disabled={saving} onChange={(value) => void save(value)} />
            ) : entry.type === "enum" ? (
              <select
                aria-label={title}
                data-policy-input={entry.key}
                className={settingsInput}
                disabled={saving}
                value={String(shown.value)}
                onChange={(event) => void save(event.target.value)}
              >
                {entry.options!.map((option) => (
                  <option key={option} value={option}>{policyOptionLabel(entry.key, option)}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                aria-label={title}
                aria-invalid={error !== null && draft !== null ? true : undefined}
                data-policy-input={entry.key}
                className={settingsInput}
                disabled={saving}
                inputMode={entry.type === "integer" ? "numeric" : "text"}
                placeholder={shown.unlimited ? t("No limit") : undefined}
                value={text}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onBlur={commit}
                onKeyDown={(event) => event.key === "Enter" && commit()}
              />
            )}
            <p className="text-[11px] text-foreground-secondary">
              {shown.unit && `${t(shown.unit)} · `}
              {limitsText(entry, t)}
              {" · "}
              {t("Initial")}: {initialText(entry, t)}
            </p>
            {shown.unlimited && <p className="text-[11px] text-foreground-secondary">{t("No limit")}</p>}
            {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-1.5">
              {entry.type !== "boolean" && entry.type !== "enum" && (
                <button
                  type="button"
                  data-policy-save={entry.key}
                  className={settingsSecondaryButton}
                  disabled={saving || draft === null}
                  onClick={commit}
                >
                  {t("Save")}
                </button>
              )}
              <button
                type="button"
                className={settingsSecondaryButton}
                disabled={!shown.canRestore || saving}
                onClick={() => void save(null)}
              >
                {t("Restore initial value")}
              </button>
            </div>
          </div>
        }
      />
    </div>
  );
}

const initialText = (entry: TaskPolicyField, t: (key: string) => string): string =>
  entry.initial === null ? t("No limit") : entry.type === "boolean" ? t(entry.initial ? "On" : "Off") : String(entry.initial);

/** The allowed values in words, from the metadata only. */
const limitsText = (entry: TaskPolicyField, t: (key: string, values?: Record<string, string | number>) => string): string => {
  if (entry.type === "integer") return t("Allowed: {min} to {max}", { min: entry.min!, max: entry.max! });
  if (entry.type === "time") return t("Allowed: a time written as HH:MM");
  if (entry.type === "enum") return t("Allowed: choose one of the options");
  return t("Allowed: on or off");
};
const rangeMessage = (entry: TaskPolicyField, t: (key: string, values?: Record<string, string | number>) => string): string =>
  `${t("That value is not allowed.")} ${limitsText(entry, t)}`;
