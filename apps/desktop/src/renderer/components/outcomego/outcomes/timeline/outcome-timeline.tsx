import type { WorkItemView } from "@outcomego/contracts/outcomes";
import { isWorkItemScheduleEditable } from "@outcomego/contracts/task-overview";
import { Fragment, useRef, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import "../outcome-ui.css";
import type { ScheduleChange } from "./schedule-edit";
import { ScheduleEditor } from "./schedule-editor";
import { buildTimelineTicks } from "./timeline-axis";
import {
  buildTimelineLayout,
  formatEstimate,
  type TimelineGoal,
  type TimelineLayout,
  type TimelineRow,
  type TimelineWorkItem,
} from "./timeline-layout";
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
  /** The goal's own due time and whether it is finished, for the flag at the end of the timeline. */
  goal?: TimelineGoal;
  /**
   * When given, a task that has not started offers "Change schedule" in the list view, and this saves the change.
   * It rejects with the server's error when the change is refused. Without it the timeline is read-only.
   */
  onChangeSchedule?: (workItemId: string, change: ScheduleChange) => Promise<void>;
  now?: Date;
}

const percent = (value: string | Date, axis: NonNullable<TimelineLayout["axis"]>): number => {
  const start = Date.parse(axis.start);
  const span = Date.parse(axis.end) - start;
  const stamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return span > 0 ? Math.min(100, Math.max(0, ((stamp - start) / span) * 100)) : 50;
};

/** The overdue mark: an icon and words, so it never rests on color alone. Only rendered for a task that is overdue. */
function OverdueBadge() {
  const { t } = useI18n();
  return (
    <span className="outcome-timeline-overdue">
      <span aria-hidden="true">⚑</span> {t("Overdue")}
    </span>
  );
}

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

export function OutcomeTimeline({ workItems, currentRevision, botName, goal, onChangeSchedule, now = new Date() }: OutcomeTimelineProps) {
  const { t, locale } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const chartScroll = useRef<HTMLDivElement>(null);
  const todayMarker = useRef<HTMLSpanElement>(null);
  const layout = buildTimelineLayout(workItems as readonly TimelineWorkItem[], now, currentRevision, goal);
  if (layout.rows.length === 0) return null;
  const { axis } = layout;
  const timesKnown = layout.rows.some((row) => row.timesKnown);
  const when = (value: string) => new Date(value).toLocaleString();
  const ticks = axis ? buildTimelineTicks(axis) : null;
  const tickFormat = new Intl.DateTimeFormat(locale, {
    month: "short", day: "numeric", ...(ticks?.unit === "hour" ? { hour: "numeric" } : {}),
    ...(ticks?.unit === "week" ? { year: "numeric" } : {}),
  });
  const rowBot = (row: TimelineRow) => botName?.(row.botId);
  const rowOwner = (row: TimelineRow) => (row.executorType === "human" ? t("You") : (rowBot(row) ?? t("Bot")));
  const rowIndex = new Map(layout.rows.map((row, index) => [row.id, index] as const));
  const duration = (minutes: number) => {
    const { key, value } = formatEstimate(minutes);
    return t(key, { value });
  };
  const scrollToToday = () => {
    const viewport = chartScroll.current;
    const marker = todayMarker.current;
    if (!viewport || !marker) return;
    const fromViewportStart = marker.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
    viewport.scrollLeft += fromViewportStart - viewport.clientWidth / 2;
  };

  return (
    <section className="outcome-timeline" aria-label={t("Timeline")}>
      <h4 className="outcome-timeline-title">{t("Timeline")}</h4>
      {!timesKnown && <p className="outcome-timeline-note">{t("This server does not report task times yet. Only order and status are shown.")}</p>}

      {axis && ticks && (<>
        <button type="button" className="outcome-control outcome-timeline-today-button" onClick={scrollToToday}>{t("Back to today")}</button>
        <div className="outcome-timeline-chart-scroll" ref={chartScroll} tabIndex={-1}>
        <div className="outcome-timeline-chart" aria-hidden="true" style={{ minWidth: `calc(var(--timeline-label) + ${Math.max(24, (ticks.dates.length + 1) * 8)}rem)` }}>
          <div className="outcome-timeline-axis" data-unit={ticks.unit}>
            {ticks.dates.map((date) => (
              <span key={date.getTime()} className="outcome-timeline-tick" style={{ left: `${percent(date, axis)}%` }}>
                {tickFormat.format(date)}
              </span>
            ))}
          </div>
          <div className="outcome-timeline-chart-body">
          {layout.goal && (
            <div className="outcome-timeline-row outcome-timeline-goal-row">
              <span className="outcome-timeline-label">
                <span className="outcome-timeline-label-text">{t("Goal due {time}", { time: when(layout.goal.dueAt) })}</span>
                {layout.goal.overdue && <OverdueBadge />}
              </span>
              <div className="outcome-timeline-track">
                <span className="outcome-timeline-flag" style={{ left: `${percent(layout.goal.dueAt, axis)}%` }}>
                  <span aria-hidden="true">⚑</span>
                </span>
              </div>
            </div>
          )}
          <div className="outcome-timeline-rows">
          {layout.rows.map((row) => (
            <div key={row.id} className="outcome-timeline-row" data-state={row.displayState}>
              <span
                className="outcome-timeline-label"
                data-tone={TIMELINE_STATUS[row.displayState].tone}
                title={`${row.title} · ${rowOwner(row)} · ${t(TIMELINE_STATUS[row.displayState].label)}`}
              >
                <span aria-hidden="true" className="outcome-timeline-label-icon">{TIMELINE_STATUS[row.displayState].icon}</span>
                <span className="outcome-timeline-label-text">{row.title}</span>
                {row.overdue && <OverdueBadge />}
              </span>
              <div className="outcome-timeline-track">
                {row.gaps.map((gap) => (
                  <span
                    key={`${gap.from}-${gap.to}`}
                    className="outcome-timeline-gap"
                    style={{ left: `${percent(gap.from, axis)}%`, width: `${Math.max(percent(gap.to, axis) - percent(gap.from, axis), 0)}%` }}
                  />
                ))}
                {row.estimate && (
                  <span
                    className="outcome-timeline-estimate"
                    data-tone={TIMELINE_STATUS[row.displayState].tone}
                    title={t("Estimate: {duration}", { duration: duration(row.estimate.minutes) })}
                    style={{ left: `${percent(row.estimate.from, axis)}%`, width: `${Math.max(percent(row.estimate.to, axis) - percent(row.estimate.from, axis), 0.8)}%` }}
                  >
                    <span className="outcome-timeline-estimate-label">{t("Estimate")}</span>
                  </span>
                )}
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
                {row.plannedAt && (
                  <span
                    className="outcome-timeline-plan"
                    data-marker={row.marker}
                    data-tone={TIMELINE_STATUS[row.displayState].tone}
                    title={`${t("Planned for")}: ${when(row.plannedAt)}`}
                    style={{ left: `${percent(row.plannedAt, axis)}%` }}
                  />
                )}
                {row.dueAt && (
                  <span
                    className="outcome-timeline-due-tick"
                    data-overdue={row.overdue ? "true" : undefined}
                    title={`${t("Due")}: ${when(row.dueAt)}`}
                    style={{ left: `${percent(row.dueAt, axis)}%` }}
                  />
                )}
                {row.deferredUntil && <span className="outcome-timeline-defer">{t("Deferred until {time}", { time: when(row.deferredUntil) })}</span>}
              </div>
            </div>
          ))}
          {layout.links.length > 0 && (
            <svg
              className="outcome-timeline-links"
              aria-hidden="true"
              viewBox={`0 0 100 ${layout.rows.length}`}
              preserveAspectRatio="none"
            >
              {layout.links.map((link) => {
                const from = rowIndex.get(link.from);
                const to = rowIndex.get(link.to);
                if (from === undefined || to === undefined) return null;
                const [x1, x2] = [percent(link.fromAt, axis), percent(link.toAt, axis)];
                const middle = (x1 + x2) / 2;
                const [y1, y2] = [from + 0.5, to + 0.5];
                return (
                  <polyline
                    key={`${link.from}-${link.to}`}
                    className="outcome-timeline-link"
                    points={`${x1},${y1} ${middle},${y1} ${middle},${y2} ${x2},${y2}`}
                  />
                );
              })}
            </svg>
          )}
          </div>
            <div className="outcome-timeline-today-layer">
              <span ref={todayMarker} className="outcome-timeline-today" style={{ left: `${percent(now, axis)}%` }} />
              {layout.goal && (
                <span
                  className="outcome-timeline-flag-line"
                  data-overdue={layout.goal.overdue ? "true" : undefined}
                  style={{ left: `${percent(layout.goal.dueAt, axis)}%` }}
                />
              )}
            </div>
          </div>
        </div>
        </div>
      </>)}

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

      {layout.goal && (
        <p className="outcome-timeline-goal-due" data-overdue={layout.goal.overdue ? "true" : undefined}>
          {t("Goal due {time}", { time: when(layout.goal.dueAt) })}
          {layout.goal.overdue && <> · <OverdueBadge /></>}
        </p>
      )}

      <div className="outcome-timeline-table-scroll" role="region" aria-label={t("Task timeline as a list")} tabIndex={0}>
      <table className="outcome-timeline-table">
        <caption className="sr-only">{t("Task timeline as a list")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Task")}</th>
            <th scope="col">{t("Owner")}</th>
            <th scope="col">{t("Status")}</th>
            <th scope="col">{t("Runs")}</th>
            <th scope="col">{t("Planned for")}</th>
            <th scope="col">{t("Estimate")}</th>
            <th scope="col">{t("Due")}</th>
            <th scope="col">{t("Depends on")}</th>
            {onChangeSchedule && <th scope="col">{t("Schedule")}</th>}
          </tr>
        </thead>
        <tbody>
          {layout.rows.map((row) => {
            const source = workItems.find((item) => item.id === row.id)!;
            const dependencies = source.dependsOn.map((id) => layout.rows.find((candidate) => candidate.id === id)?.title ?? id);
            const editable = isWorkItemScheduleEditable(source);
            return (
              <Fragment key={row.id}>
              <tr>
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
                <td>
                  {row.plannedAt
                    ? when(row.plannedAt)
                    : row.timesKnown && !row.finished && row.segments.length === 0
                      ? t("Not scheduled")
                      : "—"}
                </td>
                <td>{row.estimateMinutes !== null ? duration(row.estimateMinutes) : "—"}</td>
                <td>
                  {row.dueAt ? when(row.dueAt) : "—"}
                  {row.overdue && <> · <OverdueBadge /></>}
                </td>
                <td>{dependencies.length ? dependencies.join(", ") : "—"}</td>
                {onChangeSchedule && (
                  <td>
                    {editable ? (
                      <button
                        type="button"
                        className="outcome-control"
                        aria-expanded={editingId === row.id}
                        aria-label={t("Change schedule: {task}", { task: row.title })}
                        onClick={() => setEditingId(editingId === row.id ? null : row.id)}
                      >
                        {t("Change schedule")}
                      </button>
                    ) : (
                      <span className="outcome-timeline-locked">{t("Already started or finished")}</span>
                    )}
                  </td>
                )}
              </tr>
              {onChangeSchedule && editable && editingId === row.id && (
                <tr className="outcome-timeline-editor-row">
                  <td colSpan={9}>
                    <ScheduleEditor
                      title={row.title}
                      initial={source}
                      onSave={async (change) => {
                        await onChangeSchedule(row.id, change);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </section>
  );
}
