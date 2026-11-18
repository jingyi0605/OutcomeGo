import { Prisma } from "@outcomego/db";
import { boundTranscriptValue, transcriptToolProjection } from "./read-transcript";

/** Persisted, redacted observable rows from one Outcome thread; never the hidden prompt or model tape. */
export async function readOutcomeTranscript(tx: Prisma.TransactionClient, workItemId: string, query: { before?: number; limit?: number } = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 40)));
  const rowsQuery = Prisma.sql`
    SELECT m.id::text, m."createdAt" AS at, m.role::text AS kind, to_jsonb(m.content) AS body, m.status::text
    FROM "outcomego_message" m JOIN "outcomego_run" r ON r.id = m."runId"
    WHERE r."outcomeWorkItemId" = ${workItemId}::uuid AND m.role::text IN ('user', 'assistant')
    UNION ALL
    SELECT i.id::text, i."createdAt" AS at, i.kind::text, i.content AS body, i.status::text
    FROM "outcomego_run_item" i JOIN "outcomego_run" r ON r.id = i."runId"
    WHERE r."outcomeWorkItemId" = ${workItemId}::uuid AND i.kind::text IN ('command', 'tool', 'file_change')
      AND (i.title IS NULL OR i.title <> 'promptFingerprint')`;
  const counts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) AS count FROM (${rowsQuery}) rows`);
  const total = Number(counts[0]?.count ?? 0);
  const end = Math.min(Math.max(0, Math.floor(query.before ?? total)), total);
  const start = Math.max(0, end - limit);
  const rows = await tx.$queryRaw<Array<{ id: string; at: Date; kind: string; body: unknown; status: string }>>(Prisma.sql`
    SELECT * FROM (${rowsQuery}) rows ORDER BY at ASC, id ASC OFFSET ${start} LIMIT ${end - start}`);
  return {
    total, next_before: start > 0 ? start : null,
    note: "Read-only observable Outcome history. Hidden instructions, reasoning and private tool payloads are excluded; text is redacted and bounded.",
    rows: rows.map((row, index) => ({ position: start + index, id: row.id, at: row.at.toISOString(), role: row.kind, status: row.status,
      content: boundTranscriptValue(["command", "tool", "file_change"].includes(row.kind) ? transcriptToolProjection(row.body) : row.body,
        Math.min(20_000, Math.floor(60_000 / Math.max(1, rows.length)))) })),
  };
}
