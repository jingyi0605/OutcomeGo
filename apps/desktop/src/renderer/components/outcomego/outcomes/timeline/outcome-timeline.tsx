import type { WorkItemView } from "@outcomego/contracts/outcomes";
import { useI18n } from "../../../../lib/i18n";
import "../outcome-ui.css";
import { buildTimelineLayout, type TimelineLayout, type TimelineRow, type TimelineWorkItem } from "./timeline-layout";
import { TIMELINE_STATUS } from "./timeline-status";

/**
 * Goal timeline (specs/004.10 design §5.6). Two blocks carry the same facts: a drawing for sighted pointer use,
 * and a table for keyboards and screen readers. The drawing is hidden from assistive technology so nothing is read twice.
 * Everything shown is a recorded fact: no predicted finish, no critical path, no dates for tasks that have none.
 */
export interface OutcomeTimelineProps {
  workItems: readonly WorkItemView[];
  currentRevision: number | null;
  /** The bot name for a work item's bot, when known. */
  botName?: (botId: string | undefined) => string | undefined;
  now?: Date;
}

const percent = (value: string, axis: NonNullable<TimelineLayout["axis"]>): number => {
  const start = Date.parse(axis.start);
  const span = Math.max(Date.parse(axis.end) - start, 1);
  return Math.min(100, Math.max(0, ((Date.parse(value) - start) / span) * 100));
};

function StatusBadge({ row }: { row: TimelineRow }) {
  const { t } = useI18n();
  const style = TIMELINE_STATUS[row.displayState];
  return (
    <span className="outcome-timeline-status" data-tone={style.tone} data-animated={style.animated || undefined}>
      <span aria-hidden="true" className="outcome-timeline-icon">{style.icon}</span>
      {t(style.label)}
    </span>
  );
}

export function OutcomeTimeline({ workItems, currentRevision, botName, now = new Date() }: OutcomeTimelineProps) {
  const { t } = useI18n();
  const layout = buildTimelineLayout(workItems as readonly TimelineWorkItem[], now, currentRevision);
  if (layout.rows.length === 0) return null;
  const { axis } = layout;
  const timesKnown = layout.rows.some((row) => row.timesKnown);
  const when = (value: string) => new Date(value).toLocaleString();
  const todayAt = axis ? percent(now.toISOString(), axis) : null;
  const rowBot = (row: TimelineRow) => botName?.(row.botId);

  return (
    <section className="outcome-timeline" aria-label={t("Timeline")}>
      <h4 className="outcome-timeline-title">{t("Timeline")}</h4>
      {!timesKnown && <p className="outcome-timeline-note">{t("This server does not report task times yet. Only order and status are shown.")}</p>}

      {axis && (
        <div className="outcome-timeline-chart" aria-hidden="true">
          <div className="outcome-timeline-axis">
            <span>{when(axis.start)}</span>
            <span>{when(axis.end)}</span>
          </div>
          {layout.rows.map((row) => (
            <div key={row.id} className="outcome-timeline-row" data-state={row.displayState}>
              <span className="outcome-timeline-label">{row.title}</span>
              <div className="outcome-timeline-track">
                {row.gaps.map((gap) => (
                  <span
                    key={`${gap.from}-${gap.to}`}
                    className="outcome-timeline-gap"
                    style={{ left: `${percent(gap.from, axis)}%`, width: `${Math.max(percent(gap.to, axis) - percent(gap.from, axis), 0)}%` }}
                  />
                ))}
                {row.segments.map((segment) => (
                  <span
                    key={segment.runId}
                    className="outcome-timeline-segment"
                    data-marker={row.marker}
                    data-tone={TIMELINE_STATUS[row.displayState].tone}
                    data-ongoing={segment.ongoing || undefined}
                    style={{ left: `${percent(segment.start, axis)}%`, width: `${Math.max(percent(segment.end, axis) - percent(segment.start, axis), 0.8)}%` }}
                  />
                ))}
                {row.deferredUntil && <span className="outcome-timeline-defer">{t("Deferred until {time}", { time: when(row.deferredUntil) })}</span>}
              </div>
            </div>
          ))}
          {todayAt !== null && (
            <div className="outcome-timeline-today-layer">
              <span className="outcome-timeline-today" style={{ left: `${todayAt}%` }} />
            </div>
          )}
        </div>
      )}

      {layout.unscheduled.length > 0 && (
        <section className="outcome-timeline-unscheduled" aria-label={t("Not scheduled")}>
          <h5>{t("Not scheduled")}</h5>
          <ul>
            {layout.unscheduled.map((entry) => (
              <li key={entry.id}>
                {entry.title}
                {entry.waitingFor.length > 0 && (
                  <span> · {t("Waiting for: {tasks}", { tasks: entry.waitingFor.map((task) => task.title).join(", ") })}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <table className="outcome-timeline-table">
        <caption className="sr-only">{t("Task timeline as a list")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Task")}</th>
            <th scope="col">{t("Owner")}</th>
            <th scope="col">{t("Status")}</th>
            <th scope="col">{t("Runs")}</th>
            <th scope="col">{t("Depends on")}</th>
          </tr>
        </thead>
        <tbody>
          {layout.rows.map((row) => {
            const source = workItems.find((item) => item.id === row.id)!;
            const dependencies = source.dependsOn.map((id) => layout.rows.find((candidate) => candidate.id === id)?.title ?? id);
            return (
              <tr key={row.id}>
                <th scope="row">{row.title}</th>
                <td>{row.executorType === "human" ? t("You") : (rowBot(row) ?? t("Bot"))}</td>
                <td><StatusBadge row={row} />{row.deferredUntil && <span> · {t("Deferred until {time}", { time: when(row.deferredUntil) })}</span>}</td>
                <td>
                  {row.segments.length === 0
                    ? t("No runs yet")
                    : row.segments.map((segment) => (
                        <span key={segment.runId} className="outcome-timeline-run">
                          {segment.ongoing ? t("{start} – now", { start: when(segment.start) }) : `${when(segment.start)} – ${when(segment.end)}`}
                        </span>
                      ))}
                </td>
                <td>{dependencies.length ? dependencies.join(", ") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
