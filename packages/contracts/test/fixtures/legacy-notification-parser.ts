// Frozen pre-004.3 Desktop allow-list (main/notifications.ts and notification-content.ts).
const agentNotificationTypeCatalog = {
  message: { fallbackBody: "Open OutcomeGo to see what it did.", sound: "default" },
  reaction: { fallbackBody: "Reacted to your message.", sound: "default" },
} as const;
export const legacyDesktopAccepts = (value: { kind?: unknown }): boolean =>
  typeof value.kind === "string" && Object.hasOwn(agentNotificationTypeCatalog, value.kind);
// Frozen iOS NativeNotifications.swift:501 / Android FcmNotification.isAlert.
export const legacyMobileAccepts = (value: { kind?: unknown }): boolean =>
  value.kind === "message" || value.kind === "reaction";
