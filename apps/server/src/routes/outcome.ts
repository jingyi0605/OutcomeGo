import { ApiError } from "@outcomego/contracts";
import {
  CreateOutcomePlanInput, CreateOutcomeInput, CreateContractRevisionInput, ApproveContractRevisionInput,
  CancelOutcomeInput, DecideOutcomeAcceptanceInput, SubmitOutcomeReviewInput, OutcomeReworkInput, StartOutcomeRunInput, parseListOutcomesQuery,
} from "@outcomego/contracts/outcomes";
import { CreateOutcomeThreadInput, SendOutcomeThreadMessageInput } from "@outcomego/contracts/outcome-thread";
import { OutcomeAttentionInput, ReconcileOutcomeInput } from "@outcomego/contracts/outcome-runtime";
import { outcomeDispatchEnabled, type ActorRef } from "@outcomego/messaging";
import { json, parseBody } from "../http";
import { mapOutcomeError } from "../services/outcome-write";
import { run, type RouteContext } from "./context";
export function requireOutcomeDispatch(): void {
  if (!outcomeDispatchEnabled())
    throw new ApiError(503, "outcome_dispatch_disabled", "New Outcome execution is temporarily disabled", { retryable: true });
}
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
    if (path === "/api/outcomes/threads" && request.method === "POST") {
      requireOutcomeDispatch();
      return json(await app.outcomeThreads.create(await parseBody(request, CreateOutcomeThreadInput), actor), 202);
    }
    if (path === "/api/outcomes") {
      if (request.method === "GET") return json(await run(app.outcomes.list(parseListOutcomesQuery(url.searchParams))));
    }
    const match = path.match(/^\/api\/outcomes\/([\da-f-]{36})(.*)$/i);
    if (!match) return;
    const id = match[1]!, tail = match[2];
    if (!tail && request.method === "GET") return json(await run(app.outcomes.get(id)));
    if (tail === "/thread" && request.method === "GET") return json(await app.outcomeThreads.list(id), 200, { "cache-control": "no-store" });
    if (tail === "/thread/messages" && request.method === "POST") {
      requireOutcomeDispatch();
      return json(await app.outcomeThreads.send(id, await parseBody(request, SendOutcomeThreadMessageInput), actor), 202);
    }
    if (tail === "/brief" && request.method === "GET")
      return json(await app.outcomeBriefs.get(await run(app.outcomes.get(id))));
    if (tail === "/recovery" && request.method === "GET") return json(await run(app.outcomeRecovery.get(id)));
    if (tail === "/reconcile" && request.method === "POST")
      return json(await run(app.outcomeRecovery.reconcile(id, await parseBody(request, ReconcileOutcomeInput), actor)));
    if (tail === "/metrics" && request.method === "GET") return json(await run(app.outcomeRecovery.metrics(id)));
    if (tail === "/attention" && request.method === "POST")
      return json(await run(app.outcomeRecovery.recordAttention(id, await parseBody(request, OutcomeAttentionInput), actor)));
    const revisionRead = tail?.match(/^\/revisions\/([1-9]\d*)$/);
    if (revisionRead && request.method === "GET") return json(await run(app.outcomes.getRevision(id, Number(revisionRead[1]))));
    const summaryRead = tail?.match(/^\/revisions\/([1-9]\d*)\/results-summary$/);
    if (summaryRead && request.method === "GET") {
      const outcome = await run(app.outcomes.get(id));
      const number = Number(summaryRead[1]);
      const revision = outcome.currentRevisionView?.revision === number
        ? outcome.currentRevisionView
        : await run(app.outcomes.getRevision(id, number));
      return json(await app.outcomeBriefs.getResult(outcome, revision));
    }
    if (tail === "/revisions" && request.method === "POST") return json(await run(app.outcomes.createRevision(id, await parseBody(request, CreateContractRevisionInput), actor)), 201);
    const approve = tail?.match(/^\/revisions\/([1-9]\d*)\/approve$/);
    if (approve && request.method === "POST") return json(await run(app.outcomes.approve(id, Number(approve[1]), await parseBody(request, ApproveContractRevisionInput), actor)));
    if (tail === "/cancel" && request.method === "POST") return json(await run(app.outcomes.cancel(id, await parseBody(request, CancelOutcomeInput), actor)));
    if (tail === "/acceptance" && request.method === "POST")
      return json(await run(app.outcomeReviews.decide(id, await parseBody(request, DecideOutcomeAcceptanceInput), actor)));
    if (tail === "/reviews" && request.method === "POST") return json(await run(app.outcomeReviews.submit(id, await parseBody(request, SubmitOutcomeReviewInput), actor)));
    if (tail === "/rework" && request.method === "POST") return json(await run(app.outcomeReviews.rework(id, await parseBody(request, OutcomeReworkInput), actor)), 202);
    const runtime = app.outcomes;
    if (tail === "/runs" && request.method === "POST") {
      requireOutcomeDispatch();
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
