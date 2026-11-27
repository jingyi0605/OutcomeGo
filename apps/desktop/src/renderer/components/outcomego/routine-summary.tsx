import type { ActivityItem } from "@outcomego/contracts/task-overview";
import { useWindowVisible } from "../../hooks/use-window-active";
import { BellRing, CalendarClock, CirclePause, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../client/outcomego-api";
import { useI18n } from "../../lib/i18n";
import {
  DEFAULT_ROUTINE_SCHEDULE,
  describeRoutineSchedule,
  describeRoutineSchedules,
  type RoutineScheduleDraft,
  type RoutineView,
  routineIsRunning,
  routineEventTriggerLabels,
  routineScheduleDrafts,
  routineSummaryProjectionEqual,
} from "../../lib/routines";
import { LoadingOrb } from "../ui/loading-orb";

const cloneDefaultSchedule = (): RoutineScheduleDraft => ({
  ...DEFAULT_ROUTINE_SCHEDULE,
  advancedMonths: [...DEFAULT_ROUTINE_SCHEDULE.advancedMonths],
  advancedWeekDays: [...DEFAULT_ROUTINE_SCHEDULE.advancedWeekDays],
  advancedMonthDays: [...DEFAULT_ROUTINE_SCHEDULE.advancedMonthDays],
  advancedTimes: [...DEFAULT_ROUTINE_SCHEDULE.advancedTimes],
});

const CHECK_REFRESH_INTERVAL_MS = 15_000;

/** A bot's saved request checks, soonest first. Not routines, but they also wake the bot at a set time. */
export const pendingOutcomeChecks = (items: readonly ActivityItem[]): ActivityItem[] =>
  items
    .filter((item) => item.type === "request" && item.nextCheckAt)
    .sort((left, right) => left.nextCheckAt!.localeCompare(right.nextCheckAt!));

export function RoutinesSummary({
  active,
  ownerId,
  ownerKind,
  onOpen,
  embedded = false,
}: {
  active: boolean;
  ownerId: string;
  ownerKind: "bot" | "group";
  onOpen: (routineId: string | null) => void;
  /** Inside a scrolling settings page: no scroller of its own, a heading even when empty, and Add routine. */
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [routines, setRoutines] = useState<RoutineView[] | null>(null);
  const [checks, setChecks] = useState<ActivityItem[]>([]);
  const visible = useWindowVisible();
  useEffect(() => {
    setRoutines(null);
    setChecks([]);
  }, [active, ownerId, ownerKind]);
  useEffect(() => {
    if (!active || !visible || ownerKind !== "bot") return;
    let stopped = false;
    const refresh = () => {
      api.outcomes
        .activity?.({ botId: ownerId })
        .then((response) => {
          if (!stopped) setChecks(pendingOutcomeChecks(response.items));
        })
        .catch(() => {
          /* Keep the last known checks; the next refresh retries. */
        });
    };
    refresh();
    const timer = window.setInterval(refresh, CHECK_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [active, ownerId, ownerKind, visible]);
  useEffect(() => {
    if (!active || !visible) return;
    let stopped = false;
    let inFlight = false;
    let rerun = false;
    const refresh = async () => {
      if (stopped) return;
      if (inFlight) {
        rerun = true;
        return;
      }
      inFlight = true;
      try {
        const next = await api.routines(ownerId, ownerKind);
        if (!stopped) {
          setRoutines((current) => (routineSummaryProjectionEqual(current, next) ? current : next));
        }
      } catch {
        if (!stopped) setRoutines([]);
      } finally {
        inFlight = false;
        if (!stopped && rerun) {
          rerun = false;
          void refresh();
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [active, ownerId, ownerKind, visible]);

  // Every routine is listed, including event-triggered ones (email, Slack, GitHub, webhook, ...).
  const sorted = useMemo(
    () => [
      ...(routines?.filter((routine) => routine.enabled) ?? []),
      ...(routines?.filter((routine) => !routine.enabled) ?? []),
    ],
    [routines]
  );

  if (embedded) {
    return (
      <section aria-label={t("Routines")} className="mt-6">
        <div className="pl-2 text-[12px] leading-[18px] text-muted-foreground">{t("Routines")}</div>
        {routines === null ? (
          <div className="grid h-10 place-items-center">
            <LoadingOrb label={t("Loading routines")} size={16} />
          </div>
        ) : sorted.length === 0 && checks.length === 0 ? (
          <p className="px-2 py-2 text-[13px] leading-[17px] text-muted-foreground">
            {t("No routines yet")}
          </p>
        ) : (
          <RoutineRows checks={checks} onOpen={onOpen} routines={sorted} />
        )}
        <button
          className="mt-0.5 flex h-9 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[13px] text-foreground-secondary outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/25"
          onClick={() => onOpen(null)}
          type="button"
        >
          <Plus className="size-4" strokeWidth={1.7} />
          {t("Add routine")}
        </button>
      </section>
    );
  }

  if (routines === null) {
    return (
      <div className="grid flex-1 place-items-center">
        <LoadingOrb label={t("Loading routines")} size={16} />
      </div>
    );
  }

  if (sorted.length === 0 && checks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-4">
        <div className="grid max-w-64 gap-3 text-center">
          <p className="text-[13px] leading-[17px] text-muted-foreground">
            {t(
              "Routines are recurring tasks this Bot runs on a schedule. Ask it in chat to set one up."
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 min-h-0 flex-1 overflow-y-auto" data-routines-list="">
      <div className="flex items-center px-1">
        <h2 className="text-[13px] font-medium">{t("Routines")}</h2>
      </div>
      <RoutineRows checks={checks} onOpen={onOpen} routines={sorted} />
    </div>
  );
}

/** One saved request check. It is read-only: the bot owns its time and clears it when the check runs. */
function OutcomeCheckRow({ check }: { check: ActivityItem }) {
  const { t, locale } = useI18n();
  const time = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(check.nextCheckAt!));
  const detail = [
    `${t("Next check")}: ${time}`,
    ...(check.state === "check_not_fired" ? [t("Check did not fire")] : []),
  ].join(" · ");
  return (
    <li
      className="flex min-h-[42px] w-full min-w-0 items-center gap-2 px-2"
      data-outcome-check={check.id}
      title={check.title}
    >
      <span className="grid size-3.5 shrink-0 place-items-center">
        <BellRing className="size-3.5 text-[#0c64c1] dark:text-[#4aa8ff]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">
            {check.relatedOutcome?.title || check.title || t("Untitled")}
          </span>
          <span className="shrink-0 rounded-[5px] border border-border px-1 text-[10px] leading-[14px] text-muted-foreground">
            Outcome
          </span>
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

/** Enabled routines, then pending request checks, then paused routines. */
export function RoutineRows({
  routines,
  checks,
  onOpen,
}: {
  routines: RoutineView[];
  checks: ActivityItem[];
  onOpen: (routineId: string | null) => void;
}) {
  const { t } = useI18n();
  const firstPaused = routines.findIndex((routine) => !routine.enabled);
  const split = firstPaused < 0 ? routines.length : firstPaused;
  const rows = (list: RoutineView[]) =>
    list.map((routine) => {
      const running = routineIsRunning(routine);
      const schedules = routineScheduleDrafts(routine);
      const eventLabels = routineEventTriggerLabels(routine.trigger).map(({ key, params }) =>
        t(key, params)
      );
      const parts = [
        ...(schedules.length > 0 ? [describeRoutineSchedules(schedules)] : []),
        ...eventLabels,
      ];
      const detail = routine.enabled
        ? parts.length > 0
          ? parts.join(" · ")
          : routine.scheduleKind === "event"
            ? t("On an event")
            : describeRoutineSchedule(cloneDefaultSchedule())
        : t("Paused");
      return (
        <li key={routine.id}>
          <button
            className="group flex min-h-[42px] w-full items-center gap-2 rounded-[9px] px-2 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/25"
            onClick={() => onOpen(routine.id)}
            style={{ containIntrinsicSize: "42px", contentVisibility: "auto" }}
            type="button"
          >
            <span className="grid size-3.5 shrink-0 place-items-center">
              {running ? (
                <LoaderCircle className="size-3.5 animate-spin text-[#0c64c1] dark:text-[#4aa8ff]" />
              ) : routine.enabled ? (
                <CalendarClock className="size-3.5 text-[#00673a] dark:text-[#53b782]" />
              ) : (
                <CirclePause className="size-3.5 text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{routine.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
            </span>
          </button>
        </li>
      );
    });
  return (
    <ul aria-label={t("Routines")} className="mt-1 grid gap-1">
      {rows(routines.slice(0, split))}
      {checks.map((check) => (
        <OutcomeCheckRow check={check} key={check.id} />
      ))}
      {rows(routines.slice(split))}
    </ul>
  );
}
