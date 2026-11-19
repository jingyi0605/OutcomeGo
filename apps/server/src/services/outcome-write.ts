import { OutcomeError } from "@outcomego/contracts/outcomes";
import type { Prisma, PrismaClient } from "@outcomego/db";
import { outcomeApiError } from "./outcome-service";
import { hashRequest, toJson } from "./service-utils";

export const mapOutcomeError = (error: unknown) => error instanceof OutcomeError
  ? outcomeApiError(error.code, error.message, error.details) : error;

export async function lockOutcome(tx: Prisma.TransactionClient, outcomeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
  const outcome = await tx.outcome.findUnique({ where: { id: outcomeId } });
  if (!outcome) throw outcomeApiError("outcome_not_found", "Outcome not found");
  return outcome;
}

/** Serializes retries before business validation so a committed request always replays, including terminal states. */
export async function outcomeWrite<T>(prisma: PrismaClient, scope: string, key: string, input: unknown,
  write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${key}`}))`;
      const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
      const requestHash = hashRequest(input);
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw outcomeApiError("idempotency_conflict", "This request ID was already used for a different request");
        return previous.response as T;
      }
      const response = await write(tx);
      await tx.idempotencyRecord.create({ data: {
        scope, key, requestHash, response: toJson(response), status: "completed",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      } });
      return response;
    }, { timeout: 15_000 });
  } catch (error) { throw mapOutcomeError(error); }
}
