/** Operational rollback switch: retain facts and reads while stopping new Outcome dispatch. */
export function outcomeDispatchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !["false", "0"].includes(env.OUTCOMEGO_OUTCOMES_ENABLED?.toLowerCase() ?? "");
}
