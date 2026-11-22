import type { BotView, ClientSnapshot } from "@outcomego/contracts";
import { desktopNotificationSnapshot } from "./notifications";

/** What the Bot floating window shows for one Bot. Mirrors src/main/bot-dock-model.ts: the
 * renderer may not import from the main process. */
export interface BotDockBotView {
  id: string;
  name: string;
  color: string;
  icon: string;
  channelId: string;
  avatarDataUrl?: string;
  /** Unread messages: the red badge. */
  messages: number;
  /** Goals waiting on the owner: the yellow badge. */
  goals: number;
}

/** A Bot the floating composer can write to; the first is the main Bot. */
export interface BotDockRosterView {
  id: string;
  name: string;
  color: string;
  icon: string;
  avatarDataUrl?: string;
}

export interface BotDockLabelsView {
  messages: string;
  goals: string;
  open: string;
  running?: string;
  placeholder: string;
  goalPlaceholder?: string;
  chatMode?: string;
  goalMode?: string;
  switchMode?: string;
  send: string;
  to: string;
  failed: string;
  empty: string;
  attachmentInvalid: string;
  removeAttachment: string;
}

export interface BotDockStateView {
  bots: BotDockBotView[];
  roster: BotDockRosterView[];
  labels: BotDockLabelsView;
  theme?: "light" | "dark" | "system";
  running?: boolean;
  outcomesEnabled?: boolean;
}

export const hasRunningBot = (snapshot: ClientSnapshot | null | undefined): boolean =>
  Boolean(
    snapshot?.runs.some((run) => run.status === "running") ||
    snapshot?.subagents?.some((task) => task.status === "running")
  );

/** A Bot the dock tracks, with what is needed to fetch its avatar. */
export type BotDockEntry = BotDockBotView & Pick<BotView, "hasAvatar" | "updatedAt">;

/** The Bots a message can go to: the active ones in the server's order, so the first is the
 * main Bot (the same rule as the quick-idea form). */
export const deriveBotDockRoster = (
  snapshot: ClientSnapshot | null | undefined
): Array<BotDockRosterView & Pick<BotView, "hasAvatar" | "updatedAt">> =>
  (snapshot?.bots ?? [])
    .filter((bot) => bot.status === "active")
    .map((bot) => ({
      id: bot.id,
      name: bot.name,
      color: bot.color,
      icon: bot.icon,
      hasAvatar: bot.hasAvatar,
      updatedAt: bot.updatedAt,
    }));

/**
 * Bots with unread replies that need attention or goals waiting on the owner.
 * A newer progress update does not move a reply to the top of the stack.
 */
export const deriveBotDockEntries = (
  snapshot: ClientSnapshot | null | undefined,
  goalsByBot: Readonly<Record<string, number>> = {}
): BotDockEntry[] => {
  if (!snapshot) return [];
  const unreadByChannel = new Map<string, number>();
  for (const channel of desktopNotificationSnapshot(snapshot).channels) {
    unreadByChannel.set(channel.channelId, channel.botDock?.unreadCount ?? channel.unreadCount);
  }
  const updatedAtByChannel = new Map(
    snapshot.channels.map((channel) => [
      channel.id,
      channel.notificationState?.botDock?.latest?.createdAt ?? channel.updatedAt,
    ] as const)
  );
  const entries: BotDockEntry[] = [];
  for (const bot of snapshot.bots) {
    if (bot.status === "archived" || bot.status === "failed") continue;
    const messages =
      bot.notificationsEnabled === false ? 0 : (unreadByChannel.get(bot.dmChannelId) ?? 0);
    const goals = goalsByBot[bot.id] ?? 0;
    if (messages <= 0 && goals <= 0) continue;
    entries.push({
      id: bot.id,
      name: bot.name,
      color: bot.color,
      icon: bot.icon,
      channelId: bot.dmChannelId,
      messages,
      goals,
      hasAvatar: bot.hasAvatar,
      updatedAt: bot.updatedAt,
    });
  }
  return entries.sort(
    (left, right) =>
      (updatedAtByChannel.get(right.channelId) ?? "").localeCompare(
        updatedAtByChannel.get(left.channelId) ?? ""
      ) || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
  );
};
