import type { ActorRef } from "@outcomego/messaging";
import { ApiError } from "@outcomego/contracts";
import { parseOutcomeInboxQuery, ResolveDecisionInput, WithdrawDecisionInput } from "@outcomego/contracts/outcome-inbox";
import { DecisionService } from "../services/decision-service";
import { OutcomeInboxService } from "../services/outcome-inbox-service";
import { json, parseBody } from "../http";
import { run, type RouteContext } from "./context";

export const createOutcomeInboxRoutes = (decisions: DecisionService, inbox: OutcomeInboxService) => async (context: RouteContext): Promise<Response | undefined> => {
  const { request, path, authMode, authenticatedSessionId, url } = context;
  const list = path === "/api/outcome-inbox";
  const scoped = path.match(/^\/api\/outcomes\/([^/]+)\/inbox$/);
  const match = path.match(/^\/api\/decisions\/([^/]+)(?:\/(resolve|withdraw))?$/);
  if (!list && !scoped && !match) return undefined;
  if (authMode === "required" && !authenticatedSessionId) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
  for (const id of [scoped?.[1], match?.[1]]) if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError(400, "invalid_request", "Expected a UUID");
  // Authentication has already established the deployment's single owner; no body actor is accepted.
  let actor: ActorRef = "owner:local";
  if (authenticatedSessionId) {
    const session = await context.app.prisma.session.findUnique({ where: { id: authenticatedSessionId }, select: { userId: true, expiresAt: true } });
    if (!session || session.expiresAt <= new Date()) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
    actor = `user:${session.userId}`;
  }
  if ((list || scoped) && request.method === "GET") {
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
