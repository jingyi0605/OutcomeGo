import { ApiError } from "@outcomego/contracts";
import type { ExploreIdeaView } from "@outcomego/contracts/explore";
import type { ExploreIdea, Prisma } from "@outcomego/db";

export async function lockExploreIdea(tx: Prisma.TransactionClient, id: string): Promise<ExploreIdea> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`explore:${id}`}))`;
  const idea = await tx.exploreIdea.findUnique({ where: { id } });
  if (!idea) throw new ApiError(404, "explore_not_found", "Explore idea not found", { retryable: false });
  return idea;
}

export function assertExploreWritable(idea: ExploreIdea): void {
  if (idea.status === "converted" || idea.status === "discarded")
    throw new ApiError(409, "explore_read_only", "This Explore idea is read-only", { currentStatus: idea.status, retryable: false });
}

export function exploreIdeaView(idea: ExploreIdea): ExploreIdeaView {
  return {
    id: idea.id, botId: idea.botId, title: idea.title, note: idea.note, status: idea.status,
    sourceOutcomeId: idea.sourceOutcomeId,
    sourceReferences: idea.sourceReferences as unknown as ExploreIdeaView["sourceReferences"],
    budget: idea.budget as unknown as ExploreIdeaView["budget"],
    planningDraftId: idea.planningDraftId, proposedOutcomeId: idea.proposedOutcomeId,
    createdAt: idea.createdAt.toISOString(), updatedAt: idea.updatedAt.toISOString(),
    discardedAt: idea.discardedAt?.toISOString() ?? null,
  };
}
