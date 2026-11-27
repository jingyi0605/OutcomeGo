import { ApiError } from "@outcomego/contracts";
import { parseOutcomeInboxQuery, ResolveDecisionInput, WithdrawDecisionInput } from "@outcomego/contracts/outcome-inbox";
import { DecisionService } from "../services/decision-service";
import { OutcomeInboxService } from "../services/outcome-inbox-service";
import { json, parseBody } from "../http";
import { run, type RouteContext } from "./context";
import { outcomeOwner, requireOutcomeOwner } from "./outcome-owner";

export const createOutcomeInboxRoutes = (decisions: DecisionService, inbox: OutcomeInboxService) => async (context: RouteContext): Promise<Response | undefined> => {
  const { request, path, url } = context;
  const list = path === "/api/outcome-inbox";
  const scoped = path.match(/^\/api\/outcomes\/([^/]+)\/inbox$/);
  const match = path.match(/^\/api\/decisions\/([^/]+)(?:\/(resolve|withdraw))?$/);
  if (!list && !scoped && !match) return undefined;
  const { ownerId, actor } = await outcomeOwner(context);
  for (const id of [scoped?.[1], match?.[1]]) if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError(400, "invalid_request", "Expected a UUID");
  if ((list || scoped) && request.method === "GET") {
    if (scoped?.[1]) await requireOutcomeOwner(context, scoped[1], ownerId);
    let query;
    try { query = parseOutcomeInboxQuery(url.searchParams); } catch { throw new ApiError(400, "invalid_outcome_inbox_query", "The inbox query or cursor is invalid"); }
    return json(await run(inbox.list(query, scoped?.[1])));
  }
  if (match?.[1]) {
    const id = match[1];
    if ((request.method === "GET" || request.method === "POST") && !match[2]) return json(await run(decisions.present(id, actor)));
    if (request.method === "POST" && match[2] === "resolve") return json(await run(decisions.resolve(id, await parseBody(request, ResolveDecisionInput), actor)));
    if (request.method === "POST" && match[2] === "withdraw") {
      await parseBody(request, WithdrawDecisionInput);
      return json(await run(decisions.withdraw(id, actor)));
    }
  }
  throw new ApiError(405, "method_not_allowed", "Method not allowed");
};

/** Construct lazily after authentication; the production enqueue port is never replaced by a fake. */
export async function outcomeInboxRoutes(context: RouteContext): Promise<Response | undefined> {
  if (!/^\/api\/(outcome-inbox(?:$|\/)|decisions\/|outcomes\/[^/]+\/inbox$)/.test(context.path)) return undefined;
  const { app } = context;
  return createOutcomeInboxRoutes(app.outcomeDecisions, new OutcomeInboxService(app.prisma))(context);
}
