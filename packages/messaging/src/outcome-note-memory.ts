import { createHash } from "node:crypto";
import type { Outcome, Prisma } from "@outcomego/db";
import { invalidateSharedMemory, memoryImportance, memoryLogicalId, normalizeMemoryContent, OUTCOME_NOTE_MEMORY_NAMESPACE } from "./memory-facts";

type NoteMemorySource = Pick<Outcome, "id" | "kind" | "status" | "botId" | "title" | "description" | "tags" | "kindMeta">;

function noteMemoryContent(outcome: NoteMemorySource): string | null {
  if (outcome.kind !== "note" || outcome.status !== "active") return null;
  const meta = outcome.kindMeta && typeof outcome.kindMeta === "object" && !Array.isArray(outcome.kindMeta) ? outcome.kindMeta : {};
  if (meta.syncToMemory === false) return null;
  const summary = (typeof meta.memorySummary === "string" && meta.memorySummary.trim()) || outcome.description.trim();
  const text = [outcome.title.trim(), summary].filter(Boolean).join(": ");
  const tags = outcome.tags.length ? ` (Tags: ${outcome.tags.join(", ")})` : "";
  return normalizeMemoryContent(`[note] ${text}${tags}`);
}

export async function syncOutcomeNoteMemory(tx: Prisma.TransactionClient, outcome: NoteMemorySource): Promise<void> {
  const content = noteMemoryContent(outcome);
  const where = { sourceOutcomeId: outcome.id };
  if (content) {
    const [existing, duplicate] = await tx.memoryFact.findMany({
      where, take: 2,
      select: { namespace: true, fact: true, writtenByBotId: true, supersededAt: true },
    });
    if (existing && !duplicate && existing.namespace === OUTCOME_NOTE_MEMORY_NAMESPACE &&
        existing.fact === content && existing.writtenByBotId === outcome.botId && !existing.supersededAt) return;
  }
  const { count } = await tx.memoryFact.deleteMany({ where });
  if (content) {
    await tx.memoryFact.create({ data: {
      namespace: OUTCOME_NOTE_MEMORY_NAMESPACE,
      scope: "user",
      tier: "note",
      origin: "note",
      fact: content,
      factHash: createHash("sha256").update(content).digest("hex"),
      logicalId: memoryLogicalId(content),
      importance: memoryImportance(content),
      sourceOutcomeId: outcome.id,
      writtenByBotId: outcome.botId,
    } });
  }
  if (content || count > 0) await invalidateSharedMemory(tx);
}
