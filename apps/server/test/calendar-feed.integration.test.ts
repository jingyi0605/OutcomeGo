import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { calendarFeedResponse, createCalendarFeedRoutes } from "../src/routes/calendar-feed";
import type { RouteContext } from "../src/routes/context";
import { CalendarFeedService } from "../src/services/calendar-feed-service";
import { ScheduleService } from "../src/services/schedule-service";

const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-03-08T16:00:00Z");

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const fixture = await outcomeThreadFixture();
  const { db } = fixture;
  const ownerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const session = (id: string) => ({ id, token: id, expiresAt: new Date("2099-01-01T00:00:00Z") });
  await db.user.create({ data: { id: ownerId, name: "Fixture", email: `${ownerId}@example.test`, sessions: { create: session(ownerId) } } });
  await db.user.create({ data: { id: otherId, name: "Other", email: `${otherId}@example.test`, sessions: { create: session(otherId) } } });
  const schedule = new ScheduleService(db);
  const feeds = new CalendarFeedService(db, schedule, { maxRequests: 2, windowMs: 60_000 });
  const route = createCalendarFeedRoutes(feeds);
  const call = (path: string, method: string, sessionId: string | null, body?: unknown) => {
    const url = new URL(path, "https://calendar.example.test");
    const request = new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    return route({ path: url.pathname, url, request, authenticatedSessionId: sessionId, authMode: "required" } as RouteContext);
  };
  cleanups.push(fixture.cleanup, async () => {
    await db.outcome.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  });
  return { ...fixture, ownerId, otherId, feeds, call, schedule };
}

describe.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("calendar feed", () => {
  test("creates one-time URLs, scopes management, rotates atomically, revokes and rate-limits per digest", async () => {
    const { db, ownerId, otherId, feeds, call } = await setup();
    const root = "/api/calendar/feeds";
    const body = { name: "Fixture", kinds: ["todo"] };
    await expect(call(root, "GET", null)).rejects.toMatchObject({ status: 401 });
    await expect(call(root, "POST", ownerId, { ...body, kinds: ["external_event"] })).rejects.toMatchObject({ status: 400 });
    const created = await call(root, "POST", ownerId, body);
    expect(created?.status).toBe(201);
    const { id, url } = await created!.json();
    expect(url).toMatch(/^https:\/\/calendar\.example\.test\/calendar\/feed\/[\w-]{43}\.ics$/);
    const token = url.match(/\/([^/]+)\.ics$/)[1];
    const stored = await db.calendarFeedToken.findUniqueOrThrow({ where: { id } });
    expect(stored.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);
    const listed = await (await call(root, "GET", ownerId))!.json();
    expect(listed.items).toMatchObject([{ id, name: "Fixture", kinds: ["todo"], includeLinks: false }]);
    expect(JSON.stringify(listed)).not.toMatch(/url|tokenHash/);
    expect(await (await call(root, "GET", otherId))!.json()).toEqual({ items: [] });
    await expect(call(`${root}/${id}`, "DELETE", otherId)).rejects.toMatchObject({ status: 404 });

    const get = (link: string) => calendarFeedResponse(feeds, new Request(link), new URL(link).pathname, now);
    const missingUrl = url.replace(token, "z".repeat(43));
    const missing = await get(missingUrl);
    expect(missing?.status).toBe(404);
    const missingBody = await missing?.text();
    expect((await get(url))?.status).toBe(200);
    expect((await get(url))?.status).toBe(200);
    expect((await get(url))?.status).toBe(429);

    const rotations = await Promise.allSettled([call(`${root}/${id}/rotate`, "POST", ownerId), call(`${root}/${id}/rotate`, "POST", ownerId)]);
    const successes = rotations.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    const rotated = await successes[0]!.value!.json();
    expect(rotated.url).not.toBe(url);
    const old = await get(url);
    expect(old?.status).toBe(404);
    expect(await old?.text()).toBe(missingBody);
    expect((await get(rotated.url))?.status).toBe(200);
    expect((await call(`${root}/${rotated.id}`, "DELETE", ownerId))?.status).toBe(204);
    expect((await get(rotated.url))?.status).toBe(404);
  });

  test("uses feed-only auth, filters dates, hides foreign data, and redacts unexpected errors", async () => {
    const { db, ownerId, otherId, feeds, schedule } = await setup();
    const settings = await db.userTimeZoneSettings.findUnique({ where: { id: "global" } });
    await db.userTimeZoneSettings.upsert({ where: { id: "global" }, create: { override: "UTC" }, update: { override: "UTC" } });
    cleanups.push(async () => {
      if (settings) await db.userTimeZoneSettings.update({ where: { id: "global" }, data: { override: settings.override } });
      else await db.userTimeZoneSettings.delete({ where: { id: "global" } });
    });
    for (const [title, timestamp, owner] of [
      ["First", "2026-02-06T00:00:00Z", ownerId], ["Last", "2026-09-04T23:59:59Z", ownerId],
      ["Too early", "2026-02-05T23:59:59Z", ownerId], ["Too late", "2026-09-05T00:00:00Z", ownerId],
      ["Different owner", "2026-03-08T15:00:00Z", otherId],
    ] as const) {
      await db.outcome.create({
        data: {
          ownerId: owner,
          kind: "todo",
          title,
          description: "private note",
          executor: "owner",
          status: "open",
          createdBy: owner,
          scheduledAt: new Date(timestamp),
        },
      });
    }
    await db.outcome.create({
      data: {
        ownerId,
        kind: "note",
        title: "Timed note",
        status: "active",
        description: "private note",
        scheduledAt: new Date("2026-03-10T09:00:00Z"),
      },
    });
    await db.outcome.create({
      data: {
        ownerId,
        kind: "note",
        title: "Archived note",
        status: "archived",
        description: "private note",
        scheduledAt: new Date("2026-03-10T10:00:00Z"),
      },
    });
    await db.outcome.create({
      data: {
        ownerId,
        kind: "note",
        title: "Due note",
        status: "active",
        dueAt: new Date("2026-03-11T09:00:00Z"),
      },
    });
    await db.outcome.create({
      data: {
        ownerId,
        kind: "note",
        title: "Cancelled note",
        status: "cancelled",
        scheduledAt: new Date("2026-03-10T11:00:00Z"),
      },
    });
    await db.outcome.create({
      data: {
        ownerId,
        kind: "note",
        title: "Untimed note",
        status: "active",
      },
    });
    const { url } = await feeds.create(ownerId, { name: "Fixture", kinds: ["todo", "note"], includeLinks: false }, "https://calendar.example.test");
    const path = new URL(url).pathname;
    const methodResponse = await calendarFeedResponse(feeds, new Request(url, { method: "HEAD" }), path, now);
    expect(methodResponse?.status).toBe(405);
    const response = await calendarFeedResponse(feeds, new Request(url), path, now);
    expect(response?.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    const text = await response?.text();
    expect(text).toContain("SUMMARY:First");
    expect(text).toContain("SUMMARY:Last");
    expect(text).toContain("SUMMARY:Timed note");
    expect(text).toContain("SUMMARY:Due note");
    expect(text).not.toMatch(/Too early|Too late|Different owner|private note|DESCRIPTION:|URL:/);
    expect(text).not.toMatch(/SUMMARY:(Archived|Cancelled|Untimed) note/);

    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const failure = spyOn(schedule, "collect").mockRejectedValueOnce(new Error(url));
    try {
      const failed = await calendarFeedResponse(feeds, new Request(url), path, now);
      expect(failed?.status).toBe(500);
      expect(await failed?.text()).not.toContain(url);
      expect(log).toHaveBeenCalledWith("Calendar feed request failed: GET /calendar/feed/[redacted].ics");
      expect(JSON.stringify(log.mock.calls)).not.toContain(url);
    } finally {
      log.mockRestore();
      failure.mockRestore();
    }
  });
});
