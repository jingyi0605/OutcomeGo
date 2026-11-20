import type { ActiveTurn } from "./types";

type ToolDetails = Record<string, unknown> | undefined;

const key = (machineId: string | undefined, shellId: string) => `${machineId ?? ""}\u0000${shellId}`;

const shellIdOf = (details: ToolDetails): string | undefined => {
  const id = details?.shellId ?? details?.shell_id;
  return typeof id === "string" && id ? id : undefined;
};

/**
 * A Shell call that came back still running is now a background command. When it ends, its
 * completion wakes the bot in a later turn, which is when its result is delivered.
 */
export function recordBackgroundShell(
  active: Pick<ActiveTurn, "backgroundShells">,
  machineId: string | undefined,
  details: ToolDetails
): void {
  const shellId = shellIdOf(details);
  if (details?.status !== "running" || !shellId) return;
  (active.backgroundShells ??= new Map()).set(key(machineId, shellId), { machineId, shellId });
}

/**
 * AwaitShell that reports a finished command hands its result to this turn, and the registry
 * suppresses the completion wake for it. A wait that is still running leaves the command owed.
 */
export function observeShellAwait(
  active: Pick<ActiveTurn, "backgroundShells">,
  machineId: string | undefined,
  shellId: string | undefined,
  details: ToolDetails
): void {
  if (!shellId || !["completed", "failed"].includes(String(details?.status))) return;
  active.backgroundShells?.delete(key(machineId, shellId));
}

/** Background commands this turn started whose result has not reached it, so a later turn owes it. */
export const backgroundWorkPending = (active: Pick<ActiveTurn, "backgroundShells">): boolean =>
  (active.backgroundShells?.size ?? 0) > 0;
