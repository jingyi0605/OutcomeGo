import { OUTCOME_INBOX_CATEGORIES } from "./outcome-inbox-categories";
import { outcomeDeepLink, outcomeDecisionDeepLink } from "./app-deep-links";
import type { BotMessageNotifyLevel } from "./notification-presence";
/** Cross-process PostgreSQL advisory lock protecting the final push authorization/send boundary. */
export const PUSH_DELIVERY_ADVISORY_LOCK = {
  namespace: 0x4f50424f,
  key: 0x54505553,
} as const;

export const normalizeNotificationText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

type GraphemeSegmenter = { segment: (input: string) => Iterable<{ segment: string }> };
type GraphemeSegmenterConstructor = new (
  locale?: string,
  options?: { granularity: "grapheme" }
) => GraphemeSegmenter;
let cachedSegmenterConstructor: GraphemeSegmenterConstructor | undefined;
let cachedSegmenter: GraphemeSegmenter | undefined;
const notificationSegmenter = (): GraphemeSegmenter | undefined => {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  if (Segmenter !== cachedSegmenterConstructor) {
    cachedSegmenterConstructor = Segmenter;
    cachedSegmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : undefined;
  }
  return cachedSegmenter;
};

export const notificationGraphemes = (value: string): string[] => {
  const normalized = normalizeNotificationText(value);
  const segmenter = notificationSegmenter();
  return segmenter
    ? [...segmenter.segment(normalized)].map((part) => part.segment)
    : Array.from(normalized);
};

// Large ASCII previews only need a bounded normalized prefix. Fall back for
// Unicode, unusual limits, or long whitespace runs to preserve exact behavior.
const largeAsciiNotificationPreview = (value: string, limit: number): string | null => {
  if (value.length < 4096 || !Number.isFinite(limit) || limit < 0 || limit > 1024) return null;
  let prefix = "";
  let space = false;
  const scanned = Math.min(value.length, Math.ceil(limit) * 2 + 64);
  for (let index = 0; index < scanned; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 127) return null;
    if (code === 32 || (code >= 9 && code <= 13)) {
      space = prefix.length > 0;
      continue;
    }
    if (space) prefix += " ";
    prefix += value[index];
    space = false;
    if (prefix.length > limit) return `${prefix.slice(0, Math.max(0, Math.trunc(limit - 1)))}…`;
  }
  return scanned === value.length ? prefix : null;
};

export const truncateNotificationText = (value: string, limit = 140): string => {
  const preview = largeAsciiNotificationPreview(value, limit);
  if (preview !== null) return preview;
  const normalized = normalizeNotificationText(value);
  if (normalized.length <= limit) return normalized;
  if (Number.isNaN(limit) || limit < 0) return "…";
  const prefixLength = Math.max(0, Math.trunc(limit - 1));
  // Whitespace normalization removes CRLF clusters; ASCII then has one code
  // unit per grapheme. Unicode still takes the exact grapheme-aware path.
  if (/^[\x00-\x7f]*$/.test(normalized)) return `${normalized.slice(0, prefixLength)}…`;
  const segments = notificationSegmenter()?.segment(normalized) ?? normalized;
  let count = 0;
  let prefix = "";
  for (const part of segments) {
    count += 1;
    if (count > limit) return `${prefix}…`;
    if (count <= prefixLength) prefix += typeof part === "string" ? part : part.segment;
  }
  return normalized;
};

/** Every visible Bot message, cards included, is a `message`. */
export type AgentNotificationKind = "message" | "reaction";

export interface NotificationReadState {
  channelId: string;
  lastReadSequence: string;
  lastReadNotificationSequence: string;
}

export interface ChannelNotificationView {
  notificationSequence: string;
  channelId: string;
  botId: string;
  kind: AgentNotificationKind;
  messageSequence: string;
  messageId?: string;
  /** Set when the message is a reply inside a thread, so opening the alert opens that thread. */
  threadMessageId?: string;
  title: string;
  body: string;
  sender?: NotificationSender;
}

/** Message identity carried from a native desktop banner to its renderer. */
export interface DesktopNotificationTarget {
  channelId: string;
  messageId?: string;
  messageSequence?: string;
  threadMessageId?: string;
}

/** Self-contained identity: extensions can draw the avatar without a network request. */
export interface NotificationSender {
  name: string;
  icon: string;
  color: string;
  /** Desktop renderer-local PNG, never required in a push payload. */
  avatarDataUrl?: string;
}

export interface ChannelNotificationState extends NotificationReadState {
  notificationCursor: string;
  notifications: ChannelNotificationView[];
  activityUnreadCount: number;
  /** Owner's alert level for Bot messages; absent from servers that predate the setting. */
  botMessageLevel?: BotMessageNotifyLevel;
  /** Floating-window attention, independent of the bounded native alert history. */
  botDock?: {
    unreadCount: number;
    latest: {
      notificationSequence: string;
      messageSequence: string;
      createdAt: string;
    } | null;
  };
}

export const notificationIsRead = (
  notification: Pick<ChannelNotificationView, "kind" | "messageSequence" | "notificationSequence">,
  state: Pick<NotificationReadState, "lastReadSequence" | "lastReadNotificationSequence">
): boolean => {
  const sequence = (value: string | undefined) =>
    value && /^\d+$/.test(value) ? BigInt(value) : -1n;
  if (notification.kind === "reaction") {
    return (
      sequence(notification.notificationSequence) >= 0n &&
      sequence(notification.notificationSequence) <= sequence(state.lastReadNotificationSequence)
    );
  }
  return (
    sequence(notification.messageSequence) >= 0n &&
    sequence(notification.messageSequence) <= sequence(state.lastReadSequence)
  );
};

export interface AgentNotificationPresentation {
  title: string;
  body: string;
  sound: "default";
}

/** Shared presentation contract for native macOS and iOS notifications. */
const agentNotificationTypeCatalog = {
  message: { fallbackBody: "Open OutcomeGo to see what it did.", sound: "default" },
  reaction: { fallbackBody: "Reacted to your message.", sound: "default" },
} as const satisfies Record<AgentNotificationKind, { fallbackBody: string; sound: "default" }>;

export const isAgentNotificationKind = (value: unknown): value is AgentNotificationKind =>
  typeof value === "string" && Object.hasOwn(agentNotificationTypeCatalog, value);

export const agentNotificationDeliveryPolicy = (
  kind: AgentNotificationKind
): Pick<AgentNotificationPresentation, "sound"> => ({
  sound: agentNotificationTypeCatalog[kind].sound,
});

export const agentNotificationPresentation = (input: {
  kind: AgentNotificationKind;
  botName: string;
  body?: string | null;
}): AgentNotificationPresentation => {
  const definition = agentNotificationTypeCatalog[input.kind];
  return {
    title: normalizeNotificationText(input.botName) || "OutcomeGo",
    body: truncateNotificationText(input.body?.trim() ? input.body : definition.fallbackBody),
    ...agentNotificationDeliveryPolicy(input.kind),
  };
};

export const OUTCOME_NOTIFICATION_TYPES = [
  "outcome.decision.required", "outcome.review.required", "outcome.human_action.required", "outcome.accepted",
  "outcome.failed", "outcome.blocked",
] as const;
export type OutcomeNotificationType = (typeof OUTCOME_NOTIFICATION_TYPES)[number];

/** Failed and blocked are notification-only: they are not Inbox cards, so the Inbox categories stay unchanged. */
export const OUTCOME_NOTIFICATION_CATEGORIES = [...OUTCOME_INBOX_CATEGORIES, "failed", "blocked"] as const;
export type OutcomeNotificationCategory = (typeof OUTCOME_NOTIFICATION_CATEGORIES)[number];

/** Separate from chat activity so old clients safely ignore the unknown kind. */
export interface OutcomeNotificationPayload {
  schemaVersion: 1;
  kind: "outcome";
  type: OutcomeNotificationType;
  factKey: string;
  outcomeId: string;
  decisionId?: string;
  category: OutcomeNotificationCategory;
  contractRevision: number;
  priority: number;
  botId: string;
  channelId: string;
  notificationSequence: string;
  badgeCount: number;
  title: string;
  body: string;
  deepLink: string;
}

/** Fixed text deliberately excludes titles, options and summaries from business input. */
export const outcomeNotificationPayload = (input: {
  type: OutcomeNotificationType; factKey: string; outcomeId: string; decisionId?: string;
  botId: string; channelId: string; contractRevision: number; urgent?: boolean;
}): OutcomeNotificationPayload => {
  const category: OutcomeNotificationCategory = input.type === "outcome.decision.required" ? "decision_pending" : input.type === "outcome.review.required" ? "acceptance_pending" : input.type === "outcome.human_action.required" ? "human_action_pending" : input.type === "outcome.failed" ? "failed" : input.type === "outcome.blocked" ? "blocked" : "completed";
  const priorities: Record<OutcomeNotificationCategory, number> = { decision_pending: 3, failed: 3, human_action_pending: 2, blocked: 2, acceptance_pending: 1, completed: 0 };
  return {
    schemaVersion: 1, kind: "outcome", type: input.type, factKey: input.factKey,
    outcomeId: input.outcomeId, ...(input.decisionId ? { decisionId: input.decisionId } : {}),
    category, contractRevision: input.contractRevision,
    priority: input.urgent ? 4 : priorities[category],
    botId: input.botId, channelId: input.channelId, notificationSequence: "0", badgeCount: 0,
    title: category === "completed" ? "Outcome completed" : "An Outcome needs your attention",
    body: category === "decision_pending" ? "Open OutcomeGo to decide the next step." : category === "failed" ? "Open OutcomeGo to see why it stopped." : category === "blocked" ? "Open OutcomeGo to see what is blocking it." : "Open OutcomeGo to view the outcome.",
    deepLink: input.decisionId ? outcomeDecisionDeepLink(input.decisionId) : outcomeDeepLink(input.outcomeId),
  };
};

/**
 * A tracked request that waits on the owner. It has no outcome, so it is not an outcome notification; old clients
 * ignore the unknown kind. The text is fixed: nothing the bot wrote is placed in an alert.
 */
export interface RequestNotificationPayload {
  schemaVersion: 1;
  kind: "request";
  factKey: string;
  requestId: string;
  state: "needs_owner" | "no_follow_up" | "check_not_fired";
  revision: number;
  botId: string;
  channelId: string;
  notificationSequence: string;
  badgeCount: number;
  title: string;
  body: string;
}

export const requestNotificationPayload = (input: {
  requestId: string; state: RequestNotificationPayload["state"]; revision: number; botId: string; channelId: string;
}): RequestNotificationPayload => ({
  schemaVersion: 1, kind: "request",
  // One fact per request, revision and state: the same thing in the same state is announced once.
  factKey: `request:${input.requestId}:${input.revision}:${input.state}`,
  requestId: input.requestId, state: input.state, revision: input.revision, botId: input.botId, channelId: input.channelId,
  notificationSequence: "0", badgeCount: 0,
  title: "An Outcome needs your attention",
  body: input.state === "needs_owner" ? "Open OutcomeGo to see what it is waiting for." : "Open OutcomeGo to see a request nobody is following up.",
});
