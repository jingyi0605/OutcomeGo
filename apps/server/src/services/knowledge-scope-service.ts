import { KnowledgeError, type KnowledgeScope } from "@outcomego/contracts/knowledge";
import type { PrismaClient } from "@outcomego/db";

export interface KnowledgeScopeResolver {
  resolve(scope: KnowledgeScope, allowFixture?: boolean): Promise<{ botId: string | null }>;
}

/** Resolve the declared scope against persisted Outcome facts on every operation. */
export class KnowledgeScopeService implements KnowledgeScopeResolver {
  constructor(private readonly prisma: PrismaClient, private readonly allowHistoricalRevision = false) {}

  async resolve(scope: KnowledgeScope, allowFixture = false) {
    if (!scope.projectScope || !scope.outcomeId || !Number.isInteger(scope.contractRevision) || scope.contractRevision < 1)
      throw new KnowledgeError("knowledge_scope_required", "An Outcome, revision and explicit project scope are required");
    if (allowFixture && /^fixture:[A-Za-z0-9_-]+$/.test(scope.projectScope)) return { botId: null };
    if (!/^bot:[0-9a-f-]{36}$/i.test(scope.projectScope) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.outcomeId))
      throw new KnowledgeError("knowledge_scope_required", "A valid Outcome and Bot scope are required");
    const outcome = await this.prisma.outcome.findUnique({
      where: { id: scope.outcomeId },
      include: { currentRevision: true, bot: { select: { status: true } } },
    });
    if (!outcome?.bot || outcome.bot.status === "archived" || scope.projectScope !== `bot:${outcome.botId}`)
      throw new KnowledgeError("knowledge_source_forbidden", "The source does not belong to this Outcome's Bot");
    if (outcome.currentRevision?.revision !== scope.contractRevision) {
      const historical = this.allowHistoricalRevision && await this.prisma.outcomeContractRevision.findFirst({
        where: { outcomeId: outcome.id, revision: scope.contractRevision, approvedAt: { not: null } },
        select: { id: true },
      });
      if (!historical) throw new KnowledgeError("knowledge_source_stale", "The Outcome revision has changed");
    }
    return { botId: outcome.botId };
  }
}
