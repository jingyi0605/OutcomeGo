import { describe, expect, test } from "bun:test";
import { appendOutcomeEvent, transitionWorkItem } from "../src/outcome-state";
import { consumeOutcomeInboxEvent, reconcileOutcomeInboxNotifications, unreadOutcomeNotifications } from "../src/outcome-inbox-notifications";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";
import { outcomeNotificationIsCurrent } from "../src/outcome-inbox-notifications";
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "owner:local" as const;

describe.skipIf(!url)("production Outcome inbox facts", () => {
  test("review, human action and completion events create durable notification facts once and stay private", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item();
      await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { status: "completed" } });
      await h.db.outcomeOutput.create({ data: { outcomeId: h.outcome.id, workItemId: item.id, kind: "final_result", title: "Private customer title", content: "SENSITIVE result", dedupeKey: `test:${item.id}` } });
      const review = await h.db.$transaction(tx => appendOutcomeEvent(tx, "outcome.review.required", h.outcome.id, { actor, contractRevision: 1, payload: { criterionIds: [], workItemIds: [item.id] } }));
      await h.db.$transaction(tx => consumeOutcomeInboxEvent(tx, review.sequence));
      await h.db.$transaction(tx => consumeOutcomeInboxEvent(tx, review.sequence));
      expect(await h.db.channelNotification.count({ where: { key: { startsWith: `review.required:${h.outcome.id}:1:` } } })).toBe(1);
      const human = await h.db.outcomeWorkItem.create({ data: { outcomeId: h.outcome.id, contractRevisionId: h.revision.id, botId: h.bot.id, executorType: "human", kind: "human_action", title: "Private manual action", status: "ready", ordinal: 2, humanActionCard: { create: { purpose: "SENSITIVE", steps: [], evidenceRequirements: [], requestedByWorkItemId: item.id } } } });
      const action = await h.db.$transaction(tx => appendOutcomeEvent(tx, "outcome.human_action.required", h.outcome.id, { actor, contractRevision: 1, payload: { workItemId: human.id, cardId: human.id, requestedByWorkItemId: item.id, decisionId: null } }));
      await h.db.$transaction(tx => consumeOutcomeInboxEvent(tx, action.sequence));
      const before = await h.db.$transaction(tx => unreadOutcomeNotifications(tx));
      expect(new Set(before.map(value => value.type))).toEqual(new Set(["outcome.review.required", "outcome.human_action.required"]));
      expect(JSON.stringify(before)).not.toContain("SENSITIVE"); expect(JSON.stringify(before)).not.toContain("Private");
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { status: "accepted", acceptedAt: new Date() } });
      const accepted = await h.db.$transaction(tx => appendOutcomeEvent(tx, "outcome.accepted", h.outcome.id, { actor, contractRevision: 1, payload: { revisionId: h.revision.id, reviewIds: [] } }));
      await h.db.$transaction(tx => consumeOutcomeInboxEvent(tx, accepted.sequence));
      const after = await h.db.$transaction(tx => unreadOutcomeNotifications(tx));
      expect(after.map(value => value.type)).toEqual(["outcome.accepted"]);
      expect(await h.db.idempotencyRecord.count({ where: { scope: "outcome-event:inbox", key: { in: [review, action, accepted].map(event => (event.payload as { eventId: string }).eventId) } } })).toBe(3);
    } finally { await h.cleanup(); }
  });
  test("permanent non-decision facts recover after Events are pruned without duplicating intents", async () => {
    const h = await outcomeThreadFixture();
    try {
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { status: "review_pending" } });
      await h.db.event.deleteMany({ where: { entityId: h.outcome.id } });
      await reconcileOutcomeInboxNotifications(h.db); await reconcileOutcomeInboxNotifications(h.db);
      expect(await h.db.channelNotification.count({ where: { key: { startsWith: `review.required:${h.outcome.id}:1:` } } })).toBe(1);
      await h.db.notificationPreferences.upsert({ where: { id: "global" }, create: { id: "global", smartEnabled: false }, update: { smartEnabled: false } });
      expect(await h.db.$transaction(tx => unreadOutcomeNotifications(tx))).toEqual([]);
      await h.db.notificationPreferences.delete({ where: { id: "global" } });
      const payload = (await h.db.$transaction(tx => unreadOutcomeNotifications(tx))).find(value => value.outcomeId === h.outcome.id)!;
      expect(payload.factKey).toMatch(new RegExp(`^review.required:${h.outcome.id}:1:[a-f0-9]{32}$`));
      await h.db.channelReadState.create({ data: { channelId: h.channel.id, lastReadNotificationSequence: BigInt(payload.notificationSequence) } });
      expect((await h.db.$transaction(tx => unreadOutcomeNotifications(tx))).filter(value => value.outcomeId === h.outcome.id)).toEqual([]);
    } finally { await h.cleanup(); }
  });
  test("closed Decisions revoke pending activity and obsolete revisions are not sendable", async () => {
    const h = await outcomeThreadFixture();
    try {
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { status: "review_pending" } });
      await reconcileOutcomeInboxNotifications(h.db);
      const payload = (await h.db.$transaction(tx => unreadOutcomeNotifications(tx))).find(value => value.outcomeId === h.outcome.id)!;
      expect(await h.db.$transaction(tx => outcomeNotificationIsCurrent(tx, payload))).toBe(true);
      const item = await h.item();
      const decision = await h.db.outcomeDecision.create({ data: { outcomeId: h.outcome.id, contractRevisionId: h.revision.id, workItemId: item.id, status: "withdrawn", reasonCode: "missing_input", options: [], idempotencyKey: crypto.randomUUID(), completedSummary: "Ready", problemSummary: "No issue", nextStepSummary: "Continue" } });
      await h.db.channelNotification.create({ data: { key: `decision.required:${decision.id}`, channelId: h.channel.id, botId: h.bot.id, kind: "outcome", payload: {} } });
      const closed = await h.db.$transaction(tx => appendOutcomeEvent(tx, "outcome.decision.closed", h.outcome.id, { actor, contractRevision: 1, payload: { decisionId: decision.id, reason: "withdrawn" } }));
      await h.db.$transaction(tx => consumeOutcomeInboxEvent(tx, closed.sequence));
      expect((await h.db.channelNotification.findUniqueOrThrow({ where: { key: `decision.required:${decision.id}` } })).revoked).toBe(true);
      const revision = await h.db.outcomeContractRevision.create({ data: { outcomeId: h.outcome.id, revision: 2, status: "pending_approval", goal: [], boundaries: {}, executionBotId: h.bot.id, contentHash: "changed", createdBy: actor } });
      await h.db.outcome.update({ where: { id: h.outcome.id }, data: { currentRevisionId: revision.id } });
      expect(await h.db.$transaction(tx => outcomeNotificationIsCurrent(tx, payload))).toBe(false);
    } finally { await h.cleanup(); }
  });
});
