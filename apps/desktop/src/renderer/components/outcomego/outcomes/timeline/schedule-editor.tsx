import { PLAN_ESTIMATE_MINUTES } from "@outcomego/contracts/outcome-state";
import { useId, useState, type FormEvent } from "react";
import { useI18n } from "../../../../lib/i18n";
import {
  changeFromDraft,
  draftFrom,
  scheduleErrorMessage,
  type ScheduleChange,
  type ScheduleDraft,
  type ScheduleField,
} from "./schedule-edit";

/**
 * The form for changing dates (specs/004.10 requirements C7 and C8), shared by a task's schedule and the goal's due
 * date. It sends only what changed, stops a value that is not a time or a whole number, and shows the server's reason
 * in place when a change is refused, leaving what was typed so nothing has to be entered again.
 */
export interface ScheduleEditorProps {
  /** What the dates belong to, used to name the form for assistive technology. */
  title: string;
  initial: { scheduledAt?: string | null; dueAt?: string | null; estimateMinutes?: number | null };
  /** Which fields to offer. Defaults to a task's three. */
  fields?: readonly ScheduleField[];
  /** Resolves when the change is saved; rejects with the server's error when it is refused. */
  onSave: (change: ScheduleChange) => Promise<void>;
  onCancel: () => void;
}

const ALL_FIELDS: readonly ScheduleField[] = ["scheduledAt", "dueAt", "estimateMinutes"];

export function ScheduleEditor({ title, initial, fields = ALL_FIELDS, onSave, onCancel }: ScheduleEditorProps) {
  const { t } = useI18n();
  const ids = useId();
  const [start] = useState<ScheduleDraft>(() => draftFrom(initial));
  const [draft, setDraft] = useState<ScheduleDraft>(start);
  const [invalid, setInvalid] = useState<ScheduleField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (field: ScheduleField, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setInvalid((previous) => previous.filter((entry) => entry !== field));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const result = changeFromDraft(start, draft);
    if (!result.ok) {
      setInvalid(result.fields);
      setError(t("The schedule is not valid. Check the dates and the estimate."));
      return;
    }
    if (!result.change) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(result.change);
    } catch (failure) {
      setError(scheduleErrorMessage(failure, t));
    } finally {
      setSaving(false);
    }
  }

  const timeField = (field: "scheduledAt" | "dueAt", label: string) => (
    <label className="outcome-schedule-field">
      <span>{label}</span>
      <input
        type="datetime-local"
        className="outcome-control"
        value={draft[field]}
        disabled={saving}
        aria-invalid={invalid.includes(field) || undefined}
        onChange={(event) => set(field, event.target.value)}
      />
    </label>
  );

  return (
    <form
      className="outcome-schedule-editor"
      aria-label={t("Change schedule: {task}", { task: title })}
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      {fields.includes("scheduledAt") && timeField("scheduledAt", t("Planned for"))}
      {fields.includes("dueAt") && timeField("dueAt", t("Due"))}
      {fields.includes("estimateMinutes") && (
        <label className="outcome-schedule-field">
          <span>{t("Estimate (minutes)")}</span>
          <input
            type="text"
            inputMode="numeric"
            className="outcome-control"
            value={draft.estimateMinutes}
            disabled={saving}
            aria-invalid={invalid.includes("estimateMinutes") || undefined}
            aria-describedby={`${ids}-estimate`}
            onChange={(event) => set("estimateMinutes", event.target.value)}
          />
          <small id={`${ids}-estimate`}>{t("Allowed: {min} to {max}", { min: PLAN_ESTIMATE_MINUTES.min, max: PLAN_ESTIMATE_MINUTES.max })}</small>
        </label>
      )}
      <p className="outcome-schedule-hint">{t("Leave a box empty to clear it.")}</p>
      {error && <p role="alert" className="outcome-schedule-error">{error}</p>}
      <div className="outcome-schedule-actions">
        <button type="submit" className="outcome-control" disabled={saving}>{t("Save")}</button>
        <button type="button" className="outcome-control" disabled={saving} onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}
