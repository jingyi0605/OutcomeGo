import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { readFeatureSettings, updateFeatureSettings } from "@outcomego/messaging";
import { TASK_POLICY_FIELDS, resolveTaskPolicy } from "@outcomego/contracts/task-policy";

// Specs/004.10 task 2.1: the owner policy is stored flat in one JSON column, merged by key in a single
// statement, and read back through the same settings channel. Needs a disposable PostgreSQL database.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const initial = (key: string) => TASK_POLICY_FIELDS.find((entry) => entry.key === key)!.initial;
const range = (key: string) => TASK_POLICY_FIELDS.find((entry) => entry.key === key)! as { min: number; max: number };

describe.skipIf(!url)("task policy through the settings channel", () => {
  let db!: ReturnType<typeof createPrismaClient>;
  beforeAll(async () => {
    db = createPrismaClient(url!);
    await db.$connect();
  });
  afterAll(async () => {
    await db.featureSettings.deleteMany({ where: { id: "global" } });
    await db.$disconnect();
  });
  beforeEach(async () => {
    await db.featureSettings.deleteMany({ where: { id: "global" } });
  });

  test("with nothing stored the view has no overrides and resolving gives the initial values", async () => {
    const view = await readFeatureSettings(db);
    expect(view.taskPolicy ?? {}).toEqual({});
    expect(resolveTaskPolicy(view.taskPolicy)["schedule.graceMinutes"]).toBe(initial("schedule.graceMinutes") as number);
  });

  test("an update stores only the keys that were sent, and the view returns the raw overrides", async () => {
    const grace = range("schedule.graceMinutes").max;
    const view = await updateFeatureSettings(db, { taskPolicy: { "schedule.graceMinutes": grace } });
    expect(view.taskPolicy).toEqual({ "schedule.graceMinutes": grace });
    expect((await readFeatureSettings(db)).taskPolicy).toEqual({ "schedule.graceMinutes": grace });
  });

  test("a later update merges by key and leaves the other keys alone", async () => {
    await updateFeatureSettings(db, { taskPolicy: { "schedule.graceMinutes": 7 } });
    const view = await updateFeatureSettings(db, { taskPolicy: { "schedule.deferMaxCount": 3 } });
    expect(view.taskPolicy).toEqual({ "schedule.graceMinutes": 7, "schedule.deferMaxCount": 3 });
  });

  test("null restores the initial value by removing that override", async () => {
    await updateFeatureSettings(db, { taskPolicy: { "schedule.graceMinutes": 7, "schedule.deferMaxCount": 3 } });
    const view = await updateFeatureSettings(db, { taskPolicy: { "schedule.graceMinutes": null } });
    expect(view.taskPolicy).toEqual({ "schedule.deferMaxCount": 3 });
    expect(resolveTaskPolicy(view.taskPolicy)["schedule.graceMinutes"]).toBe(initial("schedule.graceMinutes") as number);
  });

  test("other settings are untouched by a policy update, and a policy update does not need other settings", async () => {
    await updateFeatureSettings(db, { outcomesEnabled: true, environmentNote: "keep me" });
    const view = await updateFeatureSettings(db, { taskPolicy: { "schedule.graceMinutes": 7 } });
    expect(view.outcomesEnabled).toBe(true);
    expect(view.environmentNote).toBe("keep me");
    const after = await updateFeatureSettings(db, { streamBotReplies: true });
    expect(after.taskPolicy).toEqual({ "schedule.graceMinutes": 7 });
  });

  test("the first write creates the settings row when none exists", async () => {
    expect(await db.featureSettings.count({ where: { id: "global" } })).toBe(0);
    const view = await updateFeatureSettings(db, { taskPolicy: { "todo.highUrgencyNotify": true } });
    expect(view.taskPolicy).toEqual({ "todo.highUrgencyNotify": true });
    expect(view.outcomesEnabled).toBe(true);
  });

  test("two concurrent updates to different keys both survive", async () => {
    await updateFeatureSettings(db, { outcomesEnabled: true });
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        updateFeatureSettings(db, {
          taskPolicy: index % 2 === 0 ? { "schedule.graceMinutes": 10 + index } : { "schedule.deferMaxCount": 10 + index },
        })
      )
    );
    const stored = (await readFeatureSettings(db)).taskPolicy ?? {};
    expect(Object.keys(stored).sort()).toEqual(["schedule.deferMaxCount", "schedule.graceMinutes"]);
  });

  test("an invalid update is refused before anything is written", async () => {
    await updateFeatureSettings(db, { taskPolicy: { "schedule.graceMinutes": 7 } });
    await expect(
      updateFeatureSettings(db, { taskPolicy: { "schedule.graceMinutes": range("schedule.graceMinutes").max + 1 } })
    ).rejects.toMatchObject({ code: "invalid_task_policy" });
    expect((await readFeatureSettings(db)).taskPolicy).toEqual({ "schedule.graceMinutes": 7 });
  });
});
