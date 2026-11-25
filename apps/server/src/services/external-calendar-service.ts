import { ApiError } from "@outcomego/contracts";
import type { ExternalCalendarListResponse, ExternalCalendarResponse, TimeItem } from "@outcomego/contracts/task-overview";
import type { PrismaClient } from "@outcomego/db";
import { SCHEDULE_RANGE_DAYS } from "@outcomego/contracts/task-overview";
import { parseOffsetTimestamp } from "@outcomego/contracts/outcomes";
import type { PollableConnection } from "./plugin/events";

const dayMs = 86_400_000;
const allowedTools = new Set(["list_calendars", "list_events"]);
const unavailable = (code: string, message: string) => ({ unavailable: { code, message } });

type CallHostTool = (connection: PollableConnection, toolName: string, args: Record<string, unknown>) => Promise<unknown>;

export class ExternalCalendarService {
  constructor(private readonly db: PrismaClient, private readonly callHostTool: CallHostTool) {}

  async calendars(connectionId: string): Promise<ExternalCalendarListResponse> {
    try {
      const connection = await this.connection(connectionId);
      const result = await this.call(connection, "list_calendars", { pageSize: 100 });
      const rows = this.array(result, "calendars", "items");
      return {
        calendars: rows.flatMap((row) => {
          const id = this.string(row.id);
          if (!id) return [];
          return [{ id, name: this.string(row.summary) ?? id, primary: row.primary === true }];
        }),
      };
    } catch (error) {
      return { calendars: [], ...unavailable(this.errorCode(error), this.errorMessage(error)) };
    }
  }

  async events(input: { connectionId: string; calendarId: string; from: string; to: string; busyOnly: boolean }): Promise<ExternalCalendarResponse> {
    try {
      const from = parseOffsetTimestamp(input.from);
      const to = parseOffsetTimestamp(input.to);
      if (!from || !to || from >= to || to.getTime() - from.getTime() > SCHEDULE_RANGE_DAYS * dayMs)
        throw new ApiError(400, "invalid_range", "Use an increasing range of at most 93 days with UTC offsets");
      const connection = await this.connection(input.connectionId);
      const result = await this.call(connection, "list_events", {
        calendarId: input.calendarId,
        startTime: from.toISOString(),
        endTime: to.toISOString(),
        pageSize: 250,
      });
      const rows = this.array(result, "events", "items");
      return {
        items: rows.flatMap((row) => {
          const start = this.dateValue(row.start);
          const end = this.dateValue(row.end);
          const id = this.string(row.id);
          if (!id || !start || !end) return [];
          const allDay = Boolean(row.start && typeof row.start === "object" && "date" in row.start);
          const updatedAt = this.string(row.updated) ?? new Date().toISOString();
          const item: TimeItem = {
            id: `external_event:${input.connectionId}:${input.calendarId}:${id}`,
            kind: "external_event",
            title: input.busyOnly ? "Busy" : this.string(row.summary) ?? "Busy",
            start: allDay ? null : start,
            end,
            allDay,
            timeBasis: "actual",
            state: "scheduled",
            overdue: false,
            owner: "external",
            link: { type: "external", id },
            editable: false,
            updatedAt,
          };
          return [item];
        }),
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) throw error;
      return { items: [], ...unavailable(this.errorCode(error), this.errorMessage(error)) };
    }
  }

  private async connection(id: string) {
    const connection = await this.db.pluginConnection.findUnique({
      where: { id },
      include: { installation: { select: { pluginKey: true } } },
    });
    if (!connection || connection.installation.pluginKey !== "google-calendar" || connection.connectorKey !== "calendar")
      throw new ApiError(404, "external_calendar_unavailable", "Calendar connection not found");
    if (connection.status !== "ready") throw new ApiError(409, "external_calendar_unavailable", connection.statusMessage ?? "Calendar connection is unavailable");
    return connection;
  }

  private call(connection: Awaited<ReturnType<ExternalCalendarService["connection"]>>, tool: string, args: Record<string, unknown>) {
    if (!allowedTools.has(tool)) throw new ApiError(403, "external_calendar_tool_denied", "Calendar tool is not allowed");
    return this.callHostTool(connection as unknown as PollableConnection, tool, args);
  }

  private array(value: unknown, ...keys: string[]): Record<string, unknown>[] {
    if (!value || typeof value !== "object") return [];
    for (const key of keys) {
      const rows = (value as Record<string, unknown>)[key];
      if (Array.isArray(rows)) return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
    }
    return [];
  }

  private string(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private dateValue(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    return this.string(row.dateTime) ?? this.string(row.date);
  }

  private errorCode(error: unknown): string {
    return error instanceof ApiError ? error.code : "external_calendar_unavailable";
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 300) : "Calendar data is unavailable";
  }
}
