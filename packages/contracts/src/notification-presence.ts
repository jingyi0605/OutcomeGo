/** Device availability is a lease, separate from the five-minute Mac idle limit. */
export const NOTIFICATION_PRESENCE_TTL_MS = 60_000;
export const NOTIFICATION_HEARTBEAT_MS = 30_000;
export const MAC_NOTIFICATION_IDLE_SECONDS = 300;

export interface NotificationPresenceInput {
  /** A new ID for each client lifecycle; sequence orders overlapping requests. */
  clientId: string;
  sequence: number;
  platform: "macos" | "windows" | "ios" | "android";
  active: boolean;
  idleSeconds?: number;
}

/** How much Bot chatter raises an alert: every message, or only a turn's final summary. */
export const BOT_MESSAGE_NOTIFY_LEVELS = ["every_message", "final_only"] as const;
export type BotMessageNotifyLevel = (typeof BOT_MESSAGE_NOTIFY_LEVELS)[number];

export const isBotMessageNotifyLevel = (value: unknown): value is BotMessageNotifyLevel =>
  (BOT_MESSAGE_NOTIFY_LEVELS as readonly unknown[]).includes(value);

export interface NotificationRouting {
  smartEnabled: boolean;
  /** Absent on servers that predate the setting, which alert on every message. */
  botMessageLevel?: BotMessageNotifyLevel;
  serverTime: number;
  iosActiveUntil: number;
  androidActiveUntil?: number;
  macActiveUntil: number;
  windowsActiveUntil?: number;
}

export function notificationPresenceLifetime(input: NotificationPresenceInput): number {
  if (!input.active) return 0;
  if (input.platform === "ios" || input.platform === "android") return NOTIFICATION_PRESENCE_TTL_MS;
  return Math.max(
    0,
    Math.min(
      NOTIFICATION_PRESENCE_TTL_MS,
      (MAC_NOTIFICATION_IDLE_SECONDS - (input.idleSeconds ?? MAC_NOTIFICATION_IDLE_SECONDS)) * 1_000
    )
  );
}

export function suppressMobileNotification(
  routing: NotificationRouting,
  platform: "ios" | "android" = "ios",
  now = routing.serverTime
): boolean {
  const mobileActiveUntil =
    platform === "android" ? (routing.androidActiveUntil ?? 0) : routing.iosActiveUntil;
  const desktopActiveUntil = Math.max(
    routing.macActiveUntil,
    routing.windowsActiveUntil ?? 0
  );
  return routing.smartEnabled && mobileActiveUntil <= now && desktopActiveUntil > now;
}
