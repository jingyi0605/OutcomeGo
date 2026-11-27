import { ApiError } from "@outcomego/contracts";
import { TIME_ITEM_KINDS, type ScheduleQuery, type TimeItemKind } from "@outcomego/contracts/task-overview";
import { json } from "../http";
import type { OutcomeService } from "../services/outcome-service";
import type { ScheduleService } from "../services/schedule-service";
import type { RouteContext } from "./context";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

function parseQuery(params: URLSearchParams): ScheduleQuery {
  const kinds = params.getAll("kinds").flatMap((value) => value.split(",")) as TimeItemKind[];
  const botId = params.get("botId");
  const outcomeId = params.get("outcomeId");
  const mine = params.get("mine");
  if (kinds.some((kind) => !TIME_ITEM_KINDS.includes(kind)) ||
      [botId, outcomeId].some((id) => id !== null && !uuid.test(id)) ||
      (mine !== null && mine !== "true" && mine !== "false")) {
    throw new ApiError(400, "invalid_request", "Invalid schedule filter");
  }
  return {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    ...(kinds.length ? { kinds } : {}),
    ...(botId ? { botId } : {}),
    ...(outcomeId ? { outcomeId } : {}),
    ...(mine === "true" ? { mine: true } : {}),
  };
}

export const createScheduleRoutes = (schedule: ScheduleService, owners: Pick<OutcomeService, "ownerForSession">) =>
  async (context: RouteContext): Promise<Response | undefined> => {
    if (context.path !== "/api/schedule" || context.request.method !== "GET") return undefined;
    const ownerId = await owners.ownerForSession(context.authMode, context.authenticatedSessionId);
    return json(await schedule.list(ownerId, parseQuery(context.url.searchParams)), 200, { "cache-control": "no-store" });
  };
