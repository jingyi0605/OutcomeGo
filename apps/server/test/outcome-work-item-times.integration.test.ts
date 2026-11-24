import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { RUN_SEGMENT_LIMIT, type OutcomeDetail } from "@outcomego/contracts/outcomes";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { OutcomeService } from "../src/services/outcome-service";

// Specs/004.10 task 1.1: actual start/end times and run segments come from task and run rows.
// Needs a disposable PostgreSQL database; skipped without OUTCOMEGO_TEST_DATABASE_URL.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 0, minute, 0));

async function setup() {
  const h = await outcomeThreadFixture();
  cleanups.push(() => h.cleanup());
  const service = new OutcomeService(h.db);
  const detail = (): Promise<OutcomeDetail> => Effect.runPromise(service.get(h.outcome.id));
  /** A run owned by one work item, created directly so its start and end are exact. */
  const addRun = async (
    workItemId: string,
    input: { startedAt: Date | null; completedAt: Date | null; status: "queued" | "running" | "completed" | "failed" }
  ) => {
    const messageId = crypto.randomUUID();
    await h.db.message.create({
      data: { id: messageId, botId: h.bot.id, conversationId: h.bot.conversation!.id, clientId: `times:${messageId}`, role: "user", content: "fixture", status: "completed" },
    });
    return h.db.run.create({
      data: {
        botId: h.bot.id,
        conversationId: h.bot.conversation!.id,
        userMessageId: messageId,
        channelId: h.channel.id,
        origin: "outcome",
        outcomeWorkItemId: workItemId,
        status: input.status,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      },
    });
  };
  return { h, detail, addRun };
}

// Specs/004.10 task 2.1: the schedule columns and the goal deadline are readable from the detail.
describe.skipIf(!url)("schedule columns in the Outcome detail (specs/004.10 task 2.1)", () => {
  test("a task with no schedule reports empty schedule fields and a zero defer count", async () => {
    const { h, detail } = await setup();
    const item = await h.item(1);
    const view = (await detail()).workItems.find((entry) => entry.id === item.id)!;
    expect(view.scheduledAt).toBeNull();
    expect(view.dueAt).toBeNull();
    expect(view.estimateMinutes).toBeNull();
    expect(view.deferCount).toBe(0);
    expect((await detail()).dueAt).toBeNull();
  });

  test("stored schedule values are returned as ISO strings", async () => {
    const { h, detail } = await setup();
    const item = await h.item(1);
    await h.db.outcomeWorkItem.update({
      where: { id: item.id },
      data: { scheduledAt: at(60), dueAt: at(120), estimateMinutes: 45, deferCount: 2 },
    });
    await h.db.outcome.update({ where: { id: h.outcome.id }, data: { dueAt: at(240) } });
    const result = await detail();
    const view = result.workItems.find((entry) => entry.id === item.id)!;
    expect(view.scheduledAt).toBe(at(60).toISOString());
    expect(view.dueAt).toBe(at(120).toISOString());
    expect(view.estimateMinutes).toBe(45);
    expect(view.deferCount).toBe(2);
    expect(result.dueAt).toBe(at(240).toISOString());
  });
});

describe.skipIf(!url)("work item times in the Outcome detail (specs/004.10 task 1.1)", () => {
  test("a task that never ran has no start, end or segments and does not borrow its creation time", async () => {
    const { h, detail } = await setup();
    const item = await h.item(1);
    const view = (await detail()).workItems.find((entry) => entry.id === item.id)!;
    expect(view.startedAt).toBeNull();
    expect(view.completedAt).toBeNull();
    expect(view.runSegments).toEqual([]);
  });

  test("a queued run that has not started is not a segment", async () => {
    const { h, detail, addRun } = await setup();
    const item = await h.item(1);
    await addRun(item.id, { startedAt: null, completedAt: null, status: "queued" });
    const view = (await detail()).workItems.find((entry) => entry.id === item.id)!;
    expect(view.runSegments).toEqual([]);
    expect(view.runIds).toHaveLength(1);
  });

  test("a re-released task keeps its earlier segments and its first start time", async () => {
    const { h, detail, addRun } = await setup();
    const item = await h.item(1);
    await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { startedAt: at(0), status: "running" } });
    const first = await addRun(item.id, { startedAt: at(0), completedAt: at(10), status: "completed" });
    const second = await addRun(item.id, { startedAt: at(50), completedAt: null, status: "running" });
    const view = (await detail()).workItems.find((entry) => entry.id === item.id)!;
    expect(view.startedAt).toBe(at(0).toISOString());
    expect(view.runSegments!.map((segment) => segment.id)).toEqual([first.id, second.id]);
    expect(view.runSegments![0]!.completedAt).toBe(at(10).toISOString());
    expect(view.runSegments![1]!.completedAt).toBeNull();
  });

  test("only the most recent segments are returned, oldest first", async () => {
    const { h, detail, addRun } = await setup();
    const item = await h.item(1);
    for (let index = 0; index < RUN_SEGMENT_LIMIT + 3; index += 1)
      await addRun(item.id, { startedAt: at(index), completedAt: at(index), status: "completed" });
    const view = (await detail()).workItems.find((entry) => entry.id === item.id)!;
    expect(view.runSegments).toHaveLength(RUN_SEGMENT_LIMIT);
    expect(view.runSegments![0]!.startedAt).toBe(at(3).toISOString());
    expect(view.runIds).toHaveLength(RUN_SEGMENT_LIMIT + 3);
  });

  test("times survive the removal of every outcome event", async () => {
    const { h, detail, addRun } = await setup();
    const item = await h.item(1);
    await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { startedAt: at(0), completedAt: at(10), status: "completed" } });
    await addRun(item.id, { startedAt: at(0), completedAt: at(10), status: "completed" });
    await h.db.event.deleteMany({ where: { entityId: h.outcome.id } });
    const view = (await detail()).workItems.find((entry) => entry.id === item.id)!;
    expect(view.startedAt).toBe(at(0).toISOString());
    expect(view.completedAt).toBe(at(10).toISOString());
    expect(view.runSegments).toHaveLength(1);
  });
});
