import { ApiError } from "@outcomego/contracts";
import type {
  CreateExploreIdeaInput, DiscardExploreIdeaInput, ExploreIdeaPage, ExploreProposal, ExploreStatus, ProposeExploreIdeaInput,
} from "@outcomego/contracts/explore";
import { encodeOutcomeCursor, OUTCOME_LIMITS, type CreateOutcomePlanInput } from "@outcomego/contracts/outcomes";
import type { PrismaClient } from "@outcomego/db";
import type { ActorRef } from "@outcomego/messaging";
import { assertExploreWritable, exploreIdeaView, lockExploreIdea } from "./explore-state";
import { OutcomePlanningService } from "./outcome-planning-service";
import { outcomeWrite } from "./outcome-write";
import { hashRequest, serviceEffect, toJson } from "./service-utils";

export interface ListExploreIdeasQuery {
  statuses: ExploreStatus[];
  cursor: { updatedAt: string; id: string } | null;
  limit: number;
}

export class ExploreService {
  constructor(private readonly prisma: PrismaClient, private readonly planning: OutcomePlanningService) {}

  create = (input: CreateExploreIdeaInput, actor: ActorRef) => serviceEffect(() =>
    outcomeWrite(this.prisma, "explore-create", input.clientRequestId, { input, actor }, async tx => {
      if (!input.title.trim()) throw new ApiError(400, "invalid_request", "An Explore title is required");
      const source = input.sourceOutcomeId ? await tx.outcome.findUnique({ where: { id: input.sourceOutcomeId }, select: { botId: true } }) : null;
      if (input.sourceOutcomeId && !source) throw new ApiError(404, "outcome_not_found", "Source Outcome not found");
      const botId = input.botId ?? source?.botId ?? null;
      if (botId && !await tx.bot.findUnique({ where: { id: botId }, select: { id: true } }))
        throw new ApiError(404, "bot_not_found", "Bot not found");
      return exploreIdeaView(await tx.exploreIdea.create({ data: {
        botId, title: input.title.trim(), note: input.note?.trim() ?? "", status: input.status ?? "draft",
        sourceOutcomeId: input.sourceOutcomeId ?? null, sourceReferences: toJson(input.sourceReferences ?? []),
        ...(input.budget ? { budget: toJson(input.budget) } : {}),
      } }));
    }));

  list = (query: ListExploreIdeasQuery) => serviceEffect(async (): Promise<ExploreIdeaPage> => {
    const rows = await this.prisma.exploreIdea.findMany({
      where: {
        ...(query.statuses.length ? { status: { in: query.statuses } } : {}),
        ...(query.cursor ? { OR: [
          { updatedAt: { lt: new Date(query.cursor.updatedAt) } },
          { updatedAt: new Date(query.cursor.updatedAt), id: { lt: query.cursor.id } },
        ] } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit), last = page.at(-1);
    return {
      items: page.map(exploreIdeaView),
      nextCursor: rows.length > query.limit && last ? encodeOutcomeCursor(last.updatedAt.toISOString(), last.id) : null,
    };
  });

  get = (id: string) => serviceEffect(async () => {
    const idea = await this.prisma.exploreIdea.findUnique({ where: { id } });
    if (!idea) throw new ApiError(404, "explore_not_found", "Explore idea not found", { retryable: false });
    return exploreIdeaView(idea);
  });

  propose = (id: string, input: ProposeExploreIdeaInput, actor: ActorRef) => serviceEffect(async signal => {
    const scope = `explore-propose:${id}`, request = { input, actor };
    // This short transaction never holds a lock across model inference.
    const phase = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${input.clientRequestId}`}))`;
      const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: input.clientRequestId } } });
      if (previous) {
        if (previous.requestHash !== hashRequest(request))
          throw new ApiError(409, "idempotency_conflict", "This request ID was already used for a different request");
        return { kind: "replay", proposal: previous.response as unknown as ExploreProposal } as const;
      }
      const idea = await lockExploreIdea(tx, id);
      assertExploreWritable(idea);
      const botId = input.botId ?? idea.botId;
      if (!botId) throw new ApiError(422, "explore_bot_required", "Choose a Bot before generating delivery planning", { retryable: false });
      if (idea.status === "proposed_for_delivery" && input.botId && input.botId !== idea.botId)
        throw new ApiError(409, "explore_read_only", "The proposed planning draft belongs to another Bot", { currentStatus: idea.status });
      const existing = idea.planningDraftId ? await tx.outcomePlanningDraft.findUnique({ where: { id: idea.planningDraftId } }) : null;
      const planInput: CreateOutcomePlanInput = {
        sourceText: JSON.stringify({ title: idea.title, note: idea.note, sourceReferences: idea.sourceReferences, budget: idea.budget }).slice(0, OUTCOME_LIMITS.sourceTextChars),
        context: { botId }, clientRequestId: input.clientRequestId,
      };
      if (existing?.status === "ready" && existing.expiresAt > new Date())
        return { kind: "plan", planInput, reuse: true } as const;
      await tx.exploreIdea.update({ where: { id }, data: { status: "exploring", botId } });
      return { kind: "plan", planInput, reuse: false } as const;
    });
    const check = (proposal: ExploreProposal) => {
      if (proposal.plan.status === "failed")
        throw new ApiError(502, "planning_generation_failed", "Planning could not be generated; retry with a new request ID", {
          retryable: true, planId: proposal.plan.planId, exploreId: id,
        });
      return proposal;
    };
    if (phase.kind === "replay") return check(phase.proposal);
    const prepared = phase.reuse ? null : await this.planning.prepare(phase.planInput, signal);
    const proposal = await outcomeWrite(this.prisma, scope, input.clientRequestId, request, async tx => {
      const idea = await lockExploreIdea(tx, id);
      assertExploreWritable(idea);
      const existing = idea.planningDraftId ? await tx.outcomePlanningDraft.findUnique({ where: { id: idea.planningDraftId } }) : null;
      // A concurrent proposal may already have won; do not leave a second draft behind.
      if (existing?.status === "ready" && existing.expiresAt > new Date()) {
        if (existing.botId !== phase.planInput.context.botId)
          throw new ApiError(409, "explore_read_only", "Another proposal selected a different Bot; reload the Explore idea", { currentStatus: idea.status });
        return { idea: exploreIdeaView(idea), plan: this.planning.view(existing) };
      }
      if (!prepared) throw new ApiError(409, "planning_draft_expired", "Generate a new delivery plan", { retryable: true });
      const plan = await this.planning.persistInTransaction(tx, phase.planInput, prepared);
      const updated = await tx.exploreIdea.update({ where: { id }, data: {
        botId: phase.planInput.context.botId, planningDraftId: plan.planId,
        status: plan.status === "ready" ? "proposed_for_delivery" : "exploring",
      } });
      return { idea: exploreIdeaView(updated), plan };
    });
    return check(proposal);
  });

  discard = (id: string, input: DiscardExploreIdeaInput, actor: ActorRef) => serviceEffect(() =>
    outcomeWrite(this.prisma, `explore-discard:${id}`, input.clientRequestId, { input, actor }, async tx => {
      const idea = await lockExploreIdea(tx, id);
      if (idea.status === "discarded") return exploreIdeaView(idea);
      assertExploreWritable(idea);
      return exploreIdeaView(await tx.exploreIdea.update({ where: { id }, data: { status: "discarded", discardedAt: new Date() } }));
    }));
}
