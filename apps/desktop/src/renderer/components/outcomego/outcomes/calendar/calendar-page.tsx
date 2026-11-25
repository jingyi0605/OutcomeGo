import { CalendarDays, ChevronLeft, ChevronRight, Filter, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScheduleQuery, TimeItem, TimeItemKind } from "@outcomego/contracts/task-overview";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { api } from "../../../../client/outcomego-api";
import { localDateOf } from "@outcomego/contracts/task-overview";
import { useI18n } from "../../../../lib/i18n";
import { cn } from "../../../../lib/cn";
import { OutcomeButton } from "../outcome-ui";
import { calendarDays, dayStart, defaultCalendarKinds, itemsByDay, movePeriod, moveToCalendarDate, type CalendarView } from "./calendar-dates";

const kindLabels: Record<TimeItemKind, string> = {
  goal_due: "Goal deadlines",
  human_task: "Human tasks",
  work_item: "Bot tasks",
  todo: "To-dos",
  follow_up: "Follow-ups",
  routine_run: "Routines",
  external_event: "External calendar",
};

type CalendarPageProps = {
  bots: OutcomeExecutionBot[];
  onClose: () => void;
  onOpenOutcome: (outcomeId: string) => void;
  onOpenChannel?: (channelId: string) => void;
  onOpenRoutine?: (routineId: string) => void;
};

function dateText(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(value);
}

function rangeFor(value: string, view: CalendarView, timeZone: string): { from: string; to: string } {
  const days = calendarDays(value, view);
  const from = dayStart(days[0]!, timeZone);
  const to = new Date(dayStart(days.at(-1)!, timeZone).getTime() + 86_400_000);
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

function CalendarItem({ item, timeZone, onDragStart, onOpen }: { item: TimeItem; timeZone: string; onDragStart: (item: TimeItem) => void; onOpen: () => void }) {
  const { t } = useI18n();
  const time = item.allDay ? t("All day") : dateText(new Date(item.start ?? item.end ?? Date.now()), timeZone, { hour: "numeric", minute: "2-digit" });
  return (
    <button
      type="button"
      className={cn("group w-full rounded-md border px-2 py-1 text-left text-xs transition-colors hover:bg-hover", item.overdue ? "border-destructive/60 text-destructive" : "border-border")}
      data-calendar-item={item.id}
      draggable={item.editable}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-outcomego-calendar", item.id);
        onDragStart(item);
      }}
      onClick={onOpen}
      title={item.editable ? t("Drag to change the date") : t("Read-only calendar item")}
    >
      <span className="block truncate font-medium">{item.title || t("Untitled")}</span>
      <span className="block truncate text-[10px] text-foreground-secondary">{time}{item.overdue ? ` · ${t("Overdue")}` : ""}</span>
    </button>
  );
}

function CalendarGrid({ days, view, items, timeZone, onDragStart, onDrop, onOpen }: { days: string[]; view: CalendarView; items: Map<string, TimeItem[]>; timeZone: string; onDragStart: (item: TimeItem) => void; onDrop: (date: string) => void; onOpen: (item: TimeItem) => void }) {
  const { t } = useI18n();
  return (
    <div className={cn("grid min-h-[420px] gap-px overflow-hidden rounded-lg border border-border bg-border", view === "day" ? "grid-cols-1" : "grid-cols-7")} role="grid" aria-label={t("Calendar") }>
      {days.map((date) => {
        const entries = items.get(date) ?? [];
        return (
          <section key={date} className={cn("min-h-[116px] bg-background p-2", view === "day" && "min-h-[420px]")} data-calendar-day={date} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-outcomego-calendar")) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); onDrop(date); }}>
            <h3 className="mb-2 flex items-center justify-between text-xs font-semibold text-foreground-secondary">
              <span>{dateText(dayStart(date, timeZone), timeZone, { weekday: view === "day" ? "long" : "short", month: "short", day: "numeric" })}</span>
              {entries.length > 0 && <span className="rounded-full bg-subtle px-1.5 py-0.5 tabular-nums">{entries.length}</span>}
            </h3>
            <div className="space-y-1">
              {entries.slice(0, view === "month" ? 3 : undefined).map((item) => <CalendarItem key={item.id} item={item} timeZone={timeZone} onDragStart={(value) => { onDragStart(value); }} onOpen={() => onOpen(item)} />)}
              {view === "month" && entries.length > 3 && <p className="px-1 text-[10px] text-foreground-secondary">{t("{count} more", { count: entries.length - 3 })}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CalendarPage({ bots, onClose, onOpenOutcome, onOpenChannel, onOpenRoutine }: CalendarPageProps) {
  const { t } = useI18n();
  const [timeZone, setTimeZone] = useState("UTC");
  const [view, setView] = useState<CalendarView>("month");
  const [selectedDate, setSelectedDate] = useState(() => localDateOf(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  const [selectedKinds, setSelectedKinds] = useState<TimeItemKind[]>([...defaultCalendarKinds]);
  const [selectedBot, setSelectedBot] = useState("");
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState<TimeItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dragged, setDragged] = useState<TimeItem | null>(null);
  const days = useMemo(() => calendarDays(selectedDate, view), [selectedDate, view]);
  const grouped = useMemo(() => itemsByDay(items, timeZone), [items, timeZone]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [zone, response] = await Promise.all([api.userTimeZone(), api.schedule.list({ ...rangeFor(selectedDate, view, timeZone), kinds: selectedKinds, ...(selectedBot ? { botId: selectedBot } : {}), ...(mine ? { mine: true } : {}) } satisfies ScheduleQuery)]);
      setTimeZone(zone.timeZone);
      setItems(response.items);
      setTruncated(response.truncated);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [mine, selectedBot, selectedDate, selectedKinds, timeZone, view]);
  useEffect(() => { void load(); }, [load]);

  const move = (amount: number) => {
    setSelectedDate(movePeriod(selectedDate, view, amount));
  };
  const openItem = (item: TimeItem) => {
    if (item.outcomeId) return onOpenOutcome(item.outcomeId);
    if (item.link.type === "channel") return onOpenChannel?.(item.link.id);
    if (item.link.type === "routine") return onOpenRoutine?.(item.link.id);
  };
  const reschedule = async (date: string) => {
    if (!dragged || !dragged.editable) return;
    const value = shiftedItemValue(dragged, date, timeZone);
    try {
      if (dragged.kind === "goal_due" && dragged.outcomeId && api.outcomes.setDue) await api.outcomes.setDue(dragged.outcomeId, { dueAt: value, clientRequestId: crypto.randomUUID() });
      else if ((dragged.kind === "work_item" || dragged.kind === "human_task") && dragged.outcomeId && api.outcomes.setWorkItemSchedule) await api.outcomes.setWorkItemSchedule(dragged.outcomeId, dragged.link.id, { scheduledAt: dragged.allDay ? undefined : value, dueAt: dragged.allDay ? value : undefined, clientRequestId: crypto.randomUUID() });
      else if (dragged.kind === "todo") await api.schedule.rescheduleTodo(dragged.link.id, dragged.allDay ? "dueAt" : "scheduledAt", value);
      await load();
    } catch {
      setError(true);
    } finally {
      setDragged(null);
    }
  };
  const toggleKind = (kind: TimeItemKind) => setSelectedKinds((current) => current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]);
  const title = view === "month" ? dateText(dayStart(selectedDate, timeZone), timeZone, { month: "long", year: "numeric" }) : dateText(dayStart(selectedDate, timeZone), timeZone, { month: "long", day: "numeric", year: "numeric" });

  return (
    <section className="outcome-page flex min-h-0 flex-1 flex-col" aria-label={t("Calendar") }>
      <header className="outcome-page-header">
        <div className="outcome-page-titlebar electron-drag">
          <h1><CalendarDays aria-hidden="true" className="size-[17px] text-foreground-secondary" strokeWidth={1.6} />{t("Calendar")}</h1>
          <OutcomeButton className="electron-no-drag" variant="ghost" onClick={onClose}>{t("Back to outcomes")}</OutcomeButton>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <OutcomeButton aria-label={t("Previous period")} variant="ghost" size="icon" onClick={() => move(-1)}><ChevronLeft className="size-4" /></OutcomeButton>
          <OutcomeButton variant="ghost" onClick={() => setSelectedDate(localDateOf(new Date(), timeZone))}><RotateCcw className="mr-1 size-3.5" />{t("Today")}</OutcomeButton>
          <OutcomeButton aria-label={t("Next period")} variant="ghost" size="icon" onClick={() => move(1)}><ChevronRight className="size-4" /></OutcomeButton>
          <h2 className="min-w-[150px] flex-1 text-center text-sm font-semibold">{title}</h2>
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label={t("Calendar view")}>{(["day", "week", "month"] as const).map((entry) => <button key={entry} type="button" className={cn("rounded px-2 py-1 text-xs", view === entry && "bg-selected font-medium")} aria-pressed={view === entry} onClick={() => setView(entry)}>{t(entry === "day" ? "Day" : entry === "week" ? "Week" : "Month")}</button>)}</div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="outcome-page-content space-y-4">
        <div className="rounded-lg border border-border bg-subtle/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><Filter className="size-3.5" />{t("Filters")}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {defaultCalendarKinds.map((kind) => <label key={kind} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={selectedKinds.includes(kind)} onChange={() => toggleKind(kind)} />{t(kindLabels[kind])}</label>)}
            <select aria-label={t("Bot")} className="rounded border border-border bg-background px-2 py-1" value={selectedBot} onChange={(event) => setSelectedBot(event.target.value)}><option value="">{t("All bots")}</option>{bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />{t("Only mine")}</label>
          </div>
        </div>
        {truncated && <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">{t("Too many items. Narrow the date range or filters.")}</p>}
        {error && <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">{t("Calendar could not be loaded.")} <button className="underline" onClick={() => void load()}>{t("Retry")}</button></div>}
        {loading ? <p role="status">{t("Loading calendar…")}</p> : items.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-foreground-secondary">{t("Nothing scheduled for this period.")}</div> : <CalendarGrid days={days} view={view} items={grouped} timeZone={timeZone} onDragStart={(item) => setDragged(item)} onDrop={(date) => void reschedule(date)} onOpen={openItem} />}
      </div></div>
    </section>
  );
}
