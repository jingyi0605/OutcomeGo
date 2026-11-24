import { AlertTriangle, CalendarClock } from "lucide-react";
import { useI18n } from "../../../../lib/i18n";

/**
 * The booked time and the deadline of a human task (specs/004.10 task 2.7). A booked time only informs. "Overdue" is
 * the server's derived flag: this never compares the deadline with a clock itself, so every view agrees with it, and
 * a task without a deadline can never show it. The state is written in words with an icon, not only a colour.
 */
export function HumanTaskDates({
  scheduledAt,
  dueAt,
  overdue,
}: {
  scheduledAt?: string | null;
  dueAt?: string | null;
  overdue?: boolean;
}) {
  const { t } = useI18n();
  if (!scheduledAt && !dueAt) return null;
  const when = (value: string) => new Date(value).toLocaleString();
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-overdue={overdue ? "true" : undefined}>
      {scheduledAt && (
        <span className="inline-flex items-center gap-1">
          <CalendarClock aria-hidden="true" className="size-3" />
          {t("Booked for")} <time dateTime={scheduledAt}>{when(scheduledAt)}</time>
        </span>
      )}
      {dueAt && (
        <span className="inline-flex items-center gap-1">
          {t("Due")} <time dateTime={dueAt}>{when(dueAt)}</time>
          {overdue && (
            <strong className="inline-flex items-center gap-1 font-medium text-destructive">
              <AlertTriangle aria-hidden="true" className="size-3" />
              {t("Overdue")}
            </strong>
          )}
        </span>
      )}
    </p>
  );
}
