import { describe, expect, test } from "bun:test";
import { MISSED_SCHEDULE_CONFIRMED_REASON } from "@outcomego/contracts/outcome-inbox";
import { dispatchDueScheduledWorkItems, dispatchQueuedOutcomeWorkItems, enqueueOutcomeTurn, updateFeatureSettings } from "../src";
import { outcomeThreadFixture } from "./fixtures/outcome-thread";

// Specs/004.10 task 2.4: a task that is released later than its schedule by more than the grace time. An action
// is not run on its own; the owner chooses. A deliverable, or a task with no plan nature, starts as usual.
// Needs a disposable PostgreSQL database; skipped without OUTCOMEGO_TEST_DATABASE_URL.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const minutesAgo = (value: number) => new Date(Date.now() - value * 60_000);

type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;

/** Gives the fixture revision a plan so tasks can carry a nature, and returns helpers to add planned tasks. */
async function withPlan(h: Fixture) {
  const task = (key: string, nature: "action" | "deliverable") => ({
    key, title: key, instructions: "Do it", botId: h.bot.id, covers: [], nature,
  });
  // A few planned tasks of each nature; every task takes its own plan key, since a revision allows one task per key.
  const natures = ["action", "deliverable"] as const;
  const keys = natures.flatMap((nature) => [1, 2, 3].map((n) => ({ key: `${nature}-${n}`, nature })));
  await h.db.outcomeContractRevision.update({
    where: { id: h.revision.id },
    data: { plan: { tasks: keys.map(({ key, nature }) => task(key, nature)) } },
  });
  const used = { act: 0, del: 0 };
  const planned = async (kind: "act" | "del", ordinal: number, scheduledAt: Date | null) => {
    used[kind] += 1;
    const planKey = `${kind === "act" ? "action" : "deliverable"}-${used[kind]}`;
    return h.db.outcomeWorkItem.create({
      data: {
        outcomeId: h.outcome.id, contractRevisionId: h.revision.id, botId: h.bot.id, executorType: "agent",
        title: planKey, instructions: "Do it", status: "queued", ordinal, planKey, scheduledAt,
      },
    });
  };
  return { planned };
}
const start = (h: Fixture, workItemId: string) =>
  h.db.$transaction((tx) => enqueueOutcomeTurn(tx, h.messaging, { workItemId, content: "Execute", reason: "start", clientId: `start:${workItemId}` }));
const runs = (h: Fixture) => h.db.run.count({ where: { botId: h.bot.id } });
const decisions = (h: Fixture, workItemId: string) =>
  h.db.outcomeDecision.findMany({ where: { workItemId, reasonCode: "missed_schedule" }, orderBy: { createdAt: "asc" } });
const withGrace = async (h: Fixture, minutes: number, run: () => Promise<void>) => {
  await updateFeatureSettings(h.db, { taskPolicy: { "schedule.graceMinutes": minutes } });
  try {
    await run();
  } finally {
    await h.db.featureSettings.deleteMany({ where: { id: "global" } });
  }
};

describe.skipIf(!url)("missed schedule (specs/004.10 task 2.4)", () => {
  test("an action released after the grace time is not run: one decision is raised and the task stays queued", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 5, async () => {
        const item = await planned("act", 1, minutesAgo(30));
        expect(await start(h, item.id)).toEqual({ status: "queued_for_capacity" });
        expect(await runs(h)).toBe(0);
        const row = await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
        expect(row.status).toBe("queued");
        expect(row.statusReason).toBe("missed_schedule");
        expect(row.rootRunId).toBeNull();
        const raised = await decisions(h, item.id);
        expect(raised).toHaveLength(1);
        expect(raised[0]!.status).toBe("open");
        expect((raised[0]!.options as Array<{ id: string }>).map((option) => option.id).sort()).toEqual(["run_now", "wait_for_reschedule"]);
        expect(raised[0]!.customEntryAllowed).toBe(false);
        // The intent to start is kept, so choosing "run now" can release the original instructions.
        expect(await h.db.idempotencyRecord.count({ where: { scope: `outcome-turn:${item.id}`, status: "processing" } })).toBe(1);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("scanning again and again never raises a second decision or starts anything", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 5, async () => {
        const item = await planned("act", 1, minutesAgo(30));
        await start(h, item.id);
        for (let pass = 0; pass < 3; pass += 1) {
          await dispatchDueScheduledWorkItems(h.db, h.messaging);
          await h.db.$transaction((tx) => dispatchQueuedOutcomeWorkItems(tx, h.messaging, h.bot.id));
        }
        expect(await decisions(h, item.id)).toHaveLength(1);
        expect(await runs(h)).toBe(0);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("a deliverable that is just as late starts as usual, with no decision", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 5, async () => {
        const item = await planned("del", 1, minutesAgo(30));
        expect((await start(h, item.id)).status).toBe("enqueued");
        expect(await decisions(h, item.id)).toHaveLength(0);
        expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } })).statusReason).not.toBe("missed_schedule");
      });
    } finally {
      await h.cleanup();
    }
  });

  test("a task with no plan nature (no plan to read it from) starts as usual", async () => {
    const h = await outcomeThreadFixture();
    try {
      await withGrace(h, 5, async () => {
        const item = await h.item(1);
        await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { scheduledAt: minutesAgo(30) } });
        expect((await start(h, item.id)).status).toBe("enqueued");
        expect(await decisions(h, item.id)).toHaveLength(0);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("an action released within the grace time starts as usual", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 10, async () => {
        const item = await planned("act", 1, minutesAgo(4));
        expect((await start(h, item.id)).status).toBe("enqueued");
        expect(await decisions(h, item.id)).toHaveLength(0);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("the grace time comes from the owner's policy: the same delay is fine under one setting and a decision under another", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      const first = await planned("act", 1, minutesAgo(20));
      const second = await planned("act", 2, minutesAgo(20));
      await withGrace(h, 60, async () => {
        expect((await start(h, first.id)).status).toBe("enqueued");
      });
      await withGrace(h, 10, async () => {
        expect(await start(h, second.id)).toEqual({ status: "queued_for_capacity" });
        expect(await decisions(h, second.id)).toHaveLength(1);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("a task still waiting on a dependency raises nothing: it is not being released yet", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 5, async () => {
        const upstream = await planned("del", 1, null);
        const late = await planned("act", 2, minutesAgo(30));
        await h.db.outcomeWorkItem.update({ where: { id: late.id }, data: { dependsOn: [upstream.id] } });
        expect(await start(h, late.id)).toEqual({ status: "queued_for_capacity" });
        expect(await decisions(h, late.id)).toHaveLength(0);
        expect((await h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: late.id } })).statusReason).not.toBe("missed_schedule");
      });
    } finally {
      await h.cleanup();
    }
  });

  test("a cancelled goal raises no decision for its late action", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 5, async () => {
        const item = await planned("act", 1, minutesAgo(30));
        await h.db.outcome.update({ where: { id: h.outcome.id }, data: { cancelledAt: new Date(), status: "cancelled" } });
        await dispatchDueScheduledWorkItems(h.db, h.messaging);
        expect(await decisions(h, item.id)).toHaveLength(0);
        expect(await runs(h)).toBe(0);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("a resumed or retried task is never judged against its old schedule", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 5, async () => {
        const item = await planned("act", 1, minutesAgo(600));
        const resumed = await h.db.$transaction((tx) =>
          enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Continue", reason: "decision_resolved", clientId: `resume:${item.id}` })
        );
        expect(resumed.status).toBe("enqueued");
        expect(await decisions(h, item.id)).toHaveLength(0);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("after the owner chose to run it, the task starts without being asked again, even with no grace time at all", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 0, async () => {
        const item = await planned("act", 1, minutesAgo(1));
        await h.db.outcomeWorkItem.update({ where: { id: item.id }, data: { statusReason: MISSED_SCHEDULE_CONFIRMED_REASON } });
        expect((await start(h, item.id)).status).toBe("enqueued");
        expect(await decisions(h, item.id)).toHaveLength(0);
      });
    } finally {
      await h.cleanup();
    }
  });

  test("the decision is an ordinary open inbox decision for the right goal and task, with a recorded event", async () => {
    const h = await outcomeThreadFixture();
    try {
      const { planned } = await withPlan(h);
      await withGrace(h, 5, async () => {
        const item = await planned("act", 1, minutesAgo(30));
        await start(h, item.id);
        const [raised] = await decisions(h, item.id);
        expect(raised).toMatchObject({ outcomeId: h.outcome.id, contractRevisionId: h.revision.id, workItemId: item.id });
        expect(raised!.idempotencyKey).toMatch(/^decision-request:/);
        expect(await h.db.event.count({ where: { topic: "outcome.decision.required", entityId: h.outcome.id } })).toBe(1);
      });
    } finally {
      await h.cleanup();
    }
  });
});
