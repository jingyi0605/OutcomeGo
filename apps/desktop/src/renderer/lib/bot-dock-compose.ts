/** Pure rules of the Bot floating window's composer: who a message goes to, and the `@` picker. */

export interface ComposeBot {
  id: string;
  name: string;
}

export interface ActiveMention {
  /** What was typed after the `@`. */
  query: string;
  /** Index of the `@` in the text. */
  start: number;
  /** The caret: the end of what was typed. */
  end: number;
}

const handleFor = (name: string) => name.trim().replace(/\s+/g, "").toLocaleLowerCase("en-US");
const lower = (text: string) => text.toLocaleLowerCase("en-US");
const mentionPattern = () => /(^|\s)@([\p{L}\p{N}:._-]+)/gu;

/** The `@name` being typed right before the caret, if any. */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const match = /(^|\s)@([\p{L}\p{N}:._-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? "";
  return { query, start: caret - query.length - 1, end: caret };
}

/** The Bots a query narrows the list to (by name or handle); all of them for an empty query. */
export function filterComposeBots<T extends ComposeBot>(bots: readonly T[], query: string): T[] {
  const needle = lower(query.trim());
  if (!needle) return [...bots];
  return bots.filter(
    (bot) => lower(bot.name).includes(needle) || handleFor(bot.name).includes(needle)
  );
}

/** Removes the `@query` being typed once a Bot was picked from the list. */
export function removeMention(
  text: string,
  mention: ActiveMention
): { text: string; caret: number } {
  const before = text.slice(0, mention.start);
  const after = text.slice(mention.end);
  // "hi @bo there" -> "hi there": one of the two separating spaces goes with the token.
  const tidy = /(^|\s)$/.test(before) ? after.replace(/^[ \t]/, "") : after;
  return { text: before + tidy, caret: before.length };
}

/** The first complete `@Bot` in the text, with the text that remains without it. */
function firstMention(
  text: string,
  bots: readonly ComposeBot[]
): { botId: string; rest: string } | null {
  const byHandle = new Map<string, string>();
  for (const bot of bots) {
    const handle = handleFor(bot.name);
    if (handle && !byHandle.has(handle)) byHandle.set(handle, bot.id);
  }
  const pattern = mentionPattern();
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const botId = byHandle.get(lower(match[2] ?? ""));
    if (!botId) continue;
    const start = match.index + (match[1]?.length ?? 0);
    const after = text.slice(match.index + match[0].length).replace(/^[ \t]/, "");
    return { botId, rest: text.slice(0, start) + after };
  }
  return null;
}

/**
 * Who the message goes to: a `@Bot` typed in it wins, then the Bot picked with the target chip,
 * then the main Bot (the first in the list).
 */
export function composeTarget<T extends ComposeBot>(
  text: string,
  bots: readonly T[],
  selectedId: string | null
): T | null {
  const mentioned = firstMention(text, bots)?.botId;
  const id = mentioned ?? selectedId;
  return bots.find((bot) => bot.id === id) ?? bots[0] ?? null;
}

/** The message to send, without the `@Bot` that chose its recipient; null when it is blank
 * (and has no images). */
export function composeMessage(
  text: string,
  bots: readonly ComposeBot[],
  selectedId: string | null,
  hasImages = false
): { botId: string; content: string } | null {
  const target = composeTarget(text, bots, selectedId);
  if (!target) return null;
  const content = (firstMention(text, bots)?.rest ?? text).trim();
  // Pasted images are a message by themselves.
  return content || hasImages ? { botId: target.id, content } : null;
}
