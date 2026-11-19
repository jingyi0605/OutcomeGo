import type { BotView } from "@outcomego/contracts";
import { API_BASE } from "../client/http";
import { authHeaders } from "../client/auth";

const cache = new Map<string, Promise<string | undefined>>();

/**
 * Custom avatars are authenticated resources, and the floating windows (ScreenBot, the Bot
 * dock) run in pages without the account. They get a small square data URL instead.
 */
export const botAvatarDataUrl = (
  bot: Pick<BotView, "id" | "hasAvatar" | "updatedAt">
): Promise<string | undefined> => {
  if (!bot.hasAvatar) return Promise.resolve(undefined);
  const key = `${bot.id}:${bot.updatedAt}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = (async () => {
    try {
      const response = await fetch(
        `${API_BASE}/api/v0/bots/${encodeURIComponent(bot.id)}/avatar?v=${encodeURIComponent(bot.updatedAt)}`,
        { headers: authHeaders() }
      );
      if (!response.ok) return undefined;
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 96;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      const side = Math.min(bitmap.width, bitmap.height);
      context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        96,
        96
      );
      bitmap.close();
      return canvas.toDataURL("image/png");
    } catch {
      // Not cached: the next call may succeed (offline, or signed in a moment later).
      cache.delete(key);
      return undefined;
    }
  })();
  cache.set(key, result);
  return result;
};

export const clearBotAvatarDataUrls = () => cache.clear();
