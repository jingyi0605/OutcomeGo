import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientSnapshot } from "@outcomego/contracts";
import { attachmentAssetKind } from "@outcomego/product-core/attachments";
import { AUTH_CREDENTIALS_CHANGED_EVENT } from "../client/auth";
import { botAvatarDataUrl } from "../lib/bot-avatar-data-url";
import {
  deriveBotDockEntries,
  deriveBotDockRoster,
  hasRunningBot,
  type BotDockStateView,
} from "../lib/bot-dock-state";
import { desktopDurableSendController, discardDesktopDeliveryStages } from "../lib/durable-sends";
import { useI18n } from "../lib/i18n";
import { readThemePreference, THEME_CHANGE_EVENT } from "../lib/theme";

/** The composer's Bot list is capped, like the payload main accepts. */
const MAX_ROSTER = 100;

/**
 * Keeps the Bot floating window (a separate window owned by the main process) current: which
 * Bots have unread messages or goals waiting on the owner, and whether work is running.
 */
export function useBotDockSync(
  snapshot: ClientSnapshot | null | undefined,
  goalsByBot: Readonly<Record<string, number>> | undefined
) {
  const bridge = typeof window === "undefined" ? undefined : window.outcomego?.botDock;
  const { t } = useI18n();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const entries = useMemo(
    () => (bridge ? deriveBotDockEntries(snapshot, goalsByBot) : []),
    [bridge, snapshot, goalsByBot]
  );
  const roster = useMemo(
    () => (bridge ? deriveBotDockRoster(snapshot).slice(0, MAX_ROSTER) : []),
    [bridge, snapshot]
  );
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(new Map());
  const [theme, setTheme] = useState(readThemePreference);
  const lastPublished = useRef<string | null>(null);

  useEffect(() => {
    const onTheme = () => setTheme(readThemePreference());
    window.addEventListener(THEME_CHANGE_EVENT, onTheme);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onTheme);
  }, []);

  // Custom avatars load once per Bot version and are added as they arrive.
  useEffect(() => {
    let active = true;
    for (const entry of [...entries, ...roster]) {
      if (!entry.hasAvatar) continue;
      const key = `${entry.id}:${entry.updatedAt}`;
      if (avatars.has(key)) continue;
      void botAvatarDataUrl(entry).then((url) => {
        if (!active || !url) return;
        setAvatars((current) => (current.has(key) ? current : new Map(current).set(key, url)));
      });
    }
    return () => {
      active = false;
    };
  }, [avatars, entries, roster]);

  const labels = useMemo(
    () => ({
      messages: t("Unread messages"),
      goals: t("Pending action"),
      open: t("Open OutcomeGo"),
      running: t("Bot activity in progress"),
      placeholder: t("Message the main Bot. Type @ to choose a Bot."),
      send: t("Send"),
      to: t("To"),
      failed: t("Couldn’t send. Try again."),
      empty: t("No Bot is available."),
      attachmentInvalid: t("That file can’t be attached."),
      removeAttachment: t("Remove attachment"),
    }),
    [t]
  );

  useEffect(() => {
    if (!bridge) return;
    // Before the first snapshot there is nothing to say; the window stays closed.
    if (!snapshot) return;
    const state: BotDockStateView = {
      labels,
      theme,
      running: hasRunningBot(snapshot),
      roster: roster.map(({ hasAvatar, updatedAt, ...bot }) => {
        const avatar = hasAvatar ? avatars.get(`${bot.id}:${updatedAt}`) : undefined;
        return avatar ? { ...bot, avatarDataUrl: avatar } : bot;
      }),
      bots: entries.map(({ hasAvatar, updatedAt, ...bot }) => {
        const avatar = hasAvatar ? avatars.get(`${bot.id}:${updatedAt}`) : undefined;
        return avatar ? { ...bot, avatarDataUrl: avatar } : bot;
      }),
    };
    const serialized = JSON.stringify(state);
    if (serialized === lastPublished.current) return;
    lastPublished.current = serialized;
    bridge.publish(state);
  }, [avatars, bridge, entries, labels, roster, snapshot, theme]);

  // What is typed in the floating composer goes out like a message typed in the chat: through
  // the durable send path, so it shows up in the conversation at once and survives going offline.
  useEffect(() => {
    if (!bridge) return;
    return bridge.onDeliver(async ({ botId, content, nonce, staged }) => {
      // The same shape the chat composer stages: only an image gets a local preview.
      const stagedAttachments = staged.map((file, position) => {
        const kind = attachmentAssetKind({ fileName: file.fileName, mimeType: file.mimeType });
        return {
          ...file,
          kind,
          position,
          ...(kind === "image"
            ? {
                previewUri: `outcomego-staged://file/${file.stagingId}?mime=${encodeURIComponent(file.mimeType)}`,
              }
            : {}),
        };
      });
      const bot = snapshotRef.current?.bots.find(
        (candidate) => candidate.id === botId && candidate.status === "active"
      );
      if (!bot) throw new Error("That Bot is no longer available.");
      try {
        await desktopDurableSendController().enqueue({
          nonce,
          target: { channelId: bot.dmChannelId, conversationId: bot.conversationId },
          payload: {
            content,
            attachments: [],
            ...(stagedAttachments.length ? { stagedAttachments } : {}),
          },
        });
      } catch (error) {
        // A retry of a message that was already queued (the first answer was lost) is a success;
        // the copies staged for the retry are not needed.
        if (error instanceof Error && /already in use/.test(error.message)) {
          await discardDesktopDeliveryStages(stagedAttachments).catch(() => undefined);
          return;
        }
        throw error;
      }
    });
  }, [bridge]);

  // Signing out, or leaving the workspace, empties the window.
  useEffect(() => {
    if (!bridge) return;
    const clear = () => {
      lastPublished.current = null;
      bridge.publish(null);
    };
    window.addEventListener(AUTH_CREDENTIALS_CHANGED_EVENT, clear);
    return () => {
      window.removeEventListener(AUTH_CREDENTIALS_CHANGED_EVENT, clear);
      clear();
    };
  }, [bridge]);
}
