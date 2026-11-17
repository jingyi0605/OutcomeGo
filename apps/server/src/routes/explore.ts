import { ApiError } from "@outcomego/contracts";
import {
  CreateExploreIdeaInput, DiscardExploreIdeaInput, EXPLORE_STATUSES, ProposeExploreIdeaInput, type ExploreStatus,
} from "@outcomego/contracts/explore";
import { decodeOutcomeCursor } from "@outcomego/contracts/outcomes";
import { json, parseBody } from "../http";
import type { ExploreService } from "../services/explore-service";
import { run, type RouteContext } from "./context";
import { outcomeActor } from "./outcome";

/** Registered behind the existing authentication gate; assembly supplies the real planning service. */
export async function exploreRoutes(context: RouteContext, service: ExploreService): Promise<Response | undefined> {
  const { path, request, url } = context;
  if (!/^\/api\/explore(?:\/|$)/.test(path)) return;
  const actor = await outcomeActor(context);
  if (path === "/api/explore") {
    if (request.method === "POST") return json(await run(service.create(await parseBody(request, CreateExploreIdeaInput), actor)), 201);
    if (request.method === "GET") {
      const statuses = url.searchParams.getAll("status").flatMap(value => value.split(",")).filter(Boolean);
      if (statuses.some(value => !(EXPLORE_STATUSES as readonly string[]).includes(value)))
        throw new ApiError(400, "invalid_request", "Unknown Explore status");
      const limit = Number(url.searchParams.get("limit") ?? "20");
      if (!Number.isSafeInteger(limit) || limit < 1) throw new ApiError(400, "invalid_request", "limit must be a positive integer");
      let cursor = null;
      try { cursor = url.searchParams.get("cursor") ? decodeOutcomeCursor(url.searchParams.get("cursor")!) : null; }
      catch { throw new ApiError(400, "invalid_request", "Invalid Explore cursor"); }
      return json(await run(service.list({
        statuses: statuses as ExploreStatus[], limit: Math.min(limit, 100),
        cursor,
      })));
    }
  }
  const match = path.match(/^\/api\/explore\/([\da-f-]{36})(?:\/(propose|discard))?$/i);
  if (match && !match[2] && request.method === "GET") return json(await run(service.get(match[1]!)));
  if (match?.[2] && request.method === "POST") {
    if (match[2] === "propose") return json(await run(service.propose(match[1]!, await parseBody(request, ProposeExploreIdeaInput), actor)), 201);
    return json(await run(service.discard(match[1]!, await parseBody(request, DiscardExploreIdeaInput), actor)));
  }
}
