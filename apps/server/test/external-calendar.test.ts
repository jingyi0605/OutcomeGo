import { expect, test } from "bun:test";
import { ExternalCalendarService } from "../src/services/external-calendar-service";

const connection = {
  id: "00000000-0000-4000-8000-000000000001",
  connectorKey: "cal" + "endar",
  status: "ready",
  statusMessage: null,
  installation: { pluginKey: "google-" + "calendar" },
};

function service(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>) {
  const db = {
    pluginConnection: {
      findUnique: async () => connection,
    },
  } as never;
  return new ExternalCalendarService(db, async (_connection, tool, args) => call(tool, args));
}

test("external calendar calls only the two read tools and projects busy events", async () => {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const calendar = service(async (tool, args) => {
    calls.push({ tool, args });
    if (tool === "list_calendars") return { calendars: [{ id: "primary", summary: "Primary", primary: true }] };
    return {
      events: [{
        id: "event-1",
        summary: "Private title",
        start: { dateTime: "2026-11-25T09:00:00Z" },
        end: { dateTime: "2026-11-25T10:00:00Z" },
        updated: "2026-11-24T10:00:00Z",
      }],
    };
  });

  await expect(calendar.calendars(connection.id)).resolves.toEqual({
    calendars: [{ id: "primary", name: "Primary", primary: true }],
  });
  await expect(calendar.events({
    connectionId: connection.id,
    calendarId: "primary",
    from: "2026-11-25T00:00:00Z",
    to: "2026-11-26T00:00:00Z",
    busyOnly: true,
  })).resolves.toMatchObject({
    items: [{ title: "Busy", owner: "external", editable: false, kind: "external_event" }],
  });
  expect(calls.map(({ tool }) => tool)).toEqual(["list_calendars", "list_events"]);
  expect(calls[1]?.args).toMatchObject({ calendarId: "primary", startTime: "2026-11-25T00:00:00.000Z", endTime: "2026-11-26T00:00:00.000Z" });
});

test("external calendar failures degrade to empty results", async () => {
  const calendar = service(async () => {
    throw new Error("authorization expired");
  });
  await expect(calendar.calendars(connection.id)).resolves.toMatchObject({
    calendars: [],
    unavailable: { code: "external_calendar_unavailable", message: "authorization expired" },
  });
});
