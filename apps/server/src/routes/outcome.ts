import { ApiError } from "@outcomego/contracts";
import {
  AdoptPrereviewInput, CreateContractRevisionInput, ApproveContractRevisionInput,
  CancelOutcomeInput, DecideOutcomeAcceptanceInput, SubmitOutcomeReviewInput, OutcomeReworkInput, StartOutcomeRunInput, decodeOutcomeCursor, parseListOutcomesQuery,
  SetOutcomeDueInput, SetWorkItemScheduleInput,
  ActOnOutcomeInput, ConvertOutcomeInput, CreateOutcomeAutoAcceptRuleInput, CreateOutcomeInput,
  OutcomeIntakeInput, UpdateOutcomeAutoAcceptRuleInput, UpdateOutcomeInput,
} from "@outcomego/contracts/outcomes";
import { RequestOutcomePlanInput, SendOutcomeThreadMessageInput } from "@outcomego/contracts/outcome-thread";
import { OutcomeAttentionInput, ReconcileOutcomeInput } from "@outcomego/contracts/outcome-runtime";
import { outcomeDispatchEnabled } from "@outcomego/messaging";
import { json, parseBody } from "../http";
import { mapOutcomeError } from "../services/outcome-write";
import { run, type RouteContext } from "./context";
import { outcomeOwner, requireOutcomeOwner } from "./outcome-owner";
export function requireOutcomeDispatch(): void {
  if (!outcomeDispatchEnabled())
    throw new ApiError(503, "outcome_dispatch_disabled", "New Outcome execution is temporarily disabled", { retryable: true });
}
export async function outcomeRoutes(context: RouteContext): Promise<Response | undefined> {
  const { path, request, app, url } = context;
  if (!/^\/api\/outcomes(?:\/|$)/.test(path)) return;
  try {
    const { ownerId, actor } = await outcomeOwner(context);
    const workThreads = path.match(/^\/api\/outcomes\/work-threads\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i);
    if (workThreads && request.method === "GET") {
      return json(await run(app.outcomes.listWorkThreads(
        workThreads[1]!, url.searchParams.get("archived") === "true",
        decodeOutcomeCursor(url.searchParams.get("cursor")), undefined, ownerId,
      )), 200, { "cache-control": "no-store" });
    }
    if (path === "/api/outcomes") {
      if (request.method === "GET") return json(await run(app.outcomes.list(parseListOutcomesQuery(url.searchParams), actor)), 200, { "cache-control": "no-store" });
      if (request.method === "POST") {
        const input = await parseBody(request, CreateOutcomeInput);
        if (input.kind === "standard" && input.autoPlan !== false) requireOutcomeDispatch();
        const result = await run(app.outcomes.create(input, actor));
        return json(result, result.turn ? 202 : 201);
      }
    }
    if (path === "/api/outcomes/intake" && request.method === "POST")
      return json(await run(app.outcomes.createIntake(await parseBody(request, OutcomeIntakeInput), actor)), 202);
    const rule = path.match(/^\/api\/outcomes\/auto-accept-rules(?:\/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}))?$/i);
    if (rule) {
      const ruleId = rule[1];
      if (!ruleId && request.method === "GET") return json(await app.outcomes.listAutoAcceptRules(ownerId), 200, { "cache-control": "no-store" });
      if (!ruleId && request.method === "POST") return json(await app.outcomes.createAutoAcceptRule(ownerId, await parseBody(request, CreateOutcomeAutoAcceptRuleInput)), 201);
      if (ruleId && request.method === "PATCH") return json(await app.outcomes.updateAutoAcceptRule(ownerId, ruleId, await parseBody(request, UpdateOutcomeAutoAcceptRuleInput)));
      if (ruleId && request.method === "DELETE") {
        await app.outcomes.deleteAutoAcceptRule(ownerId, ruleId);
        return new Response(null, { status: 204 });
      }
      return undefined;
    }
    const match = path.match(/^\/api\/outcomes\/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})(\/.*)?$/i);
    if (!match) return;
    const id = match[1]!, tail = match[2];
    if (!tail && request.method === "GET") return json(await run(app.outcomes.get(id, actor)), 200, { "cache-control": "no-store" });
    if (tail === "/attachments" && request.method === "GET") {
      const { attachments } = await run(app.outcomes.get(id, actor));
      return json({ attachments }, 200, { "cache-control": "no-store" });
    }
    if (!tail && request.method === "PATCH") return json(await run(app.outcomes.update(id, await parseBody(request, UpdateOutcomeInput), actor)));
    if (tail === "/convert" && request.method === "POST") {
      const input = await parseBody(request, ConvertOutcomeInput);
      await requireOutcomeOwner(context, id, ownerId);
      if (input.targetKind === "standard" && input.autoPlan !== false) requireOutcomeDispatch();
      const result = await run(app.outcomes.convert(id, input, actor));
      return json(result, result.turn ? 202 : 200);
    }
    if (tail === "/actions" && request.method === "POST")
      return json(await run(app.outcomes.act(id, await parseBody(request, ActOnOutcomeInput), actor)));
    if (tail === "/plan" && request.method === "POST") {
      await requireOutcomeOwner(context, id, ownerId);
      requireOutcomeDispatch();
      return json(await app.outcomeThreads.plan(id, await parseBody(request, RequestOutcomePlanInput), actor), 202);
    }
    if (tail === "/inbox" || tail === "/work-items" || tail?.startsWith("/knowledge/")) return undefined;
    await requireOutcomeOwner(context, id, ownerId);
    if (tail === "/thread" && request.method === "GET") {
      await requireOutcomeOwner(context, id, ownerId);
      return json(await app.outcomeThreads.list(id), 200, { "cache-control": "no-store" });
    }
    if (tail === "/thread/messages" && request.method === "POST") {
      await requireOutcomeOwner(context, id, ownerId);
      requireOutcomeDispatch();
      return json(await app.outcomeThreads.send(id, await parseBody(request, SendOutcomeThreadMessageInput), actor), 202);
    }
    if (tail === "/brief" && request.method === "GET")
      return json(await app.outcomeBriefs.get(await run(app.outcomes.get(id, actor))));
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
      const outcome = await run(app.outcomes.get(id, actor));
      const number = Number(summaryRead[1]);
      const revision = outcome.currentRevisionView?.revision === number
        ? outcome.currentRevisionView
        : await run(app.outcomes.getRevision(id, number));
      return json(await app.outcomeBriefs.getResult(outcome, revision), 200, { "cache-control": "no-store" });
    }
    if (tail === "/revisions" && request.method === "POST") return json(await run(app.outcomes.createRevision(id, await parseBody(request, CreateContractRevisionInput), actor)), 201);
    const approve = tail?.match(/^\/revisions\/([1-9]\d*)\/approve$/);
    if (approve && request.method === "POST") return json(await run(app.outcomes.approve(id, Number(approve[1]), await parseBody(request, ApproveContractRevisionInput), actor)));
    if (tail === "/cancel" && request.method === "POST") return json(await run(app.outcomes.cancel(id, await parseBody(request, CancelOutcomeInput), actor)));
    if (tail === "/acceptance" && request.method === "POST")
      return json(await run(app.outcomeReviews.decide(id, await parseBody(request, DecideOutcomeAcceptanceInput), actor)));
    if (tail === "/reviews/adopt-prereview" && request.method === "POST")
      return json(await run(app.outcomeReviews.adoptPrereview(id, await parseBody(request, AdoptPrereviewInput), actor)));
    if (tail === "/reviews" && request.method === "POST") return json(await run(app.outcomeReviews.submit(id, await parseBody(request, SubmitOutcomeReviewInput), actor)));
    if (tail === "/rework" && request.method === "POST") return json(await run(app.outcomeReviews.rework(id, await parseBody(request, OutcomeReworkInput), actor)), 202);
    const runtime = app.outcomes;
    if (tail === "/runs" && request.method === "POST") {
      requireOutcomeDispatch();
      if (!runtime.startRun) throw new ApiError(503, "outcome_runtime_unavailable", "Outcome execution is not available yet", { retryable: true });
      return json(await run(runtime.startRun(id, await parseBody(request, StartOutcomeRunInput), actor)), 202);
    }
    // The owner's dates (specs/004.10): a task's schedule, and the goal's deadline. Neither touches the contract.
    const schedule = tail?.match(/^\/work-items\/([\da-f-]{36})\/schedule$/i);
    if (schedule && request.method === "PUT")
      return json(await app.outcomeSchedule.setWorkItemSchedule(id, schedule[1]!, await parseBody(request, SetWorkItemScheduleInput), actor));
    if (tail === "/due" && request.method === "PUT")
      return json(await app.outcomeSchedule.setOutcomeDue(id, await parseBody(request, SetOutcomeDueInput), actor));
    const stopWorkThread = tail?.match(/^\/work-items\/([\da-f-]{36})\/stop$/i);
    if (stopWorkThread && request.method === "POST")
      return json(await run(runtime.stopWorkThread(id, stopWorkThread[1]!)));
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
