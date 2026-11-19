import {
  CREDENTIAL_ACCESS_REASON_CODE,
  type CredentialGrantItem,
  type DecisionOption,
} from "@outcomego/contracts/outcome-inbox";
import { ApiError } from "@outcomego/contracts";
import type { PrismaClient } from "@outcomego/db";
import type { DecisionService } from "./decision-service";
import type { OutcomeThreadToolHandler } from "./internal-tool-service";
import { requestDecisionFromRun } from "./outcome-decision-tool";

const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const candidatesOf = (value: unknown): CredentialGrantItem[] => {
  const list = value && typeof value === "object" ? (value as { candidates?: unknown }).candidates : undefined;
  if (!Array.isArray(list) || !list.length || list.length > 12)
    throw new ApiError(400, "bitwarden_candidates_required", "Provide one to twelve Bitwarden candidates");
  return list as CredentialGrantItem[];
};

/**
 * A grant lives on the Outcome, not on one run: the owner's answer to this step approval holds for every later
 * turn of the same Outcome. The resolved option is the record, so nothing else has to be stored or revoked.
 */
export const findOutcomeCredentialGrant = async (
  prisma: PrismaClient,
  workItemId: string,
  itemId: string,
  connectionId: string | null,
): Promise<CredentialGrantItem | null> => {
  const item = await prisma.outcomeWorkItem.findUnique({ where: { id: workItemId }, select: { outcomeId: true } });
  if (!item) return null;
  const resolved = await prisma.outcomeDecision.findMany({
    where: {
      outcomeId: item.outcomeId,
      reasonCode: CREDENTIAL_ACCESS_REASON_CODE,
      status: "resolved",
      // Only a person's choice grants access; a bot or system closure never does.
      OR: [{ resolvedBy: { startsWith: "owner:" } }, { resolvedBy: { startsWith: "user:" } }],
    },
    select: { resolvedOption: true },
  });
  for (const row of resolved) {
    const granted = (row.resolvedOption as unknown as DecisionOption | null)?.credentialGrant ?? [];
    const match = granted.find(
      (entry) => sameId(entry.itemId, itemId) && (!connectionId || sameId(entry.connectionId, connectionId)),
    );
    if (match) return match;
  }
  return null;
};

/** Whether every candidate is already covered, so the owner is not asked twice for one item. */
export const outcomeCredentialGrantsCover = async (
  prisma: PrismaClient,
  workItemId: string,
  candidates: readonly CredentialGrantItem[],
): Promise<boolean> => {
  for (const candidate of candidates)
    if (!await findOutcomeCredentialGrant(prisma, workItemId, candidate.itemId, candidate.connectionId)) return false;
  return true;
};

/**
 * Step approval for Bitwarden reads inside an Outcome. The candidates arrive already checked against the
 * connected instances; this only turns them into an owner decision that pauses the work item.
 */
export const createOutcomeCredentialApprovalTool = (
  prisma: PrismaClient,
  decisions: DecisionService,
): OutcomeThreadToolHandler =>
  async (request, context) => {
    const candidates = candidatesOf(request.arguments);
    if (await outcomeCredentialGrantsCover(prisma, context.workItemId, candidates))
      return { approved: true, already_granted: true };
    const options: DecisionOption[] = [
      {
        id: "option-1",
        label: "Allow reading for this goal",
        consequence: "The listed logins can be read whenever this goal's steps need them. Values are never shown in the conversation.",
        resolutionEffect: "plan_only",
        source: "runtime",
        recommended: true,
        reason: "The goal cannot continue without signing in.",
        credentialGrant: candidates,
      },
      {
        id: "option-2",
        label: "Do not allow",
        consequence: "The goal continues without reading these credentials and may ask you to sign in yourself.",
        resolutionEffect: "plan_only",
        source: "runtime",
      },
    ];
    return requestDecisionFromRun(
      prisma,
      decisions,
      request,
      context,
      {
        reasonCode: CREDENTIAL_ACCESS_REASON_CODE,
        completedSummary: "Execution reached a step that needs a saved sign-in.",
        problemSummary: "Reading saved logins needs your approval.",
        nextStepSummary: "Allow reading these saved logins for this goal?",
        options,
        // Comments ride along with the chosen button; a grant only ever comes from the option itself.
        customEntryAllowed: true,
      },
      { tool: "RequestBitwardenReadApproval", candidates: candidates.map((entry) => `${entry.connectionId}:${entry.itemId}`).sort() },
    );
  };
