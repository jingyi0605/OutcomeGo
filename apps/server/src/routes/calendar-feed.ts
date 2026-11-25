import { ApiError } from "@outcomego/contracts";
import { CALENDAR_FEED_KINDS, type CalendarFeedKind, type CreateCalendarFeedInput } from "@outcomego/contracts/task-overview";
import { corsHeaders, errorResponse, json } from "../http";
import type { CalendarFeedService } from "../services/calendar-feed-service";
import type { RouteContext } from "./context";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

function parseInput(value: unknown): CreateCalendarFeedInput {
  const input = value as Partial<CreateCalendarFeedInput> | null;
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80 || !Array.isArray(input?.kinds) || !input.kinds.length || input.kinds.length > CALENDAR_FEED_KINDS.length ||
      !input.kinds.every((kind) => CALENDAR_FEED_KINDS.includes(kind)) ||
      (input.includeLinks !== undefined && typeof input.includeLinks !== "boolean")) {
    throw new ApiError(400, "invalid_request", "Use a title and select at least one supported calendar item kind");
  }
  return { name, kinds: [...new Set<CalendarFeedKind>(input.kinds)], includeLinks: input.includeLinks ?? false };
}

export const createCalendarFeedRoutes = (feeds: CalendarFeedService) => async (context: RouteContext): Promise<Response | undefined> => {
  const { path, request, url, authMode, authenticatedSessionId } = context;
  const root = path === "/api/calendar/feeds";
  const match = path.match(/^\/api\/calendar\/feeds\/([^/]+)(\/rotate)?$/);
  if (!root && !match) return undefined;
  const owner = await feeds.ownerForSession(authMode, authenticatedSessionId);
  if (root && request.method === "GET") return json(await feeds.list(owner));
  if (root && request.method === "POST") return json(await feeds.create(owner, parseInput(await request.json().catch(() => null)), url.origin), 201);
  const id = match?.[1];
  if (!id) return undefined;
  if (!uuid.test(id)) throw new ApiError(400, "invalid_request", "Expected a UUID");
  if (!match?.[2] && request.method === "DELETE") {
    await feeds.revoke(owner, id);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (match?.[2] && request.method === "POST") return json(await feeds.rotate(owner, id, url.origin), 201);
  return undefined;
};

export async function calendarFeedResponse(feeds: CalendarFeedService, request: Request, path: string, now = new Date()): Promise<Response> {
  if (request.method !== "GET") return json({ error: { code: "method_not_allowed" } }, 405, { allow: "GET" });
  const match = path.match(/^\/calendar\/feed\/([\w-]{43})\.ics$/);
  try {
    const result = await feeds.read(match?.[1] ?? "", now);
    if ("retryAfter" in result) return json({ error: { code: "rate_limited" } }, 429, { "retry-after": String(result.retryAfter) });
    return new Response(result.ics, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("Calendar feed request failed: GET /calendar/feed/[redacted].ics");
    return json({ error: { code: "internal_error", message: "Could not generate calendar feed" } }, 500);
  }
}
