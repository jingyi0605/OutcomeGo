import { describe, expect, test } from "bun:test";
import { settleOutcomeThreadTurn, startOutcomeThreadTurn, type ToolContext } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeThreadService } from "../src/services/outcome-thread-service";
import { OutcomeThreadTools } from "../src/services/outcome-thread-tools";

type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;
async function withPlanner(run: (fixture: Fixture, threads: OutcomeThreadService) => Promise<void>) {
  const fixture = await outcomeThreadFixture();
  const { db, messaging } = fixture;
  const previous = await db.featureSettings.findUnique({ where: { id: "global" } });
  try {
    await db.featureSettings.upsert({ where: { id: "global" }, create: { id: "global", outcomesEnabled: true }, update: { outcomesEnabled: true } });
    await run(fixture, new OutcomeThreadService(db, messaging));
  } finally {
    if (previous) await db.featureSettings.update({ where: { id: "global" }, data: { outcomesEnabled: previous.outcomesEnabled } });
    else await db.featureSettings.deleteMany({ where: { id: "global" } });
    await fixture.cleanup();
  }
}

describe.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)("unified Outcome Plan", () => {
  test("defaults all six kinds and deduplicates concurrent triggers per revision and mode", async () => {
    await withPlanner(async ({ db, outcome }, threads) => {
      const variants = [["standard", "draft"], ["tracked", "running"], ["scheduled_once", "scheduled"],
        ["todo", "open"], ["explore_idea", "active"], ["note", "active"]] as const;
      for (const [kind, status] of variants) {
        const { revision } = await db.outcome.update({ where: { id: outcome.id }, data: {
          kind, status, revision: { increment: 1 }, currentRevisionId: null,
        } });
        const request = { expectedRevision: revision, clientRequestId: `plan:${kind}` };
        const [first, other] = await Promise.all([
          threads.plan(outcome.id, request, "owner:local"),
          threads.plan(outcome.id, { ...request, clientRequestId: `parallel:${kind}` }, "owner:local"),
        ]);
        expect(first.id).toBe(other.id);
        expect(first).toMatchObject({ status: "queued", outcomeRevision: revision, planMode: kind === "standard" ? "contract_plan" : "advice" });
        await db.$transaction(async (tx) => {
          await tx.run.update({ where: { id: first.runId! }, data: { status: "completed" } });
          await settleOutcomeThreadTurn(tx, first.runId!);
        });
        expect((await threads.list(outcome.id)).turns.find((turn) => turn.id === first.id)?.status).toBe("completed");
        expect((await threads.plan(outcome.id, request, "owner:local")).id).toBe(first.id);
      }
      expect((await threads.list(outcome.id)).turns).toHaveLength(6);
    });
  });

  test("persists structured advice, forwards attachments, and falls back to final text on follow-up", async () => {
    await withPlanner(async ({ db, bot, outcome, channel, messaging }, threads) => {
      const attachment = await messaging.assets.ingestBytes({ fileName: "archive.txt", bytes: new TextEncoder().encode("Inventory") });
      await db.outcome.update({ where: { id: outcome.id }, data: { attachments: [attachment] } });
      const first = await threads.plan(outcome.id, { mode: "advice", clientRequestId: "first" }, "owner:local");
      const queued = await db.inboxEvent.findFirstOrThrow({ where: { runId: first.runId! } });
      expect(queued.payload).toMatchObject({ attachments: [attachment] });
      await db.$transaction(async (tx) => {
        await tx.run.update({ where: { id: first.runId! }, data: { status: "running" } });
        await startOutcomeThreadTurn(tx, first.runId!);
      });
      const tools = new OutcomeThreadTools(db, {} as never);
      const context: ToolContext = {
        runId: first.runId!, botId: bot.id, channelId: channel.id, conversationId: bot.conversation!.id,
        callId: "advice", isFork: false, replyToMessageId: null, deliveryId: null, origin: "outcome_thread",
      };
      const fields = { summary: "Checked the archive", facts: [{ statement: "Archive exists", source: "archive.txt" }], gaps: [], recommendations: [] };
      const request = {
        ...context, tool: "SavePlanAdvice", arguments: { ...fields, clientRequestId: "save-advice" },
      };
      expect(await tools.execute(request, context)).toEqual({ schemaVersion: 1, ...fields });
      await expect(tools.execute({ ...request, tool: "SaveOutcomeContract" }, context)).rejects.toMatchObject({ code: "outcome_thread_tool_forbidden" });
      await db.$transaction(async (tx) => {
        await tx.run.update({ where: { id: first.runId! }, data: { status: "completed" } });
        await settleOutcomeThreadTurn(tx, first.runId!);
      });
      expect(await tools.execute(request, context)).toEqual({ schemaVersion: 1, ...fields });
      const followUp = await threads.send(outcome.id, { mode: "advice", text: "What remains unverified?", clientRequestId: "follow-up" }, "owner:local");
      expect(followUp).toMatchObject({ purpose: "owner_message", planMode: "advice", trigger: "What remains unverified?" });
      expect(followUp.id).not.toBe(first.id);
      await db.$transaction(async (tx) => {
        await tx.event.create({ data: { topic: "run_item.completed", entityId: followUp.runId!, payload: { item: { type: "agentMessage", text: "Retention is unknown" } } } });
        await tx.run.update({ where: { id: followUp.runId! }, data: { status: "completed" } });
        await settleOutcomeThreadTurn(tx, followUp.runId!);
      });
      expect((await threads.list(outcome.id)).turns).toEqual([
        expect.objectContaining({ id: first.id, result: { schemaVersion: 1, ...fields } }),
        expect.objectContaining({ id: followUp.id, result: { schemaVersion: 1, summary: "Retention is unknown", facts: [], gaps: [], recommendations: [] } }),
      ]);
    });
  });

  test("missing classification marks only triage failed and leaves the source data available", async () => {
    await withPlanner(async ({ db, outcome }, threads) => {
      await db.outcome.update({ where: { id: outcome.id }, data: {
        kind: "note", status: "active", description: "Original intake text", currentRevisionId: null,
        kindMeta: { createdVia: "owner_go_inbox", syncToMemory: true, memorySummary: "Original memory" },
      } });
      const turn = await threads.plan(outcome.id, { mode: "triage", clientRequestId: "triage" }, "owner:local");
      await db.$transaction(async (tx) => {
        await tx.run.update({ where: { id: turn.runId! }, data: { status: "completed" } });
        await settleOutcomeThreadTurn(tx, turn.runId!);
      });
      expect(await db.outcome.findUniqueOrThrow({ where: { id: outcome.id } })).toMatchObject({
        kind: "note", status: "active", description: "Original intake text", kindMeta: {
          triageStatus: "failed", triageError: "classification_not_saved", memorySummary: "Original memory",
        },
      });
      expect((await threads.list(outcome.id)).turns[0]).toMatchObject({ status: "failed", error: { code: "classification_not_saved" } });
      expect((await threads.plan(outcome.id, { mode: "triage", clientRequestId: "retry" }, "owner:local")).id).not.toBe(turn.id);
    });
  });
});
