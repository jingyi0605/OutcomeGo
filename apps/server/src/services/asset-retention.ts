import { Prisma } from "@outcomego/db";

const ASSET_REFERENCE = /^(?:asset:|file:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:[0-9]+:asset:)([a-f0-9]{64})$/;

export const assetIdFromReference = (reference: string): string | null => ASSET_REFERENCE.exec(reference)?.[1] ?? null;

/** Publication and deletion use the existing receipt asset lock in stable order. */
export async function lockAssetReferences(tx: Prisma.TransactionClient, references: readonly string[]): Promise<string[]> {
  const ids = [...new Set(references.flatMap(reference => {
    const id = assetIdFromReference(reference);
    return id ? [id] : [];
  }))].sort();
  for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`human-receipt-asset:asset:${id}`}))`;
  return ids;
}

/** The same authoritative query serves the initial scan and each locked unlink recheck. */
export const referencedAssetIdsSql = Prisma.sql`
  WITH durable_references AS (
    SELECT candidate #>> '{}' AS reference
    FROM "outcomego_outcome_human_receipt" AS receipt
    CROSS JOIN LATERAL jsonb_path_query(receipt."assetRefs", '$[*]'::jsonpath) AS candidate
    WHERE jsonb_typeof(candidate) = 'string'
    UNION ALL
    SELECT evidence."sourceRef" AS reference
    FROM "outcomego_outcome_evidence" AS evidence
    WHERE evidence."sourceType" IN ('asset', 'knowledge', 'file')
    UNION ALL
    SELECT candidate #>> '{}' AS reference
    FROM "outcomego_outcome_human_action_card" AS card
    CROSS JOIN LATERAL jsonb_path_query(card."references", '$[*].sourceRef'::jsonpath) AS candidate
    WHERE jsonb_typeof(candidate) = 'string'
    UNION ALL
    SELECT candidate #>> '{}' AS reference
    FROM "outcomego_outcome_human_receipt" AS receipt
    CROSS JOIN LATERAL jsonb_path_query(receipt."payload", '$.references[*].sourceRef'::jsonpath) AS candidate
    WHERE jsonb_typeof(candidate) = 'string'
  )
  SELECT DISTINCT "assetId" FROM (
    SELECT candidate #>> '{}' AS "assetId"
    FROM "outcomego_channel_message" AS message
    CROSS JOIN LATERAL jsonb_path_query(
      coalesce(message."metadata", '{}'::jsonb),
      '$.**.assetId'::jsonpath
    ) AS candidate
    WHERE jsonb_typeof(candidate) = 'string'
    UNION ALL
    SELECT right(reference, 64) AS "assetId"
    FROM durable_references
    WHERE reference ~ '^(asset:|file:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:[0-9]+:asset:)[a-f0-9]{64}$'
  ) AS candidates
`;
