import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Bot,
  Calendar,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Hand,
  Loader2,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
  StickyNote,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScheduleQuery, TimeItem, TimeItemKind } from "@outcomego/contracts/task-overview";
import { localDateOf } from "@outcomego/contracts/task-overview";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { api } from "../../../../client/outcomego-api";
import { ClientError } from "../../../../client/http";
import { cn } from "../../../../lib/cn";
import { subscribeDayClock } from "../../../../lib/day-clock";
import { useI18n } from "../../../../lib/i18n";
import { subscribeOutcomeListRefresh } from "../../../../lib/outcome-events";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover";
import { styleForActivity } from "../dashboard/activity-state";
import { OutcomeButton } from "../outcome-ui";
import {
  calendarDays,
  dayStart,
  defaultCalendarKinds,
  itemsByDay,
  movePeriod,
  moveToCalendarDate,
  nestFollowUps,
  shiftDate,
  type CalendarView,
} from "./calendar-dates";
import {
  computeCalendarMetrics,
  isFirstOfMonth,
  isSameMonth,
  isWeekend,
  periodContainsDate,
  visibleCountForCell,
  type CalendarMetrics,
} from "./calendar-layout";
import "./calendar.css";

const kindLabels: Record<TimeItemKind, string> = {
  goal_due: "Goal deadlines",
  human_task: "Human tasks",
  work_item: "Bot tasks",
  group_task: "Group tasks",
  todo: "To-dos",
  follow_up: "Follow-ups",
  routine_run: "Routines",
  scheduled_once: "Upcoming work",
  note: "Notes",
  external_event: "External calendar",
};

const kindIcons: Record<TimeItemKind, LucideIcon> = {
  goal_due: Target,
  human_task: Hand,
  work_item: Bot,
  group_task: Users,
  todo: CheckSquare,
  follow_up: BellRing,
  routine_run: Repeat,
  scheduled_once: Clock,
  note: StickyNote,
  external_event: Calendar,
};

const DONE_STATES = new Set(["completed", "accepted", "cancelled", "skipped"]);
const EXTERNAL_STORAGE_KEY = "outcomego.goal-calendar";

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function externalSelection(): { connectionId: string; calendarId: string; busyOnly: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(EXTERNAL_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return {
      connectionId: typeof value.connectionId === "string" ? value.connectionId : "",
      calendarId: typeof value.calendarId === "string" ? value.calendarId : "",
      busyOnly: value.busyOnly === true,
    };
  } catch {
    return { connectionId: "", calendarId: "", busyOnly: false };
  }
}

export type CalendarPageProps = {
  bots: OutcomeExecutionBot[];
  /** Present when mounted standalone outside OutcomeWorkspace. */
  onClose?: () => void;
  /** True when rendered as a tab inside OutcomeWorkspace (omits duplicate titlebar). */
  embedded?: boolean;
  onOpenOutcome: (outcomeId: string) => void;
  onOpenChannel?: (channelId: string) => void;
  onOpenGroupTasks?: (channelId: string) => void;
  onOpenRoutine?: (routineId: string, botId?: string) => void;
  refreshVersion?: number;
  onBusyChange?: (busy: boolean) => void;
};

function dateText(
  value: Date,
  timeZone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(value);
}

function rangeFor(value: string, view: CalendarView, timeZone: string): { from: string; to: string } {
  const days = calendarDays(value, view);
  const from = dayStart(days[0]!, timeZone);
  const to = dayStart(shiftDate(days.at(-1)!, 1), timeZone);
  return { from: from.toISOString(), to: to.toISOString() };
}

function itemDate(item: TimeItem, timeZone: string): string | null {
  const value = item.allDay ? item.end ?? item.start : item.start ?? item.end;
  if (!value) return null;
  return item.allDay ? value : localDateOf(new Date(value), timeZone);
}

function shiftedItemValue(item: TimeItem, targetDate: string, timeZone: string): string {
  if (item.allDay) return targetDate;
  const source = item.start ?? item.end;
  if (!source) return dayStart(targetDate, timeZone).toISOString();
  return moveToCalendarDate(source, targetDate, timeZone);
}

function itemTimeLabel(item: TimeItem, timeZone: string, locale: string, t: (key: string) => string): string {
  if (item.allDay) return t("All day");
  return dateText(new Date(item.start ?? item.end ?? Date.now()), timeZone, locale, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function itemTooltip(
  item: TimeItem,
  time: string,
  botName: string | undefined,
  t: (key: string) => string
): string {
  const parts = [
    item.title || t("Untitled"),
    `${t(kindLabels[item.kind])} · ${time}`,
    item.overdue ? t("Overdue") : "",
    item.kind === "scheduled_once" || item.kind === "group_task"
      ? [botName, t(styleForActivity(item.state).label)].filter(Boolean).join(" · ")
      : botName ?? "",
    item.editable ? t("Drag to change the date") : t("Read-only calendar item"),
  ].filter(Boolean);
  return parts.join("\n");
}

function isItemDone(item: TimeItem): boolean {
  return DONE_STATES.has(item.state);
}

/** Entries as one list for the grids, each nested follow-up directly after its to-do. */
function dayRows(items: readonly TimeItem[]) {
  const entries = nestFollowUps(items);
  return {
    count: entries.length,
    heads: entries.map((entry) => entry.item),
    rows: entries.flatMap(({ item, followUps }) => [
      { item, nested: false },
      ...followUps.map((followUp) => ({ item: followUp, nested: true })),
    ]),
  };
}

function CalendarItemCard({
  item,
  timeZone,
  locale,
  botName,
  metrics,
  forceDetailed = false,
  nested = false,
  onDragStart,
  onOpen,
}: {
  item: TimeItem;
  timeZone: string;
  locale: string;
  botName?: string;
  metrics: CalendarMetrics;
  forceDetailed?: boolean;
  /** A follow-up shown as one indented line under its to-do. */
  nested?: boolean;
  onDragStart: (item: TimeItem) => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const time = itemTimeLabel(item, timeZone, locale, t);
  const density = forceDetailed ? "detailed" : metrics.density;
  const showTime = forceDetailed || metrics.showTime;
  const showMeta = forceDetailed || metrics.showMeta;
  const showIcon = forceDetailed || density === "detailed";
  const activity = item.kind === "scheduled_once" || item.kind === "group_task" ? styleForActivity(item.state) : null;
  const metaText = activity
    ? [botName, t(activity.label)].filter(Boolean).join(" · ")
    : botName;
  const KindIcon = item.overdue ? AlertCircle : kindIcons[item.kind];

  return (
    <button
      type="button"
      className="outcome-calendar-item"
      data-calendar-item={item.id}
      data-cal-kind={item.kind}
      data-cal-overdue={item.overdue ? "true" : undefined}
      data-cal-done={isItemDone(item) ? "true" : undefined}
      data-density={density}
      data-nested={nested ? "true" : undefined}
      draggable={item.editable}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-outcomego-calendar", item.id);
        onDragStart(item);
      }}
      onClick={onOpen}
      title={itemTooltip(item, time, botName, t)}
    >
      {nested ? (
        <span className="outcome-calendar-item-row">
          <KindIcon aria-hidden="true" className="outcome-calendar-kind-icon size-[10px]" strokeWidth={2} />
          <span className="outcome-calendar-item-title">
            {[time, t("Follow-up"), item.title].filter(Boolean).join(" · ")}
          </span>
        </span>
      ) : density === "compact" ? (
        <>
          <span className="outcome-calendar-item-title">{item.title || t("Untitled")}</span>
          {showTime && !item.allDay && (
            <span className="outcome-calendar-item-inline-time">{time}</span>
          )}
        </>
      ) : (
        <>
          <span className="outcome-calendar-item-row">
            {showIcon && (
              <KindIcon
                aria-hidden="true"
                className="outcome-calendar-kind-icon size-[11px]"
                strokeWidth={2}
              />
            )}
            <span className="outcome-calendar-item-title">{item.title || t("Untitled")}</span>
          </span>
          {showTime && (
            <span className="outcome-calendar-item-sub">
              <span>
                {time}
                {item.overdue ? ` · ${t("Overdue")}` : ""}
              </span>
            </span>
          )}
          {showMeta && metaText && (
            <span className="outcome-calendar-item-sub">
              {activity?.animated && <span aria-hidden="true" className="outcome-calendar-live-dot" />}
              <span>{metaText}</span>
            </span>
          )}
        </>
      )}
    </button>
  );
}

function DayItemsPopover({
  date,
  entries,
  today,
  timeZone,
  locale,
  bots,
  metrics,
  onDragStart,
  onOpen,
  onOpenDay,
  trigger,
}: {
  date: string;
  entries: TimeItem[];
  today: string;
  timeZone: string;
  locale: string;
  bots: OutcomeExecutionBot[];
  metrics: CalendarMetrics;
  onDragStart: (item: TimeItem) => void;
  onOpen: (item: TimeItem) => void;
  onOpenDay: (date: string) => void;
  trigger: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const heading = dateText(dayStart(date, timeZone), timeZone, locale, {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">{heading}</span>
            {date === today && (
              <span className="outcome-calendar-today-pill">{t("Today")}</span>
            )}
          </div>
          <button
            type="button"
            className="text-[11px] font-medium text-foreground-secondary hover:text-foreground"
            onClick={() => {
              setOpen(false);
              onOpenDay(date);
            }}
          >
            {t("View full day")}
          </button>
        </div>
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
          {dayRows(entries).rows.map(({ item, nested }) => (
            <CalendarItemCard
              key={item.id}
              nested={nested}
              item={item}
              timeZone={timeZone}
              locale={locale}
              botName={bots.find((bot) => bot.id === item.botId)?.name}
              metrics={metrics}
              forceDetailed
              onDragStart={onDragStart}
              onOpen={() => {
                setOpen(false);
                onOpen(item);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthGrid({
  days,
  selectedDate,
  today,
  todayPulse,
  items,
  timeZone,
  locale,
  bots,
  metrics,
  dragOverDate,
  onDragOverDate,
  onDragStart,
  onDrop,
  onOpen,
  onOpenDay,
}: {
  days: string[];
  selectedDate: string;
  today: string;
  todayPulse: number;
  items: Map<string, TimeItem[]>;
  timeZone: string;
  locale: string;
  bots: OutcomeExecutionBot[];
  metrics: CalendarMetrics;
  dragOverDate: string | null;
  onDragOverDate: (date: string | null) => void;
  onDragStart: (item: TimeItem) => void;
  onDrop: (date: string) => void;
  onOpen: (item: TimeItem) => void;
  onOpenDay: (date: string) => void;
}) {
  const { t } = useI18n();
  const weekRows = Math.max(1, Math.ceil(days.length / 7));
  const weekdayHeaders = days.slice(0, 7);

  return (
    <>
      <div className="outcome-calendar-weekdays" role="row">
        {weekdayHeaders.map((date) => (
          <div
            key={date}
            role="columnheader"
            className="outcome-calendar-weekday"
            data-weekend={isWeekend(date) ? "true" : undefined}
            data-density={metrics.density}
          >
            {dateText(dayStart(date, timeZone), timeZone, locale, {
              weekday: metrics.weekdayFormat,
            })}
          </div>
        ))}
      </div>
      <div
        className="outcome-calendar-month-grid"
        role="grid"
        aria-label={t("Calendar")}
        style={{ gridTemplateRows: `repeat(${weekRows}, minmax(0, 1fr))` }}
      >
        {days.map((date) => {
          const entries = items.get(date) ?? [];
          const isToday = date === today;
          const outside = !isSameMonth(date, selectedDate);
          const weekend = isWeekend(date);
          const { count, heads, rows } = dayRows(entries);
          const visibleCount = visibleCountForCell(rows.length, metrics);
          const overflow = rows.length - visibleCount;
          const dayNumber = Number(date.slice(8, 10));
          const showMonthPrefix = metrics.density !== "minimal" && isFirstOfMonth(date);
          const dateLabel = showMonthPrefix
            ? dateText(dayStart(date, timeZone), timeZone, locale, {
                month: "short",
                day: "numeric",
              })
            : String(dayNumber);

          return (
            <section
              key={isToday ? `${date}-${todayPulse}` : date}
              className="outcome-calendar-cell"
              data-calendar-day={date}
              data-calendar-today={isToday ? "true" : undefined}
              data-pulse={isToday && todayPulse > 0 ? "true" : undefined}
              data-outside={outside ? "true" : undefined}
              data-weekend={weekend ? "true" : undefined}
              data-density={metrics.density}
              data-drag-over={dragOverDate === date ? "true" : undefined}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("application/x-outcomego-calendar")) {
                  event.preventDefault();
                  if (dragOverDate !== date) onDragOverDate(date);
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  if (dragOverDate === date) onDragOverDate(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                onDragOverDate(null);
                onDrop(date);
              }}
            >
              <div className="outcome-calendar-cell-head">
                <div className="outcome-calendar-date-group">
                  <button
                    type="button"
                    className="outcome-calendar-date-num"
                    data-today={isToday ? "true" : undefined}
                    onClick={() => onOpenDay(date)}
                    title={dateText(dayStart(date, timeZone), timeZone, locale, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    })}
                  >
                    {dateLabel}
                  </button>
                  {isToday && metrics.showTodayLabel && (
                    <span className="outcome-calendar-today-pill">{t("Today")}</span>
                  )}
                </div>
                {metrics.density !== "minimal" && count > 0 && (
                  <span className="outcome-calendar-day-count">{count}</span>
                )}
              </div>

              {metrics.density === "minimal" ? (
                entries.length > 0 && (
                  <DayItemsPopover
                    date={date}
                    entries={entries}
                    today={today}
                    timeZone={timeZone}
                    locale={locale}
                    bots={bots}
                    metrics={metrics}
                    onDragStart={onDragStart}
                    onOpen={onOpen}
                    onOpenDay={onOpenDay}
                    trigger={
                      <button
                        type="button"
                        className="outcome-calendar-dots-btn"
                        aria-label={t("{count} items", { count })}
                      >
                        {heads.slice(0, 4).map((item) => (
                          <span
                            key={item.id}
                            className="outcome-calendar-dot"
                            data-cal-kind={item.kind}
                            data-cal-overdue={item.overdue ? "true" : undefined}
                          />
                        ))}
                        {count > 4 && (
                          <span className="text-[9px] font-medium leading-none text-foreground-secondary tabular-nums">
                            +{count - 4}
                          </span>
                        )}
                      </button>
                    }
                  />
                )
              ) : (
                <div className="outcome-calendar-cell-items">
                  {rows.slice(0, visibleCount).map(({ item, nested }) => (
                    <CalendarItemCard
                      key={item.id}
                      nested={nested}
                      item={item}
                      timeZone={timeZone}
                      locale={locale}
                      botName={bots.find((bot) => bot.id === item.botId)?.name}
                      metrics={metrics}
                      onDragStart={onDragStart}
                      onOpen={() => onOpen(item)}
                    />
                  ))}
                  {overflow > 0 && (
                    <DayItemsPopover
                      date={date}
                      entries={entries}
                      today={today}
                      timeZone={timeZone}
                      locale={locale}
                      bots={bots}
                      metrics={metrics}
                      onDragStart={onDragStart}
                      onOpen={onOpen}
                      onOpenDay={onOpenDay}
                      trigger={
                        <button type="button" className="outcome-calendar-more-btn">
                          {t("{count} more", { count: overflow })}
                        </button>
                      }
                    />
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function WeekGrid({
  days,
  today,
  todayPulse,
  nowClock,
  items,
  timeZone,
  locale,
  bots,
  metrics,
  dragOverDate,
  onDragOverDate,
  onDragStart,
  onDrop,
  onOpen,
  onOpenDay,
}: {
  days: string[];
  today: string;
  todayPulse: number;
  nowClock: string;
  items: Map<string, TimeItem[]>;
  timeZone: string;
  locale: string;
  bots: OutcomeExecutionBot[];
  metrics: CalendarMetrics;
  dragOverDate: string | null;
  onDragOverDate: (date: string | null) => void;
  onDragStart: (item: TimeItem) => void;
  onDrop: (date: string) => void;
  onOpen: (item: TimeItem) => void;
  onOpenDay: (date: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="outcome-calendar-week" role="grid" aria-label={t("Calendar")}>
      {days.map((date) => {
        const entries = items.get(date) ?? [];
        const isToday = date === today;
        const weekend = isWeekend(date);
        const { count, heads, rows } = dayRows(entries);
        const visibleCount = visibleCountForCell(rows.length, metrics);
        const overflow = rows.length - visibleCount;
        const dayNumber = Number(date.slice(8, 10));

        return (
          <section
            key={isToday ? `${date}-${todayPulse}` : date}
            className="outcome-calendar-week-col"
            data-calendar-day={date}
            data-calendar-today={isToday ? "true" : undefined}
            data-pulse={isToday && todayPulse > 0 ? "true" : undefined}
            data-weekend={weekend ? "true" : undefined}
            data-drag-over={dragOverDate === date ? "true" : undefined}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("application/x-outcomego-calendar")) {
                event.preventDefault();
                if (dragOverDate !== date) onDragOverDate(date);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                if (dragOverDate === date) onDragOverDate(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              onDragOverDate(null);
              onDrop(date);
            }}
          >
            <header className="outcome-calendar-week-head">
              <span className="text-[11px] font-medium text-foreground-secondary">
                {dateText(dayStart(date, timeZone), timeZone, locale, {
                  weekday: metrics.weekdayFormat,
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="outcome-calendar-date-num"
                  data-today={isToday ? "true" : undefined}
                  onClick={() => onOpenDay(date)}
                >
                  {dayNumber}
                </button>
                {isToday && metrics.showTodayLabel && (
                  <span className="outcome-calendar-today-pill">
                    {metrics.density === "detailed" ? `${t("Today")} · ${nowClock}` : t("Today")}
                  </span>
                )}
              </div>
            </header>

            <div className="outcome-calendar-week-body">
              {metrics.density === "minimal" ? (
                entries.length > 0 && (
                  <DayItemsPopover
                    date={date}
                    entries={entries}
                    today={today}
                    timeZone={timeZone}
                    locale={locale}
                    bots={bots}
                    metrics={metrics}
                    onDragStart={onDragStart}
                    onOpen={onOpen}
                    onOpenDay={onOpenDay}
                    trigger={
                      <button
                        type="button"
                        className="outcome-calendar-dots-btn mx-auto"
                        aria-label={t("{count} items", { count })}
                      >
                        {heads.slice(0, 5).map((item) => (
                          <span
                            key={item.id}
                            className="outcome-calendar-dot"
                            data-cal-kind={item.kind}
                            data-cal-overdue={item.overdue ? "true" : undefined}
                          />
                        ))}
                        {count > 5 && (
                          <span className="text-[9px] font-medium text-foreground-secondary tabular-nums">
                            +{count - 5}
                          </span>
                        )}
                      </button>
                    }
                  />
                )
              ) : (
                <>
                  {rows.slice(0, visibleCount).map(({ item, nested }) => (
                    <CalendarItemCard
                      key={item.id}
                      nested={nested}
                      item={item}
                      timeZone={timeZone}
                      locale={locale}
                      botName={bots.find((bot) => bot.id === item.botId)?.name}
                      metrics={metrics}
                      onDragStart={onDragStart}
                      onOpen={() => onOpen(item)}
                    />
                  ))}
                  {overflow > 0 && (
                    <DayItemsPopover
                      date={date}
                      entries={entries}
                      today={today}
                      timeZone={timeZone}
                      locale={locale}
                      bots={bots}
                      metrics={metrics}
                      onDragStart={onDragStart}
                      onOpen={onOpen}
                      onOpenDay={onOpenDay}
                      trigger={
                        <button type="button" className="outcome-calendar-more-btn">
                          {t("{count} more", { count: overflow })}
                        </button>
                      }
                    />
                  )}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayBoard({
  date,
  today,
  now,
  nowClock,
  entries,
  timeZone,
  locale,
  bots,
  metrics,
  onDragStart,
  onDrop,
  onOpen,
}: {
  date: string;
  today: string;
  now: Date;
  nowClock: string;
  entries: TimeItem[];
  timeZone: string;
  locale: string;
  bots: OutcomeExecutionBot[];
  metrics: CalendarMetrics;
  onDragStart: (item: TimeItem) => void;
  onDrop: (date: string) => void;
  onOpen: (item: TimeItem) => void;
}) {
  const { t } = useI18n();
  const isToday = date === today;
  const dayEntries = nestFollowUps(entries);
  const followUpsById = new Map(dayEntries.map(({ item, followUps }) => [item.id, followUps]));
  const heads = dayEntries.map((entry) => entry.item);
  const allDayItems = heads.filter((item) => item.allDay);
  const timedItems = heads.filter((item) => !item.allDay);
  const splitColumns = metrics.dayColumns === 2 && allDayItems.length > 0 && timedItems.length > 0;
  const nowMs = now.getTime();

  // Compute chronological index where the live "Now" divider sits among today's timed items.
  const nowInsertIndex = useMemo(() => {
    if (!isToday || timedItems.length === 0) return -1;
    const idx = timedItems.findIndex((item) => {
      const instant = item.start ?? item.end;
      return instant ? Date.parse(instant) >= nowMs : false;
    });
    return idx === -1 ? timedItems.length : idx;
  }, [isToday, nowMs, timedItems]);

  const renderCard = (item: TimeItem, showRail = false) => {
    const time = itemTimeLabel(item, timeZone, locale, t);
    const botName = bots.find((bot) => bot.id === item.botId)?.name;
    const activity = item.kind === "scheduled_once" || item.kind === "group_task" ? styleForActivity(item.state) : null;
    const statusLabel = activity ? t(activity.label) : "";
    const KindIcon = item.overdue ? AlertCircle : kindIcons[item.kind];

    const card = (
      <button
        type="button"
        className="outcome-calendar-day-card"
        data-calendar-item={item.id}
        data-cal-kind={item.kind}
        data-cal-overdue={item.overdue ? "true" : undefined}
        data-cal-done={isItemDone(item) ? "true" : undefined}
        draggable={item.editable}
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-outcomego-calendar", item.id);
          onDragStart(item);
        }}
        onClick={() => onOpen(item)}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">
              {item.title || t("Untitled")}
            </span>
            {item.overdue && (
              <span className="shrink-0 rounded-full bg-destructive/12 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                {t("Overdue")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-secondary tabular-nums">
            <span className="outcome-calendar-day-kind-pill" data-cal-kind={item.kind}>
              <KindIcon aria-hidden="true" className="size-3" strokeWidth={2} />
              <span>{t(kindLabels[item.kind])}</span>
            </span>
            {!showRail && <span>{time}</span>}
            {botName && (
              <>
                <span>·</span>
                <span>{botName}</span>
              </>
            )}
            {statusLabel && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  {activity?.animated && (
                    <span aria-hidden="true" className="outcome-calendar-live-dot" />
                  )}
                  <span>{statusLabel}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </button>
    );

    const followUps = followUpsById.get(item.id) ?? [];
    const body = followUps.length === 0 ? card : (
      <div className="outcome-calendar-day-group">
        {card}
        {followUps.map((followUp) => (
          <CalendarItemCard
            key={followUp.id}
            item={followUp}
            timeZone={timeZone}
            locale={locale}
            botName={bots.find((bot) => bot.id === followUp.botId)?.name}
            metrics={metrics}
            nested
            onDragStart={onDragStart}
            onOpen={() => onOpen(followUp)}
          />
        ))}
      </div>
    );

    if (!showRail) return <Fragment key={item.id}>{body}</Fragment>;
    return (
      <div key={item.id} className="outcome-calendar-day-row">
        <span className="outcome-calendar-day-rail">{time}</span>
        {body}
      </div>
    );
  };

  const renderNowDivider = () => (
    <div className="outcome-calendar-now-line" aria-label={`${t("Now")} ${nowClock}`}>
      <span className="outcome-calendar-now-badge">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-white" />
        <span>
          {t("Now")} · {nowClock}
        </span>
      </span>
      <span className="outcome-calendar-now-rule" aria-hidden="true" />
    </div>
  );

  return (
    <section
      className="outcome-calendar-day"
      data-calendar-day={date}
      data-calendar-today={isToday ? "true" : undefined}
      role="grid"
      aria-label={t("Calendar")}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-outcomego-calendar")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(date);
      }}
    >
      <header className="outcome-calendar-day-head">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[14.5px] font-semibold tracking-tight text-foreground">
            {dateText(dayStart(date, timeZone), timeZone, locale, {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </h3>
          {isToday && (
            <span className="outcome-calendar-today-pill">
              {t("Today")} · {nowClock}
            </span>
          )}
        </div>
        <span className="text-xs text-foreground-secondary tabular-nums">
          {t("{count} items", { count: heads.length })}
        </span>
      </header>
      <div className="outcome-calendar-day-body">
        {entries.length === 0 ? (
          <div className="grid h-full min-h-[160px] place-items-center text-xs text-foreground-secondary">
            {t("Nothing scheduled for this period.")}
          </div>
        ) : (
          <div className="outcome-calendar-day-grid" data-columns={splitColumns ? "2" : "1"}>
            {allDayItems.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-semibold tracking-wide text-foreground-secondary">
                  {t("All day & deadlines")}
                </h4>
                <div className="space-y-2">{allDayItems.map((item) => renderCard(item, false))}</div>
              </div>
            )}
            {timedItems.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-semibold tracking-wide text-foreground-secondary">
                  {t("Timed schedule")}
                </h4>
                <div className="space-y-2">
                  {timedItems.map((item, index) => (
                    <Fragment key={item.id}>
                      {index === nowInsertIndex && renderNowDivider()}
                      {renderCard(item, true)}
                    </Fragment>
                  ))}
                  {nowInsertIndex === timedItems.length && renderNowDivider()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function CalendarPage({
  bots,
  onClose,
  embedded = false,
  onOpenOutcome,
  onOpenChannel,
  onOpenGroupTasks,
  onOpenRoutine,
  refreshVersion = 0,
  onBusyChange,
}: CalendarPageProps) {
  const { t, locale } = useI18n();
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [selectedDate, setSelectedDate] = useState(() => localDateOf(new Date(), browserTimeZone()));
  const [todayPulse, setTodayPulse] = useState(0);
  const [selectedKinds, setSelectedKinds] = useState<TimeItemKind[]>([...defaultCalendarKinds]);
  const [selectedBot, setSelectedBot] = useState("");
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState<TimeItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [externalUnavailable, setExternalUnavailable] = useState<string | null>(null);
  const [dragged, setDragged] = useState<TimeItem | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  const today = useMemo(() => localDateOf(now, timeZone), [now, timeZone]);
  const todayDayNumber = Number(today.slice(8, 10));
  const nowClock = useMemo(
    () =>
      dateText(now, timeZone, locale, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    [locale, now, timeZone]
  );
  const days = useMemo(() => calendarDays(selectedDate, view), [selectedDate, view]);
  const grouped = useMemo(() => itemsByDay(items, timeZone), [items, timeZone]);
  const weekRows = view === "month" ? Math.max(1, Math.ceil(days.length / 7)) : 1;

  const metrics = useMemo(
    () =>
      computeCalendarMetrics({
        width: surfaceSize.width,
        height: surfaceSize.height,
        view,
        weekRows,
      }),
    [surfaceSize.width, surfaceSize.height, view, weekRows]
  );

  // Keep "today" and live clock fresh across minutes, midnight, and wake-from-sleep.
  useEffect(() => {
    const unsubscribe = subscribeDayClock((nextNow) => setNow(nextNow));
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  // Measure the calendar surface so grid density & item limits adapt smoothly on window resize.
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSurfaceSize((current) =>
        Math.round(current.width) === Math.round(rect.width) &&
        Math.round(current.height) === Math.round(rect.height)
          ? current
          : { width: rect.width, height: rect.height }
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const zone = await api.userTimeZone();
      const range = rangeFor(selectedDate, view, zone.timeZone);
      const query = {
        ...range,
        kinds: selectedKinds,
        ...(selectedBot ? { botId: selectedBot } : {}),
        ...(mine ? { mine: true } : {}),
      } satisfies ScheduleQuery;
      const loadSchedule = async (
        kinds: readonly TimeItemKind[],
        fallbackKinds: readonly TimeItemKind[]
      ): Promise<Awaited<ReturnType<typeof api.schedule.list>>> => {
        if (!kinds.length) return { items: [], truncated: false };
        try {
          return await api.schedule.list({ ...query, kinds });
        } catch (cause) {
          const fallback = fallbackKinds.find((kind) => kinds.includes(kind));
          if (!fallback || !(cause instanceof ClientError) || cause.status !== 400 || cause.code !== "invalid_request")
            throw cause;
          return loadSchedule(kinds.filter((kind) => kind !== fallback), fallbackKinds.filter((kind) => kind !== fallback));
        }
      };
      const response = await loadSchedule(selectedKinds, ["group_task", "scheduled_once"]);
      const external = externalSelection();
      let externalItems: TimeItem[] = [];
      let unavailable: string | null = null;
      if (external.connectionId && external.calendarId) {
        const result = await api.externalCalendar.events({ ...external, ...range });
        externalItems = result.items;
        unavailable = result.unavailable?.message ?? null;
      }
      if (request !== generation.current) return;
      setTimeZone(zone.timeZone);
      setExternalUnavailable(unavailable);
      setItems([...response.items, ...externalItems]);
      setTruncated(response.truncated);
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [mine, selectedBot, selectedDate, selectedKinds, view]);

  const lastRefreshVersion = useRef(refreshVersion);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (refreshVersion !== lastRefreshVersion.current) {
      lastRefreshVersion.current = refreshVersion;
      void load();
    }
  }, [refreshVersion, load]);

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  useEffect(() => {
    const refresh = () => void load();
    const unsubscribe = subscribeOutcomeListRefresh(refresh);
    window.addEventListener("outcomego:external-calendar-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      unsubscribe();
      window.removeEventListener("outcomego:external-calendar-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const move = useCallback(
    (direction: number) => setSelectedDate((current) => movePeriod(current, view, direction)),
    [view]
  );

  const jumpToToday = useCallback(() => {
    const freshNow = new Date();
    setNow(freshNow);
    setSelectedDate(localDateOf(freshNow, timeZone));
    setTodayPulse((value) => value + 1);
  }, [timeZone]);

  // Keyboard shortcut: press T to jump back to today when not typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        jumpToToday();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jumpToToday]);

  const openItem = (item: TimeItem) => {
    // To-dos are handled on the dashboard, which an empty ID opens.
    if (item.kind === "todo" || (item.kind === "follow_up" && item.link.type === "outcome")) onOpenOutcome("");
    else if (item.outcomeId) onOpenOutcome(item.outcomeId);
    else if (item.link.type === "channel") {
      const openChannel = item.kind === "group_task" ? onOpenGroupTasks ?? onOpenChannel : onOpenChannel;
      openChannel?.(item.link.id);
    }
    else if (item.link.type === "routine") onOpenRoutine?.(item.link.id, item.botId);
  };

  const reschedule = async (targetDate: string) => {
    if (!dragged || !dragged.editable || itemDate(dragged, timeZone) === targetDate) {
      setDragged(null);
      return;
    }
    const value = shiftedItemValue(dragged, targetDate, timeZone);
    try {
      if (dragged.kind === "goal_due" && dragged.outcomeId && api.outcomes.setDue) {
        await api.outcomes.setDue(dragged.outcomeId, {
          dueAt: value,
          clientRequestId: crypto.randomUUID(),
        });
      } else if (
        (dragged.kind === "work_item" || dragged.kind === "human_task") &&
        dragged.outcomeId &&
        api.outcomes.setWorkItemSchedule
      ) {
        await api.outcomes.setWorkItemSchedule(dragged.outcomeId, dragged.link.id, {
          scheduledAt: dragged.allDay ? undefined : value,
          dueAt: dragged.allDay ? value : undefined,
          clientRequestId: crypto.randomUUID(),
        });
      } else if (dragged.kind === "todo" || dragged.kind === "scheduled_once") {
        await api.schedule.rescheduleOutcome(
          dragged.link.id,
          dragged.allDay ? "dueAt" : "scheduledAt",
          value
        );
      }
      await load();
    } catch {
      setError(true);
    } finally {
      setDragged(null);
    }
  };

  const toggleKind = (kind: TimeItemKind) =>
    setSelectedKinds((current) =>
      current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]
    );

  const soloOrRestoreKind = (kind: TimeItemKind) =>
    setSelectedKinds((current) =>
      current.length === 1 && current[0] === kind ? [...defaultCalendarKinds] : [kind]
    );

  const resetFilters = () => {
    setSelectedKinds([...defaultCalendarKinds]);
    setSelectedBot("");
    setMine(false);
  };

  const activeFilterCount =
    (selectedKinds.length !== defaultCalendarKinds.length ? 1 : 0) +
    (selectedBot ? 1 : 0) +
    (mine ? 1 : 0);

  const isViewingToday =
    view === "month"
      ? isSameMonth(today, selectedDate)
      : periodContainsDate(days, today);

  // Direction to today when viewing away: -1 means today is in the past (left), +1 means future (right).
  const todayDirection = isViewingToday ? 0 : selectedDate > today ? -1 : 1;

  // Typographic split title (primary month/range + secondary year) for crisp hierarchy.
  const periodHeading = useMemo(() => {
    const anchor = dayStart(selectedDate, timeZone);
    if (view === "month") {
      return {
        primary: dateText(anchor, timeZone, locale, { month: "long" }),
        secondary: dateText(anchor, timeZone, locale, { year: "numeric" }),
      };
    }
    if (view === "week" && days.length >= 7) {
      const first = dayStart(days[0]!, timeZone);
      const last = dayStart(days[days.length - 1]!, timeZone);
      return {
        primary: `${dateText(first, timeZone, locale, { month: "short", day: "numeric" })} – ${dateText(
          last,
          timeZone,
          locale,
          { month: "short", day: "numeric" }
        )}`,
        secondary: dateText(first, timeZone, locale, { year: "numeric" }),
      };
    }
    return {
      primary: dateText(anchor, timeZone, locale, { month: "long", day: "numeric" }),
      secondary: dateText(anchor, timeZone, locale, { year: "numeric", weekday: "short" }),
    };
  }, [days, locale, selectedDate, timeZone, view]);

  // Period summary breakdown for wide viewports (shown inline in toolbar at zero vertical cost).
  const periodSummary = useMemo(() => {
    const counts = new Map<TimeItemKind, number>();
    let overdue = 0;
    for (const item of items) {
      if (item.overdue) overdue += 1;
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { kinds, overdue };
  }, [items]);

  const showToolbarSummary = surfaceSize.width >= 940 && !loading && !error && items.length > 0;
  const stageKey = `${view}:${days[0] ?? selectedDate}`;

  const openDayView = (date: string) => {
    setSelectedDate(date);
    setView("day");
  };

  return (
    <section
      className={cn(!embedded && "outcome-page", "flex min-h-0 flex-1 flex-col overflow-hidden")}
      aria-label={t("Calendar")}
    >
      {!embedded && onClose && (
        <header className="outcome-page-header">
          <div className="outcome-page-titlebar electron-drag">
            <h1>
              <CalendarDays
                aria-hidden="true"
                className="size-[17px] text-foreground-secondary"
                strokeWidth={1.6}
              />
              {t("Calendar")}
            </h1>
            <OutcomeButton className="electron-no-drag" variant="ghost" onClick={onClose}>
              {t("Back to outcomes")}
            </OutcomeButton>
          </div>
        </header>
      )}

      <div
        className="outcome-calendar"
        data-compact-toolbar={metrics.compactToolbar ? "true" : undefined}
      >
        <div className="outcome-calendar-toolbar">
          <div className="outcome-calendar-toolbar-group">
            <h2 className="outcome-calendar-period-title">
              <span className="outcome-calendar-period-primary">{periodHeading.primary}</span>
              <span className="outcome-calendar-period-secondary">{periodHeading.secondary}</span>
            </h2>
            <div className="outcome-calendar-nav-group">
              <button
                type="button"
                className="outcome-calendar-icon-btn"
                aria-label={t("Previous period")}
                onClick={() => move(-1)}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                className="outcome-calendar-icon-btn"
                aria-label={t("Next period")}
                onClick={() => move(1)}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <button
              type="button"
              className="outcome-calendar-today-btn"
              data-calendar-today-button=""
              data-away={!isViewingToday ? "true" : "false"}
              onClick={jumpToToday}
              title={t("Back to today")}
            >
              {todayDirection === -1 && <ArrowLeft aria-hidden="true" className="size-3 shrink-0" />}
              <span aria-hidden="true" className="outcome-calendar-mini-day">
                <span className="outcome-calendar-mini-day-cap" />
                <span className="outcome-calendar-mini-day-num">{todayDayNumber}</span>
              </span>
              <span>{isViewingToday ? t("Today") : t("Back to today")}</span>
              {todayDirection === 1 && <ArrowRight aria-hidden="true" className="size-3 shrink-0" />}
            </button>
            {loading && (
              <span className="outcome-calendar-status-pill" role="status">
                <Loader2 className="size-3 animate-spin" />
                {!metrics.compactToolbar && <span>{t("Loading calendar…")}</span>}
              </span>
            )}
            {!loading && !error && items.length === 0 && !metrics.compactToolbar && (
              <span className="outcome-calendar-status-pill">
                {t("Nothing scheduled for this period.")}
              </span>
            )}
          </div>

          <div className="outcome-calendar-toolbar-group">
            {showToolbarSummary && (
              <div className="outcome-calendar-summary">
                {periodSummary.overdue > 0 && (
                  <span className="outcome-calendar-summary-chip" data-cal-overdue="true">
                    <AlertCircle aria-hidden="true" className="size-3" />
                    <span>{t("{count} overdue", { count: periodSummary.overdue })}</span>
                  </span>
                )}
                {periodSummary.kinds.map(([kind, count]) => (
                  <button
                    key={kind}
                    type="button"
                    className="outcome-calendar-summary-chip"
                    data-cal-kind={kind}
                    onClick={() => soloOrRestoreKind(kind)}
                    title={t(kindLabels[kind])}
                  >
                    <span className="outcome-calendar-dot" data-cal-kind={kind} aria-hidden="true" />
                    <span>{t(kindLabels[kind])}</span>
                    <span className="font-semibold text-foreground">{count}</span>
                  </button>
                ))}
              </div>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="outcome-calendar-filter-btn"
                  data-active={activeFilterCount > 0 ? "true" : undefined}
                  aria-label={t("Filters")}
                >
                  <SlidersHorizontal aria-hidden="true" className="size-3.5" />
                  {!metrics.compactToolbar && <span>{t("Filters")}</span>}
                  {activeFilterCount > 0 && (
                    <span className="outcome-calendar-filter-badge">{activeFilterCount}</span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3.5 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">{t("Item types")}</span>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[11px] text-foreground-secondary hover:text-foreground"
                      onClick={resetFilters}
                    >
                      <RotateCcw className="size-3" />
                      {t("Reset filters")}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {defaultCalendarKinds.map((kind) => {
                    const active = selectedKinds.includes(kind);
                    const Icon = kindIcons[kind];
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="outcome-calendar-filter-chip"
                        data-cal-kind={kind}
                        aria-pressed={active}
                        onClick={() => toggleKind(kind)}
                      >
                        <Icon
                          aria-hidden="true"
                          className="outcome-calendar-kind-icon size-3"
                          strokeWidth={2}
                        />
                        <span>{t(kindLabels[kind])}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <label className="block space-y-1 text-[11px] font-medium text-foreground-secondary">
                    <span>{t("Bot")}</span>
                    <select
                      aria-label={t("Bot")}
                      className="outcome-control w-full"
                      value={selectedBot}
                      onChange={(event) => setSelectedBot(event.target.value)}
                    >
                      <option value="">{t("All bots")}</option>
                      {bots.map((bot) => (
                        <option key={bot.id} value={bot.id}>
                          {bot.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-foreground">
                    <input
                      type="checkbox"
                      className="accent-[var(--cal-accent)]"
                      checked={mine}
                      onChange={(event) => setMine(event.target.checked)}
                    />
                    <span>{t("Only mine")}</span>
                  </label>
                </div>
              </PopoverContent>
            </Popover>

            <div
              className="outcome-calendar-segmented"
              role="group"
              aria-label={t("Calendar view")}
            >
              {(["day", "week", "month"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={view === entry}
                  onClick={() => setView(entry)}
                >
                  {t(entry === "day" ? "Day" : entry === "week" ? "Week" : "Month")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {(truncated || error || externalUnavailable) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {truncated && (
              <p
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs"
              >
                {t("Too many items. Narrow the date range or filters.")}
              </p>
            )}
            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/8 px-2.5 py-1 text-xs text-destructive"
              >
                {t("Calendar could not be loaded.")}{" "}
                <button type="button" className="underline" onClick={() => void load()}>
                  {t("Retry")}
                </button>
              </div>
            )}
            {externalUnavailable && (
              <div
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs"
              >
                {t("External calendar overlay unavailable")}: {externalUnavailable}
              </div>
            )}
          </div>
        )}

        <div
          ref={surfaceRef}
          className="outcome-calendar-surface"
          data-calendar-density={metrics.density}
        >
          <div key={stageKey} className="outcome-calendar-stage">
            {view === "month" && (
              <MonthGrid
                days={days}
                selectedDate={selectedDate}
                today={today}
                todayPulse={todayPulse}
                items={grouped}
                timeZone={timeZone}
                locale={locale}
                bots={bots}
                metrics={metrics}
                dragOverDate={dragOverDate}
                onDragOverDate={setDragOverDate}
                onDragStart={setDragged}
                onDrop={(date) => void reschedule(date)}
                onOpen={openItem}
                onOpenDay={openDayView}
              />
            )}
            {view === "week" && (
              <WeekGrid
                days={days}
                today={today}
                todayPulse={todayPulse}
                nowClock={nowClock}
                items={grouped}
                timeZone={timeZone}
                locale={locale}
                bots={bots}
                metrics={metrics}
                dragOverDate={dragOverDate}
                onDragOverDate={setDragOverDate}
                onDragStart={setDragged}
                onDrop={(date) => void reschedule(date)}
                onOpen={openItem}
                onOpenDay={openDayView}
              />
            )}
            {view === "day" && (
              <DayBoard
                date={selectedDate}
                today={today}
                now={now}
                nowClock={nowClock}
                entries={grouped.get(selectedDate) ?? []}
                timeZone={timeZone}
                locale={locale}
                bots={bots}
                metrics={metrics}
                onDragStart={setDragged}
                onDrop={(date) => void reschedule(date)}
                onOpen={openItem}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
