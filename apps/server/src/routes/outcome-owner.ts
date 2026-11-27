import { ApiError } from "@outcomego/contracts";
import type { ActorRef } from "@outcomego/messaging";
import type { RouteContext } from "./context";

export async function outcomeOwner(context: RouteContext): Promise<{ ownerId: string; actor: ActorRef }> {
  if (context.authMode === "disabled") return { ownerId: "local", actor: "owner:local" };
  const session = context.authenticatedSessionId ? await context.app.prisma.session.findUnique({
    where: { id: context.authenticatedSessionId }, select: { userId: true, expiresAt: true },
  }) : null;
  if (!session || session.expiresAt <= new Date()) throw new ApiError(401, "unauthorized", "Sign in to OutcomeGo to continue");
  return { ownerId: session.userId, actor: `user:${session.userId}` };
}

export async function requireOutcomeOwner(context: RouteContext, id: string, ownerId: string): Promise<void> {
  const outcome = await context.app.prisma.outcome.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!outcome) throw new ApiError(404, "outcome_not_found", "Outcome not found", { retryable: false });
}
