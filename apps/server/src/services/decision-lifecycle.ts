/** Compatibility exports: Server and Worker share one Decision lifecycle implementation. */
export { revokeOutcomeDecisionNotification as revokeDecisionNotification, withdrawSupersededOutcomeDecisions as withdrawSupersededDecisions } from "@outcomego/messaging";
export const activeDecisionStatuses = ["open", "presented"] as const;
