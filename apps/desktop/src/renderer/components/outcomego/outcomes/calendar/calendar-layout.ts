import type { CalendarView } from "./calendar-dates";

export type CalendarDensity = "detailed" | "comfortable" | "compact" | "minimal";

export interface CalendarMetrics {
  density: CalendarDensity;
  /** Maximum item slots when every item fits without a "+N more" footer. */
  maxVisibleItems: number;
  /** Maximum item slots when a "+N more" overflow trigger must share the cell. */
  maxVisibleItemsWithOverflow: number;
  showTime: boolean;
  showMeta: boolean;
  showTodayLabel: boolean;
  weekdayFormat: "short" | "narrow";
  compactToolbar: boolean;
  dayColumns: 1 | 2;
}

const DEFAULT_METRICS: CalendarMetrics = {
  density: "comfortable",
  maxVisibleItems: 3,
  maxVisibleItemsWithOverflow: 3,
  showTime: true,
  showMeta: true,
  showTodayLabel: true,
  weekdayFormat: "short",
  compactToolbar: false,
  dayColumns: 1,
};

/**
 * Computes how much detail each calendar cell should show so the whole calendar
 * fits inside the viewport without scrolling while degrading gracefully on
 * smaller windows.
 */
export function computeCalendarMetrics({
  width,
  height,
  view,
  weekRows,
}: {
  width: number;
  height: number;
  view: CalendarView;
  weekRows: number;
}): CalendarMetrics {
  if (width <= 0 || height <= 0) return DEFAULT_METRICS;

  const compactToolbar = width < 640;

  if (view === "day") {
    const density: CalendarDensity =
      width < 520 ? "compact" : width < 760 ? "comfortable" : "detailed";
    return {
      density,
      maxVisibleItems: Number.POSITIVE_INFINITY,
      maxVisibleItemsWithOverflow: Number.POSITIVE_INFINITY,
      showTime: true,
      showMeta: density !== "compact",
      showTodayLabel: true,
      weekdayFormat: "short",
      compactToolbar,
      dayColumns: width >= 840 ? 2 : 1,
    };
  }

  if (view === "week") {
    const colWidth = width / 7;
    const headerHeight = colWidth < 88 ? 48 : 56;
    const bodyHeight = Math.max(0, height - headerHeight);
    const density: CalendarDensity =
      colWidth < 76
        ? "minimal"
        : colWidth < 112
          ? "compact"
          : colWidth < 156
            ? "comfortable"
            : "detailed";

    if (density === "minimal") {
      return {
        density,
        maxVisibleItems: 0,
        maxVisibleItemsWithOverflow: 0,
        showTime: false,
        showMeta: false,
        showTodayLabel: false,
        weekdayFormat: "narrow",
        compactToolbar,
        dayColumns: 1,
      };
    }

    const itemHeight = density === "detailed" ? 54 : density === "comfortable" ? 40 : 25;
    const padding = 16;
    const overflowFooter = 24;
    const maxVisibleItems = Math.max(1, Math.floor((bodyHeight - padding) / itemHeight));
    const maxVisibleItemsWithOverflow = Math.max(
      1,
      Math.floor((bodyHeight - padding - overflowFooter) / itemHeight)
    );

    return {
      density,
      maxVisibleItems,
      maxVisibleItemsWithOverflow,
      showTime: density !== "compact" || colWidth >= 100,
      showMeta: density === "detailed",
      showTodayLabel: colWidth >= 108,
      weekdayFormat: colWidth < 82 ? "narrow" : "short",
      compactToolbar,
      dayColumns: 1,
    };
  }

  // Month view: 7 columns x N week rows (4..6), strictly viewport-fitted.
  const rows = Math.max(1, weekRows);
  const headerHeight = 32;
  const cellWidth = width / 7;
  const cellHeight = Math.max(0, (height - headerHeight) / rows);

  let density: CalendarDensity;
  if (cellHeight < 64 || cellWidth < 74) density = "minimal";
  else if (cellHeight < 102 || cellWidth < 112) density = "compact";
  else if (cellHeight < 142 || cellWidth < 152) density = "comfortable";
  else density = "detailed";

  if (density === "minimal") {
    return {
      density,
      maxVisibleItems: 0,
      maxVisibleItemsWithOverflow: 0,
      showTime: false,
      showMeta: false,
      showTodayLabel: false,
      weekdayFormat: cellWidth < 80 ? "narrow" : "short",
      compactToolbar,
      dayColumns: 1,
    };
  }

  const cellChrome = density === "compact" ? 30 : 34;
  const itemHeight = density === "detailed" ? 48 : density === "comfortable" ? 36 : 22;
  const overflowFooter = 20;
  const usable = Math.max(0, cellHeight - cellChrome);
  const maxVisibleItems = Math.max(1, Math.floor(usable / itemHeight));
  const maxVisibleItemsWithOverflow = Math.max(
    1,
    Math.floor(Math.max(0, usable - overflowFooter) / itemHeight)
  );

  return {
    density,
    maxVisibleItems,
    maxVisibleItemsWithOverflow,
    showTime: density !== "compact" || cellWidth >= 122,
    showMeta: density === "detailed" || (density === "comfortable" && cellHeight >= 122),
    showTodayLabel: cellWidth >= 104 && cellHeight >= 76,
    weekdayFormat: cellWidth < 82 ? "narrow" : "short",
    compactToolbar,
    dayColumns: 1,
  };
}

/** Returns how many items to render inline before collapsing the rest into "+N more". */
export function visibleCountForCell(totalItems: number, metrics: CalendarMetrics): number {
  if (metrics.density === "minimal" || totalItems <= 0) return 0;
  if (totalItems <= metrics.maxVisibleItems) return totalItems;
  return Math.min(totalItems, metrics.maxVisibleItemsWithOverflow);
}

export function isSameMonth(date: string, anchorDate: string): boolean {
  return date.slice(0, 7) === anchorDate.slice(0, 7);
}

export function isWeekend(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function periodContainsDate(days: readonly string[], targetDate: string): boolean {
  return days.includes(targetDate);
}

export function isFirstOfMonth(date: string): boolean {
  return date.endsWith("-01");
}
