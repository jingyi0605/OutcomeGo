import { describe, expect, test } from "bun:test";
import {
  dispatchDueScheduledWorkItems,
  enqueueOutcomeTurn,
  recoverOutcomeWorkItem,
  settleOutcomeWorkItem,
  transitionWorkItem,
} from "../src";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";

// Specs/004.10 task 2.5: a task deferred by its agent goes back to queued with a future time. Settling the turn
// that deferred it must not mistake it for a finished task. Needs a disposable PostgreSQL database.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const actor = "system:fixture" as const;
const minutes = (value: number) => new Date(Date.now() + value * 60_000);

type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;

/**
 * An item the agent has just deferred: queued, waiting for a future time, with the turn that deferred it finished
 * and its resume intent held. Built through the real transitions, not by writing the final state directly.
 */
async function deferredItem(h: Fixture, resumeInMinutes = 60) {
  const item = await h.item(1);
  const first = await h.db.$transaction((tx) =>
    enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` })
  );
  const runId = (first as { runId: string }).runId;
  await h.db.$transaction((tx) => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
  await h.db.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });
  await h.db.$transaction(async (tx) => {
    await tx.outcomeWorkItem.update({ where: { id: item.id }, data: { scheduledAt: minutes(resumeInMinutes), deferCount: { increment: 1 } } });
    await transitionWorkItem(tx, { workItemId: item.id, to: "queued", reason: "deferred_by_agent", actor });
    await enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Continue from step three.", reason: "resume_scheduled", clientId: `defer:${item.id}:1` });
  });
  return { item, runId };
}
const finish = async (h: Fixture, runId: string) => {
  await h.db.run.update({ where: { id: runId }, data: { status: "completed", completedAt: new Date() } });
  await h.db.event.create({ data: { topic: "run_item.completed", entityId: runId, payload: { item: { type: "agentMessage", text: "Stopped here for now." } } } });
};
const row = (h: Fixture, id: string) => h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id } });

describe.skipIf(!url)("deferring a running task (specs/004.10 task 2.5)", () => {
  test("settling the turn that deferred a task leaves it queued: not completed, failed or in review, and records no result", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await deferredItem(h);
      await finish(h, runId);
      await h.db.$transaction((tx) => settleOutcomeWorkItem(tx, runId, h.runtime));
      const after = await row(h, item.id);
      expect(after.status).toBe("queued");
      expect(after.statusReason).toBe("deferred_by_agent");
      expect(after.completedAt).toBeNull();
      expect(await h.db.outcomeOutput.count({ where: { workItemId: item.id } })).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("settling again, or settling after a restart, changes nothing", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await deferredItem(h);
      await finish(h, runId);
      for (let pass = 0; pass < 3; pass += 1) await h.db.$transaction((tx) => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect((await row(h, item.id)).status).toBe("queued");
    } finally {
      await h.cleanup();
    }
  });

  test("without the deferral a finished turn is still settled as before (the guard is what holds it)", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      const first = await h.db.$transaction((tx) =>
        enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` })
      );
      const runId = (first as { runId: string }).runId;
      await h.db.$transaction((tx) => transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "claimed", actor }));
      await finish(h, runId);
      await h.db.$transaction((tx) => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect((await row(h, item.id)).status).toBe("completed");
    } finally {
      await h.cleanup();
    }
  });

  test("a queued task that was not deferred, whose run already finished before it was claimed, is still settled", async () => {
    const h = await outcomeThreadFixture();
    try {
      const item = await h.item(1);
      const first = await h.db.$transaction((tx) =>
        enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `start:${item.id}` })
      );
      const runId = (first as { runId: string }).runId;
      // The item was never moved to running, but its run finished: settlement catches the record up.
      expect((await row(h, item.id)).status).toBe("queued");
      await finish(h, runId);
      await h.db.$transaction((tx) => settleOutcomeWorkItem(tx, runId, h.runtime));
      expect((await row(h, item.id)).status).toBe("completed");
    } finally {
      await h.cleanup();
    }
  });

  test("once its time comes it starts again exactly once, with the note as its instructions, as another run of the same task", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await deferredItem(h);
      await finish(h, runId);
      await h.db.$transaction((tx) => settleOutcomeWorkItem(tx, runId, h.runtime));
      await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { scheduledAt: minutes(-1) } });
      for (let pass = 0; pass < 3; pass += 1) await dispatchDueScheduledWorkItems(h.db, h.messaging);
      const runs = await h.db.run.findMany({ where: { outcomeWorkItemId: item.id }, orderBy: { createdAt: "asc" }, include: { inboxEvents: true } });
      expect(runs).toHaveLength(2);
      expect(JSON.stringify(runs[1]!.inboxEvents[0]!.payload)).toContain("Continue from step three.");
      // The first run is kept: the gap between the two is not run time.
      expect(runs[0]!.id).toBe(runId);
    } finally {
      await h.cleanup();
    }
  });

  test("a deferred action is resumed on time even long after its original schedule: a resume is not a late start", async () => {
    const h = await outcomeThreadFixture();
    try {
      await h.db.outcomeContractRevision.update({
        where: { id: h.revision.id },
        data: { plan: { tasks: [{ key: "act", title: "act", instructions: "Do it", botId: h.bot.id, covers: [], nature: "action" }] } },
      });
      const { item, runId } = await deferredItem(h);
      await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { planKey: "act" } });
      await finish(h, runId);
      await h.db.$transaction((tx) => settleOutcomeWorkItem(tx, runId, h.runtime));
      // Its resume time passed three hours ago (for example the system was down): resuming it is not asking again.
      await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { scheduledAt: new Date(Date.now() - 3 * 3_600_000) } });
      await dispatchDueScheduledWorkItems(h.db, h.messaging);
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(2);
      expect(await h.db.outcomeDecision.count({ where: { workItemId: item.id } })).toBe(0);
    } finally {
      await h.cleanup();
    }
  });

  test("recovery after a crash does not resume a deferred task early", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { item, runId } = await deferredItem(h);
      // The turn that deferred it was cut off before it could end.
      await h.db.run.update({ where: { id: runId }, data: { status: "interrupted", completedAt: new Date() } });
      await h.db.$transaction((tx) => recoverOutcomeWorkItem(tx, item.id, { messaging: h.messaging, workspaceRoot: h.root }));
      expect(await h.db.run.count({ where: { outcomeWorkItemId: item.id } })).toBe(1);
      const after = await row(h, item.id);
      expect(after.status).toBe("queued");
      expect(after.statusReason).toBe("deferred_by_agent");
      expect(after.recoveryCount).toBe(0);
    } finally {
      await h.cleanup();
    }
  });
});
