import { useEffect, useState } from "react";
import { localDateOf } from "@outcomego/contracts/task-overview";
import { ClientError } from "../client/http";
import { api } from "../client/outcomego-api";
import { dayStart, shiftDate } from "../components/outcomego/outcomes/calendar/calendar-dates";
import { subscribeDayClock } from "../lib/day-clock";
import {
  countTodayCalendarItems,
  LEGACY_TODAY_CALENDAR_KINDS,
  TODAY_CALENDAR_KINDS,
} from "../lib/outcome-counts";
import { subscribeOutcomeListRefresh } from "../lib/outcome-events";

const REFRESH_INTERVAL_MS = 60_000;

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

async function fetchTodayCalendarCount(): Promise<number> {
  const zone = await api.userTimeZone().catch(() => ({ timeZone: browserTimeZone() }));
  const today = localDateOf(new Date(), zone.timeZone);
  const from = dayStart(today, zone.timeZone).toISOString();
  const to = dayStart(shiftDate(today, 1), zone.timeZone).toISOString();
  try {
    const response = await api.schedule.list({ from, to, kinds: TODAY_CALENDAR_KINDS });
    return countTodayCalendarItems(response.items);
  } catch (cause) {
    if (
      cause instanceof ClientError &&
      cause.status === 400 &&
      cause.code === "invalid_request"
    ) {
      const response = await api.schedule.list({ from, to, kinds: LEGACY_TODAY_CALENDAR_KINDS });
      return countTodayCalendarItems(response.items);
    }
    throw cause;
  }
}

/** Counts today's unfinished goals and to-dos for the sidebar calendar badge. */
export function useTodayCalendarCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let generation = 0;
    const load = () => {
      const request = ++generation;
      fetchTodayCalendarCount()
        .then((next) => {
          if (request !== generation) return;
          setCount((current) => (current === next ? current : next));
        })
        .catch(() => {
          /* Keep the last known count; the next refresh retries. */
        });
    };
    const refreshVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    // subscribeDayClock invokes load() immediately on mount and again on midnight/time-zone changes.
    const unsubscribeDay = subscribeDayClock(() => load());
    const unsubscribeList = subscribeOutcomeListRefresh(load);
    const interval = window.setInterval(refreshVisible, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshVisible);
    return () => {
      generation++;
      unsubscribeDay();
      unsubscribeList();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [enabled]);
  return count;
}
