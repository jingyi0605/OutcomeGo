import { expect, test } from "bun:test";
import { Schema } from "effect";
import { CreateExploreIdeaInput, EXPLORE_STATUSES, ProposeExploreIdeaInput } from "../src/explore";

test("an informal idea requires no contract, Bot or approved status", () => {
  const idea = Schema.decodeUnknownSync(CreateExploreIdeaInput)({
    title: "Compare alternatives", note: "Investigate first", clientRequestId: "explore:test",
    status: "exploring", actorRef: "user:forged", proposedOutcomeId: "forged",
  });
  expect(idea.status).toBe("exploring");
  expect("actorRef" in idea).toBe(false);
  expect("proposedOutcomeId" in idea).toBe(false);
  expect(() => Schema.decodeUnknownSync(CreateExploreIdeaInput)({ ...idea, status: "converted" })).toThrow();
  expect(EXPLORE_STATUSES).toContain("proposed_for_delivery");
  expect(EXPLORE_STATUSES as readonly string[]).not.toContain("proposed");
});

test("proposals accept intent only; conversion and approval fields cannot be forged", () => {
  const input = Schema.decodeUnknownSync(ProposeExploreIdeaInput)({
    clientRequestId: "propose:test", approved: true, sourceExploreId: "forged", status: "converted",
  });
  expect(input).toEqual({ clientRequestId: "propose:test" });
});
