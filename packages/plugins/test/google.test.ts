import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleApi, type Tool } from "../_shared/google";
import { calendarTools } from "../google-calendar/connector/server";
import { driveTools } from "../google-drive/connector/server";

function harness(factory: (api: GoogleApi) => Tool[], responses: any[] = [{}]) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const api = new GoogleApi(
    "https://www.googleapis.com",
    "test-access-token",
    async (input: any, init: any) => {
      requests.push({ url: new URL(String(input)), init });
      return Response.json(responses.shift() ?? {});
    }
  );
  const tools = factory(api);
  return {
    requests,
    tools,
    call: async (name: string, args = {}) => tools.find((t) => t.name === name)!.run(args),
  };
}

test("Calendar free/busy merges overlapping intervals and never treats inaccessible calendars as free", async () => {
  const timeMin = "2026-09-12T09:00:00Z",
    timeMax = "2026-09-12T12:00:00Z";
  const h = harness(calendarTools, [
    {
      calendars: {
        primary: {
          busy: [
            { start: "2026-09-12T09:15:00Z", end: "2026-09-12T10:00:00Z" },
            { start: "2026-09-12T09:45:00Z", end: "2026-09-12T10:30:00Z" },
          ],
        },
      },
    },
    { calendars: { primary: { errors: [{ reason: "notFound" }] } } },
  ]);
  const result: any = await h.call("suggest_time", {
    timeMin,
    timeMax,
    durationMinutes: 30,
    maxResults: 2,
  });
  expect(result.suggestions).toEqual([
    { start: "2026-09-12T10:30:00.000Z", end: "2026-09-12T11:00:00.000Z" },
    { start: "2026-09-12T11:00:00.000Z", end: "2026-09-12T11:30:00.000Z" },
  ]);
  await expect(h.call("suggest_time", { timeMin, timeMax, durationMinutes: 30 })).rejects.toThrow(
    "No availability"
  );
  const rsvp = harness(calendarTools, [
    {
      etag: "version-1",
      attendees: [
        { email: "me@example.com", self: true },
        { email: "other@example.com", responseStatus: "accepted" },
      ],
    },
    {},
  ]);
  await rsvp.call("respond_to_event", { eventId: "event", response: "tentative" });
  expect(rsvp.requests[1]!.init.headers).toMatchObject({ "If-Match": "version-1" });
  expect(JSON.parse(String(rsvp.requests[1]!.init.body)).attendees[1].responseStatus).toBe(
    "accepted"
  );
  expect(h.tools).toHaveLength(9);
});

test("Drive searches escape literals and use public export/upload endpoints", async () => {
  const h = harness(driveTools, [
    {},
    { id: "file", mimeType: "application/vnd.google-apps.document", name: "Document" },
    {},
    {},
  ]);
  await h.call("search_files", { query: "Bob's \\notes", pageToken: "next" });
  expect(h.requests[0]!.url.searchParams.get("q")).toBe(
    "trashed = false and (fullText contains 'Bob\\'s \\\\notes')"
  );
  await h.call("read_file_content", { fileId: "file", exportMimeType: "text/plain" });
  expect(h.requests[2]!.url.pathname).toBe("/drive/v3/files/file/export");
  expect(h.requests[2]!.url.searchParams.get("mimeType")).toBe("text/plain");
  await h.call("create_file", { name: "Test.txt", content: "Hello" });
  expect(h.requests[3]!.url.pathname).toBe("/upload/drive/v3/files");
  expect(Buffer.from(h.requests[3]!.init.body as ArrayBuffer).toString()).toContain("Hello");
  expect(h.tools).toHaveLength(22);
});

test("Google API errors surface actionable messages and redact tokens", async () => {
  const api = new GoogleApi("https://www.googleapis.com", "secret-token", async () =>
    Response.json({ error: { message: "Denied secret-token" } }, { status: 403 })
  );
  await expect(api.request("/drive/v3/files")).rejects.toThrow("Google API 403: Denied [redacted]");
});

test("Google connectors are standalone MCP executables with argument validation and explicit auth errors", async () => {
  // The real transport runs outside Bun's test-runner subprocess shim.
  const directory = await mkdtemp(join(tmpdir(), "plugin-smoke-report-"));
  try {
    const report = join(directory, "result.json");
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/google-mcp-smoke.ts"), report], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(await Bun.file(report).json()).toEqual({ plugins: 2, schemas: 33, offlineSemanticSearch: true, pagedResult: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
