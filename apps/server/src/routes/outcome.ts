import { ApiError } from "@outcomego/contracts";
import {
  CreateOutcomePlanInput, CreateOutcomeInput, CreateContractRevisionInput, ApproveContractRevisionInput,
  CancelOutcomeInput, SubmitOutcomeReviewInput, OutcomeReworkInput, StartOutcomeRunInput, parseListOutcomesQuery,
} from "@outcomego/contracts/outcomes";
import type { ActorRef } from "@outcomego/messaging";
import { json, parseBody } from "../http";
import { mapOutcomeError } from "../services/outcome-write";
import { run, type RouteContext } from "./context";
export async function outcomeActor(context: RouteContext): Promise<ActorRef> {
  // The shared main request gate has already authenticated the request.
  if (!context.authenticatedSessionId) return "owner:local";
  const session = await context.app.prisma.session.findUnique({ where: { id: context.authenticatedSessionId }, select: { userId: true, expiresAt: true } });
  if (!session || session.expiresAt <= new Date()) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
  return `user:${session.userId}`;
}
export async function outcomeRoutes(context: RouteContext): Promise<Response | undefined> {
  const { path, request, app, url } = context;
  if (!/^\/api\/outcomes(?:\/|$)/.test(path)) return;
  try {
    const actor = await outcomeActor(context);
    if (path === "/api/outcomes/plans" && request.method === "POST") return json(await run(app.outcomePlanning.create(await parseBody(request, CreateOutcomePlanInput))), 201);
    const plan = path.match(/^\/api\/outcomes\/plans\/([\da-f-]{36})$/i);
    if (plan && request.method === "GET") return json(await run(app.outcomePlanning.get(plan[1]!)));
    if (path === "/api/outcomes") {
      if (request.method === "POST") return json(await run(app.outcomes.createFromDraft(await parseBody(request, CreateOutcomeInput), actor)), 201);
      if (request.method === "GET") return json(await run(app.outcomes.list(parseListOutcomesQuery(url.searchParams))));
    }
    const match = path.match(/^\/api\/outcomes\/([\da-f-]{36})(.*)$/i);
    if (!match) return;
    const id = match[1]!, tail = match[2];
    if (!tail && request.method === "GET") return json(await run(app.outcomes.get(id)));
    if (tail === "/revisions" && request.method === "POST") return json(await run(app.outcomes.createRevision(id, await parseBody(request, CreateContractRevisionInput), actor)), 201);
    const approve = tail?.match(/^\/revisions\/([1-9]\d*)\/approve$/);
    if (approve && request.method === "POST") return json(await run(app.outcomes.approve(id, Number(approve[1]), await parseBody(request, ApproveContractRevisionInput), actor)));
    if (tail === "/cancel" && request.method === "POST") return json(await run(app.outcomes.cancel(id, await parseBody(request, CancelOutcomeInput), actor)));
    if (tail === "/reviews" && request.method === "POST") return json(await run(app.outcomeReviews.submit(id, await parseBody(request, SubmitOutcomeReviewInput), actor)));
    if (tail === "/rework" && request.method === "POST") return json(await run(app.outcomeReviews.rework(id, await parseBody(request, OutcomeReworkInput), actor)), 202);
    const runtime = app.outcomes;
    if (tail === "/runs" && request.method === "POST") {
      if (!runtime.startRun) throw new ApiError(503, "outcome_runtime_unavailable", "Outcome execution is not available yet", { retryable: true });
      return json(await run(runtime.startRun(id, await parseBody(request, StartOutcomeRunInput), actor)), 202);
    }
    const transcript = tail?.match(/^\/work-items\/([\da-f-]{36})\/transcript$/i);
    if (transcript && request.method === "GET") {
      if (!runtime.transcript) throw new ApiError(503, "outcome_runtime_unavailable", "Outcome transcript is not available yet", { retryable: true });
      const query: { before?: number; limit?: number } = {};
      for (const field of ["before", "limit"] as const) if (url.searchParams.has(field)) {
        const value = Number(url.searchParams.get(field));
        if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, "invalid_request", `${field} must be a positive integer`);
        query[field] = value;
      }
      return json(await run(runtime.transcript(id, transcript[1]!, query)));
    }
  } catch (error) { throw mapOutcomeError(error); }
}
