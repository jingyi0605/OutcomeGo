import { ApiError } from "@outcomego/contracts";
import { TASK_POLICY_FIELDS } from "@outcomego/contracts/task-policy";
import { json } from "../http";
import type { ActivityQuery, ActivityService } from "../services/activity-service";
import type { OutcomeService } from "../services/outcome-service";
import { run, type RouteContext } from "./context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The window a caller may ask for is the one the owner's own setting accepts: one definition, in the policy metadata.
const WINDOW = TASK_POLICY_FIELDS.find((field) => field.key === "activity.recentCompletedHours")!;

const badRequest = (message: string) => new ApiError(400, "invalid_request", message);

function parseActivityQuery(params: URLSearchParams): ActivityQuery {
  const query: ActivityQuery = {};
  const botId = params.get("botId");
  if (botId !== null) {
    if (!UUID.test(botId)) throw badRequest("botId must be a UUID");
    query.botId = botId;
  }
  const includeAll = params.get("includeAll");
  if (includeAll !== null) {
    if (includeAll !== "true" && includeAll !== "false") throw badRequest("includeAll must be true or false");
    if (includeAll === "true") query.includeAll = true;
  }
  const recentHours = params.get("recentHours");
  if (recentHours !== null) {
    const hours = Number(recentHours);
    if (!/^\d+$/.test(recentHours) || hours < WINDOW.min! || hours > WINDOW.max!)
      throw badRequest(`recentHours must be a whole number from ${WINDOW.min} to ${WINDOW.max}`);
    query.recentHours = hours;
  }
  return query;
}

/**
 * The owner's view of what every bot is doing (specs/004.10 design §3.8). Read-only. Authentication has already
 * established the deployment's single owner; no body and no bot credential is accepted here, and nothing in this file is
 * reachable from a bot tool.
 */
export const createActivityRoutes = (activity: ActivityService, todos?: Pick<OutcomeService, "ownerForSession" | "attention" | "digest">) => async (context: RouteContext): Promise<Response | undefined> => {
  const { request, path, authMode, authenticatedSessionId, url } = context;
  const list = path === "/api/activity";
  const detail = path.match(/^\/api\/activity\/requests\/([^/]+)$/);
  const stop = path.match(/^\/api\/activity\/requests\/([^/]+)\/stop$/);
  const needsMe = path === "/api/needs-me";
  if (stop && request.method === "POST") {
    if (authMode === "required" && !authenticatedSessionId) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
    const requestRunId = stop[1]!;
    if (!UUID.test(requestRunId)) throw badRequest("Expected a UUID");
    return json(await activity.stopRequest(requestRunId), 200, { "cache-control": "no-store" });
  }
  if ((!list && !detail && !needsMe) || request.method !== "GET") return undefined;
  if (authMode === "required" && !authenticatedSessionId) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
  const ownerId = await todos?.ownerForSession(authMode, authenticatedSessionId);
  if (needsMe) {
    const response = await activity.needsMe(undefined, ownerId ?? undefined);
    if (ownerId && todos) {
      const [attention, digest] = await Promise.allSettled([todos.attention(ownerId), todos.digest(ownerId)]);
      if (attention.status === "fulfilled") response.todos = attention.value;
      else console.error("todo-attention", attention.reason);
      if (digest.status === "fulfilled") response.todoDigest = digest.value;
      else console.error("todo-digest", digest.reason);
    }
    return json(response, 200, { "cache-control": "no-store" });
  }
  if (list) return json(await activity.list({ ...parseActivityQuery(url.searchParams), ...(ownerId ? { ownerId } : {}) }), 200, { "cache-control": "no-store" });
  const requestRunId = detail![1]!;
  if (!UUID.test(requestRunId)) throw badRequest("Expected a UUID");
  const view = await activity.requestDetail(requestRunId, undefined, ownerId ?? undefined);
  if (!view) throw new ApiError(404, "request_not_found", "No tracked request has this ID");
  return json(view, 200, { "cache-control": "no-store" });
};
