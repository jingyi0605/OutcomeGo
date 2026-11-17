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
