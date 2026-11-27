import type { ActiveTurn } from "./types";

export const strictNativeTools = new Set(["Read", "Shell", "RecallMemory", "GetDynamicTools", "CallDynamicTool", "ListSections"]);
export const researchNativeTools = new Set([...strictNativeTools, "AwaitShell"]);
const strictDynamicTools = new Set(["AwaitShell", "WebSearch", "WebFetch", "SearchPlugins", "GetPlugin", "GetMcpServerStatus"]);
const researchDynamicTools = new Set([...strictDynamicTools, "ListMachines", "ReadTranscript", "ReadAgentActivity"]);

export function allowsCursorTool(turn: Pick<ActiveTurn, "accessMode" | "goalThread">, name: string): boolean {
  if (turn.accessMode === "readonly_strict") return strictDynamicTools.has(name);
  if (turn.accessMode !== "research_readonly") return true;
  return researchDynamicTools.has(name) || (name === "UpdateMemory" && turn.goalThread?.planMode === "contract_plan");
}
