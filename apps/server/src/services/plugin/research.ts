import { ApiError } from "@outcomego/contracts";
import { isOutcomeResearchTurn } from "@outcomego/contracts/outcome-plan";
import { isReadonlyConnectorRead } from "@outcomego/contracts/plugin-namespaces";
import type { Prisma, Run } from "@outcomego/db";
import { jsonObject } from "./values";

export const researchTurnSelect = {
  id: true, threadId: true, status: true, purpose: true, planMode: true, outcomeRevision: true,
  thread: { select: { role: true, botId: true, outcomeId: true, outcome: { select: {
    revision: true, bot: { select: { id: true, status: true, subagentIdentity: { select: { id: true } } } },
  } } } },
} satisfies Prisma.OutcomeThreadTurnSelect;

export type OutcomeResearchScope = { turnId: string; outcomeId: string; planMode: ResearchTurn["planMode"]; borrowedBotId: string | null };
type ResearchTurn = Prisma.OutcomeThreadTurnGetPayload<{ select: typeof researchTurnSelect }>;

export function outcomeResearchScope(run: Pick<Run, "origin" | "status" | "botId" | "outcomeThreadId"> & {
  outcomeThreadTurn: ResearchTurn | null;
}): OutcomeResearchScope | null {
  if (run.origin !== "outcome_thread") return null;
  const turn = run.outcomeThreadTurn;
  if (run.status !== "running" || !turn || turn.status !== "running" ||
      turn.threadId !== run.outcomeThreadId || turn.thread.botId !== run.botId)
    throw new ApiError(409, "tool_context_invalid", "The persisted Outcome turn is not active");
  if (!isOutcomeResearchTurn(turn)) return null;
  if (turn.thread.role !== "planner") throw new ApiError(409, "tool_context_invalid", "A research turn requires the Outcome planner thread");
  const { bot, revision } = turn.thread.outcome;
  const currentRevision = turn.outcomeRevision == null || turn.outcomeRevision === revision;
  const borrowedBotId = currentRevision && bot?.status === "active" && !bot.subagentIdentity && bot.id !== run.botId ? bot.id : null;
  return { turnId: turn.id, outcomeId: turn.thread.outcomeId, planMode: turn.planMode, borrowedBotId };
}

export function assertReadonlyConnectorTool(connection: { connectorKey: string; installation: { pluginKey: string }; toolSnapshot: unknown }, name: string) {
  const tool = Array.isArray(connection.toolSnapshot) ? connection.toolSnapshot.map(jsonObject).find((candidate) => candidate.name === name) : null;
  const meta = jsonObject(tool?._meta);
  if (connection.installation.pluginKey === "bitwarden" || !tool ||
    meta["outcomego/hostOnly"] === true || meta["openteam/hostOnly"] === true ||
    !isReadonlyConnectorRead({ ...tool, name, source: `${connection.installation.pluginKey}/${connection.connectorKey}` }))
    throw new ApiError(403, "readonly_mcp_tool_required", "Research turns can call only read-only connector tools");
}
