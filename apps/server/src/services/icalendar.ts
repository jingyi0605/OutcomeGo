import { outcomeDeepLink } from "@outcomego/contracts/app-deep-links";
import { localDateOf, type TimeItem } from "@outcomego/contracts/task-overview";

const dayMs = 86_400_000;

function localDayBoundary(date: string, zone: string): Date {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  let left = midnight - dayMs;
  let right = midnight + dayMs;
  while (left < right) {
    const midpoint = Math.floor((left + right) / 2);
    if (localDateOf(new Date(midpoint), zone) < date) left = midpoint + 1;
    else right = midpoint;
  }
  return new Date(left);
}

export function calendarFeedWindow(now: Date, timeZone: string) {
  const today = Date.parse(`${localDateOf(now, timeZone)}T00:00:00Z`);
  const boundary = (days: number) => localDayBoundary(new Date(today + days * dayMs).toISOString().slice(0, 10), timeZone);
  return { from: boundary(-30), to: boundary(181) };
}

const text = (value: string) => value.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/[;,]/g, "\\$&")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, "");
const dateValue = (value: string) => value.replaceAll("-", "");

function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const lines: string[] = [];
  let chunk = "";
  let size = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (size + bytes > 75) {
      lines.push(chunk);
      chunk = " ";
      size = 1;
    }
    chunk += character;
    size += bytes;
  }
  return [...lines, chunk].join("\r\n");
}

export function renderCalendarFeed(name: string, items: readonly TimeItem[], now: Date, includeLinks: boolean): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OutcomeGo//Calendar Feed//EN", "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${text(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  const generatedAt = stamp(now.toISOString());
  for (const item of items) {
    const start = item.start ?? item.end;
    if (!start || item.kind === "external_event") continue;
    const time = item.allDay ? dateValue : stamp;
    const parameter = item.allDay ? ";VALUE=DATE" : "";
    lines.push("BEGIN:VEVENT", `UID:${text(item.id)}@calendar.outcomego.local`, `DTSTAMP:${generatedAt}`,
      `LAST-MODIFIED:${stamp(item.updatedAt)}`, `DTSTART${parameter}:${time(start)}`);
    if (item.start && item.end && item.end > item.start) lines.push(`DTEND${parameter}:${time(item.end)}`);
    lines.push(`SUMMARY:${text(item.title)}`);
    if (includeLinks && item.outcomeId) lines.push(`URL:${outcomeDeepLink(item.outcomeId)}`);
    lines.push("END:VEVENT");
  }
  return [...lines.map(fold), "END:VCALENDAR", ""].join("\r\n");
}
