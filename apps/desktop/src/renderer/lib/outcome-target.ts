import { parseOutcomeDeepLink } from "@outcomego/contracts/app-deep-links";
import { OUTCOME_NOTIFICATION_CATEGORIES, type OutcomeNotificationCategory } from "@outcomego/contracts/notification-content";

export type OutcomeWorkspaceSection = "overview" | "all" | "inbox" | "explore" | "calendar";

const OUTCOME_WORKSPACE_SECTIONS: readonly OutcomeWorkspaceSection[] = [
  "overview",
  "all",
  "inbox",
  "explore",
  "calendar",
];

export interface DesktopOutcomeTarget {
  outcomeId?: string;
  decisionId?: string;
  scheduledGoalId?: string;
  section?: OutcomeWorkspaceSection;
  category?: OutcomeNotificationCategory;
  channelId?: string;
  notificationSequence?: string;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Sanitizes the identity crossing IPC; no business text or arbitrary URL survives. */
export function parseDesktopOutcomeTarget(value: unknown): DesktopOutcomeTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.outcomeId !== undefined && !uuid(input.outcomeId) || input.decisionId !== undefined && !uuid(input.decisionId)) return null;
  if (input.section !== undefined && !(OUTCOME_WORKSPACE_SECTIONS as readonly unknown[]).includes(input.section)) return null;
  if (input.category !== undefined && !(OUTCOME_NOTIFICATION_CATEGORIES as readonly unknown[]).includes(input.category)) return null;
  if (input.channelId !== undefined && !uuid(input.channelId)) return null;
  if (input.notificationSequence !== undefined && (typeof input.notificationSequence !== "string" || !/^\d{1,20}$/.test(input.notificationSequence))) return null;
  return {
    ...(uuid(input.outcomeId) ? { outcomeId: input.outcomeId } : {}),
    ...(uuid(input.decisionId) ? { decisionId: input.decisionId } : {}),
    ...(typeof input.section === "string" ? { section: input.section as OutcomeWorkspaceSection } : {}),
    ...(typeof input.category === "string" ? { category: input.category as OutcomeNotificationCategory } : {}),
    ...(uuid(input.channelId) ? { channelId: input.channelId } : {}),
    ...(typeof input.notificationSequence === "string" ? { notificationSequence: input.notificationSequence } : {}),
  };
}
export function parseDesktopOutcomeLink(value: string): DesktopOutcomeTarget | null {
  try { if (new URL(value).href.includes("@")) return null; } catch { return null; }
  const parsed = parseOutcomeDeepLink(value);
  if (parsed) return parsed;
  try {
    const url = new URL(value);
    if (url.protocol === "outcomego:" && url.host === "app" && !url.username && !url.href.includes("@") && !url.hash &&
      ["/v1/outcomes", "/v1/outcomes/decision"].includes(url.pathname) && !url.search) return {};
  } catch { /* Unrecognized links remain with the existing app handlers. */ }
  return null;
}
