import { useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import type { ScheduleChange } from "../timeline/schedule-edit";
import { ScheduleEditor } from "../timeline/schedule-editor";

/**
 * The goal's due date in the goal detail (specs/004.10 requirement C7): shown, and changed or cleared by the owner while
 * the goal is open. A finished goal shows its date and offers no control. Nothing here touches the contract.
 */
export function GoalDue({
  title,
  dueAt,
  editable,
  onSave,
}: {
  title: string;
  dueAt: string | null | undefined;
  /** The goal is still open. The server refuses a change to a finished one as well. */
  editable: boolean;
  /** Resolves when saved; rejects with the server's error when refused. */
  onSave: (change: ScheduleChange) => Promise<void>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  if (!dueAt && !editable) return null;
  return (
    <div className="outcome-goal-due" data-goal-due>
      <p className="outcome-goal-due-line">
        <span>{t("Due date")}:</span> <span>{dueAt ? new Date(dueAt).toLocaleString() : t("Not set")}</span>
        {editable && (
          <button
            type="button"
            className="outcome-control"
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            {t(dueAt ? "Change due date" : "Set due date")}
          </button>
        )}
      </p>
      {editable && editing && (
        <ScheduleEditor
          title={title}
          initial={{ dueAt }}
          fields={["dueAt"]}
          onSave={async (change) => {
            await onSave(change);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
