import { parseOutcomeDeepLink } from "@outcomego/contracts/app-deep-links";
import { OUTCOME_INBOX_CATEGORIES, type OutcomeInboxCategory } from "@outcomego/contracts/outcome-inbox";

export interface DesktopOutcomeTarget {
  outcomeId?: string;
  decisionId?: string;
  category?: OutcomeInboxCategory;
  channelId?: string;
  notificationSequence?: string;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Sanitizes the identity crossing IPC; no business text or arbitrary URL survives. */
export function parseDesktopOutcomeTarget(value: unknown): DesktopOutcomeTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.outcomeId !== undefined && !uuid(input.outcomeId) || input.decisionId !== undefined && !uuid(input.decisionId)) return null;
  if (input.category !== undefined && !(OUTCOME_INBOX_CATEGORIES as readonly unknown[]).includes(input.category)) return null;
  if (input.channelId !== undefined && !uuid(input.channelId)) return null;
  if (input.notificationSequence !== undefined && (typeof input.notificationSequence !== "string" || !/^\d{1,20}$/.test(input.notificationSequence))) return null;
  return {
    ...(uuid(input.outcomeId) ? { outcomeId: input.outcomeId } : {}),
    ...(uuid(input.decisionId) ? { decisionId: input.decisionId } : {}),
    ...(typeof input.category === "string" ? { category: input.category as OutcomeInboxCategory } : {}),
    ...(uuid(input.channelId) ? { channelId: input.channelId } : {}),
    ...(typeof input.notificationSequence === "string" ? { notificationSequence: input.notificationSequence } : {}),
  };
}
export function parseDesktopOutcomeLink(value: string): DesktopOutcomeTarget | null {
  const parsed = parseOutcomeDeepLink(value);
  if (parsed) return parsed;
  try {
    const url = new URL(value);
    if (url.protocol === "outcomego:" && url.host === "app" && !url.username && !url.href.includes("@") && !url.hash &&
      ["/v1/outcomes", "/v1/outcomes/decision"].includes(url.pathname) && !url.search) return {};
  } catch { /* Unrecognized links remain with the existing app handlers. */ }
  return null;
}
