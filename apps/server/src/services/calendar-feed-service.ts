import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "@outcomego/contracts";
import { CALENDAR_FEED_KINDS, type CalendarFeedKind, type CalendarFeedView, type CreateCalendarFeedInput, type CreatedCalendarFeed } from "@outcomego/contracts/task-overview";
import type { PrismaClient } from "@outcomego/db";
import { readUserTimeZone } from "@outcomego/messaging";
import { calendarFeedWindow, renderCalendarFeed } from "./icalendar";
import type { ScheduleService } from "./schedule-service";

const feedKinds = CALENDAR_FEED_KINDS;
const missing = () => new ApiError(404, "calendar_feed_not_found", "Calendar feed not found");
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const view = (row: { id: string; name: string; kinds: string[]; includeLinks: boolean; createdAt: Date; lastUsedAt: Date | null }): CalendarFeedView => ({
  id: row.id, name: row.name, kinds: row.kinds.filter((kind): kind is CalendarFeedKind => feedKinds.includes(kind as CalendarFeedKind)),
  includeLinks: row.includeLinks, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

export class CalendarFeedService {
  private readonly requests = new Map<string, { until: number; count: number }>();
  private cleanupAfter = 0;

  constructor(
    private readonly db: PrismaClient,
    private readonly schedule: Pick<ScheduleService, "collect">,
    private readonly rate = { maxRequests: 60, windowMs: 60_000 },
  ) {}

  async ownerForSession(mode: "required" | "disabled", sessionId: string | null): Promise<string | null> {
    if (mode === "disabled") return null;
    const session = sessionId && await this.db.session.findUnique({ where: { id: sessionId }, select: { userId: true, expiresAt: true } });
    if (!session || session.expiresAt <= new Date()) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
    return session.userId;
  }

  async list(userId: string | null) {
    const rows = await this.db.calendarFeedToken.findMany({ where: { userId, revokedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return { items: rows.map(view) };
  }

  async create(userId: string | null, input: CreateCalendarFeedInput, origin: string): Promise<CreatedCalendarFeed> {
    const token = randomBytes(32).toString("base64url");
    const row = await this.db.calendarFeedToken.create({ data: { ...input, userId, tokenHash: digest(token) } });
    return { ...view(row), url: new URL(`/calendar/feed/${token}.ics`, origin).href };
  }

  async revoke(userId: string | null, id: string) {
    const result = await this.db.calendarFeedToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw missing();
  }

  async rotate(userId: string | null, id: string, origin: string): Promise<CreatedCalendarFeed> {
    const token = randomBytes(32).toString("base64url");
    const row = await this.db.$transaction(async (tx) => {
      const previous = await tx.calendarFeedToken.updateManyAndReturn({
        where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() }, select: { name: true, kinds: true, includeLinks: true },
      });
      if (!previous[0]) throw missing();
      return tx.calendarFeedToken.create({ data: { ...previous[0], userId, tokenHash: digest(token) } });
    });
    return { ...view(row), url: new URL(`/calendar/feed/${token}.ics`, origin).href };
  }

  async read(token: string, now: Date): Promise<{ ics: string } | { retryAfter: number }> {
    const tokenHash = digest(token);
    const row = await this.db.calendarFeedToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt) throw missing();
    const retryAfter = this.retryAfter(tokenHash, now.getTime());
    if (retryAfter !== null) throwIfRevoked(await this.db.calendarFeedToken.count({ where: { id: row.id, revokedAt: null } }));
    if (retryAfter !== null) return { retryAfter };
    const timeZone = await readUserTimeZone(this.db);
    const { items } = await this.schedule.collect(row.userId ?? "local", { ...calendarFeedWindow(now, timeZone), kinds: view(row).kinds }, now, timeZone, null);
    const ics = renderCalendarFeed(row.name, items, now, row.includeLinks);
    const result = await this.db.calendarFeedToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { lastUsedAt: now } });
    throwIfRevoked(result.count);
    return { ics };
  }

  private retryAfter(hash: string, now: number): number | null {
    if (this.cleanupAfter <= now) {
      for (const [key, entry] of this.requests) if (entry.until <= now) this.requests.delete(key);
      this.cleanupAfter = now + this.rate.windowMs;
    }
    const entry = this.requests.get(hash);
    if (!entry || entry.until <= now) {
      this.requests.set(hash, { until: now + this.rate.windowMs, count: 1 });
      return null;
    }
    if (entry.count >= this.rate.maxRequests) return Math.ceil((entry.until - now) / 1000);
    entry.count++;
    return null;
  }
}

function throwIfRevoked(count: number) {
  if (!count) throw missing();
}
