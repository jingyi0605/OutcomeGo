/** Settings rows the apps open from an outcomego://app/v1/settings?id=<anchor> link. */
export const APP_SETTINGS_ANCHORS = [
  "language",
  "theme",
  "microphone",
  "computers",
  "browser-network",
  "inference-provider",
  "inference-model",
  "inference-reasoning",
  "update-status",
  "update-channel",
  "server-update",
  "tailscale-https",
  "automatic-updates",
  "web-search-provider",
  "web-fetch-provider",
  // Goal management page and its groups (specs/004.10). Mobile has no such page and does not open settings links.
  "goal-management",
  "goal-roles",
  "goal-schedule",
  "goal-activity",
  "goal-todo",
  "goal-auto-accept",
  "goal-calendar",
] as const;

/** Outcome links contain object identity only; callers load content after authentication. */
export const outcomeDeepLink = (outcomeId: string): string =>
  `outcomego://app/v1/outcomes?id=${encodeURIComponent(outcomeId)}`;
export const outcomeDecisionDeepLink = (decisionId: string): string =>
  `outcomego://app/v1/outcomes/decision?id=${encodeURIComponent(decisionId)}`;
export const parseOutcomeDeepLink = (value: string): { outcomeId?: string; decisionId?: string } | null => {
  try {
    const link = new URL(value);
    if (link.protocol !== "outcomego:" || link.hostname !== "app" || link.username || link.port || link.hash || [...link.searchParams.keys()].some(key => key !== "id")) return null;
    const id = link.searchParams.get("id");
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || link.searchParams.getAll("id").length !== 1) return null;
    if (link.pathname === "/v1/outcomes") return { outcomeId: id };
    if (link.pathname === "/v1/outcomes/decision") return { decisionId: id };
    return null;
  } catch { return null; }
};
