import type { ProposeExploreIdeaInput } from "@outcomego/contracts/explore";
import type { ExploreClient } from "./explore-api";
import { responseCode, responseStatus } from "../inbox/decision-state";
import { OutcomeRequestIds } from "../planning/outcome-client";

export const isExplorePlanningFailure = (cause: unknown): boolean =>
  responseStatus(cause) === 502 && responseCode(cause) === "planning_generation_failed";

export async function proposeExploreIdea(
  client: Pick<ExploreClient, "propose">, ids: OutcomeRequestIds, ideaId: string,
  input: Omit<ProposeExploreIdeaInput, "clientRequestId">,
) {
  const key = `propose:${ideaId}`;
  try {
    const result = await client.propose(ideaId, { ...input, clientRequestId: ids.for(key, input) });
    ids.complete(key);
    return result;
  } catch (cause) {
    // The server durably replays this terminal failure; only an explicit retry gets a new intent.
    if (isExplorePlanningFailure(cause)) ids.complete(key);
    throw cause;
  }
}

export interface QuickIdeaBot {
  id: string;
  name: string;
}
export interface QuickIdeaDraft {
  title: string;
  note: string;
  botId: string | null;
}
const MAX_TITLE = 200;
const MENTION = /(^|\s)@([\p{L}\p{N}:._-]+)/gu;
const handleFor = (name: string) => name.trim().replace(/\s+/g, "").toLocaleLowerCase("en-US");

/**
 * Turns the single free-text box into an idea. The first `@Bot` mention picks the execution Bot and
 * is removed from the text; without one the main Bot (the first in the list) is used.
 */
export function quickIdeaDraft(text: string, bots: readonly QuickIdeaBot[]): QuickIdeaDraft | null {
  const byHandle = new Map(bots.map((bot) => [handleFor(bot.name), bot.id]));
  let botId: string | null = null;
  const stripped = text.replace(MENTION, (match, lead: string, handle: string) => {
    const id = byHandle.get(handle.toLocaleLowerCase("en-US"));
    if (!id) return match;
    botId ??= id;
    return lead;
  });
  const cleaned = stripped
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .trim();
  if (!cleaned) return null;
  const [first = "", ...rest] = cleaned.split("\n");
  const long = first.length > MAX_TITLE;
  return {
    title: long ? first.slice(0, MAX_TITLE) : first,
    note: long ? cleaned : rest.join("\n").trim(),
    botId: botId ?? bots[0]?.id ?? null,
  };
}
