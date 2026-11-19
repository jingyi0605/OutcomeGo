import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { outcomeNotificationPayload } from "../src/notification-content";
import { outcomeDeepLink, outcomeDecisionDeepLink, parseOutcomeDeepLink } from "../src/app-deep-links";
import { encodeOutcomeInboxCursor, parseOutcomeInboxQuery, ResolveDecisionInput } from "../src/outcome-inbox";
import { legacyDesktopAccepts, legacyMobileAccepts } from "./fixtures/legacy-notification-parser";
const id = "11111111-1111-4111-8111-111111111111";

describe("Outcome inbox contracts", () => {
  test("strict bounded cursor and request parsing", () => {
    const cursor = { priority: 3, availableAt: "2026-11-17T00:00:00.000Z", id: `decision_pending:${id}`, snapshotAt: "2026-11-17T01:00:00.000Z" };
    expect(parseOutcomeInboxQuery(new URLSearchParams({ cursor: encodeOutcomeInboxCursor(cursor), limit: "500" }))).toEqual({ status: "pending", limit: 100, category: undefined, cursor });
    for (const query of ["cursor=bad", "limit=NaN", "limit=0", "category=progress", "status=running"]) expect(() => parseOutcomeInboxQuery(new URLSearchParams(query))).toThrow();
    expect(() => Schema.decodeUnknownSync(ResolveDecisionInput)({ expectedContractRevision: id, clientRequestId: "request-1" })).toThrow();
  });
  test("links preserve identity and never accept arbitrary schemes or content", () => {
    expect(parseOutcomeDeepLink(outcomeDeepLink(id))).toEqual({ outcomeId: id });
    expect(parseOutcomeDeepLink(outcomeDecisionDeepLink(id))).toEqual({ decisionId: id });
    for (const link of ["https://app/v1/outcomes?id="+id, outcomeDeepLink(id)+"&token=secret", "outcomego://app/v1/outcomes", outcomeDeepLink("bad"), outcomeDeepLink(id)+"#private"]) expect(parseOutcomeDeepLink(link)).toBeNull();
  });
  test("payload snapshot contains fixed presentation and identity, never business content", () => {
    const payload = outcomeNotificationPayload({ type: "outcome.decision.required", factKey: `decision.required:${id}`, outcomeId: id, decisionId: id, botId: id, channelId: id, contractRevision: 2 });
    expect(payload).toEqual({ schemaVersion: 1, kind: "outcome", type: "outcome.decision.required", factKey: `decision.required:${id}`, outcomeId: id, decisionId: id, category: "decision_pending", contractRevision: 2, priority: 3, botId: id, channelId: id, notificationSequence: "0", badgeCount: 0, title: "An Outcome needs your attention", body: "Open OutcomeGo to decide the next step.", deepLink: outcomeDecisionDeepLink(id) });
    expect(legacyDesktopAccepts(payload)).toBe(false);
    expect(legacyMobileAccepts(payload)).toBe(false);
    for (const kind of ["message", "reaction"]) {
      expect(legacyDesktopAccepts({ kind })).toBe(true);
      expect(legacyMobileAccepts({ kind })).toBe(true);
    }
  });
});
