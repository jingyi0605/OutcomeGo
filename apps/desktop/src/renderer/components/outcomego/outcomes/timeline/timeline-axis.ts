const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function buildTimelineTicks(axis: { start: string; end: string }) {
  const start = Date.parse(axis.start);
  const end = Date.parse(axis.end);
  const span = end - start;
  const unit = span <= 2 * DAY_MS ? "hour" : span <= 35 * DAY_MS ? "day" : "week";
  const stepSize = unit === "hour" ? HOUR_MS : unit === "day" ? DAY_MS : 7 * DAY_MS;
  const step = Math.max(1, Math.ceil(span / stepSize / 6));
  const tick = new Date(start);
  if (unit === "hour") {
    tick.setTime(start - (tick.getMinutes() * 60 + tick.getSeconds()) * 1000 - tick.getMilliseconds());
  } else {
    tick.setHours(0, 0, 0, 0);
    if (unit === "week") tick.setDate(tick.getDate() - ((tick.getDay() + 6) % 7));
  }
  const dates: Date[] = [];
  while (tick.getTime() <= end) {
    if (tick.getTime() >= start) dates.push(new Date(tick));
    if (unit === "hour") tick.setTime(tick.getTime() + step * HOUR_MS);
    else tick.setDate(tick.getDate() + step * (unit === "day" ? 1 : 7));
  }
  return { unit, dates: dates.length ? dates : [new Date(start)] };
}
