import { afterAll, describe, expect, test } from "bun:test";
import { ApiError, type DynamicToolCallRequest } from "@outcomego/contracts";
import type { GroupTaskView } from "@outcomego/contracts/group-tasks";
import { createPrismaClient } from "@outcomego/db";
import { GroupTaskService, releaseGroupTasksForBots, type ToolContext } from "@outcomego/messaging";
import { GroupTaskTools } from "../src/services/group-task-tools";

// specs/010-群任务看板: needs a disposable database that already has the current schema.
const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL ?? process.env.OPENTEAM_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

const db = databaseUrl ? createPrismaClient(databaseUrl) : (undefined as never);
const channels: string[] = [];
const bots: string[] = [];
afterAll(async () => {
  if (!databaseUrl) return;
  await db.channel.deleteMany({ where: { id: { in: channels } } });
  await db.bot.deleteMany({ where: { id: { in: bots } } });
  await db.$disconnect();
});

async function fixture(memberCount = 3) {
  const stamp = crypto.randomUUID().slice(0, 8);
  const members = [];
  for (let index = 0; index < memberCount; index += 1) {
    const bot = await db.bot.create({
      data: { name: `Bot ${["A", "B", "C", "D"][index]} ${stamp}`, defaultDirectory: "/unused", status: "active" },
    });
    bots.push(bot.id);
    members.push(bot);
  }
  const outsider = await db.bot.create({ data: { name: `Outsider ${stamp}`, defaultDirectory: "/unused", status: "active" } });
  bots.push(outsider.id);
  const group = await db.channel.create({
    data: { kind: "group", name: `Board ${stamp}`, members: { create: members.map((bot, ordinal) => ({ botId: bot.id, ordinal })) } },
  });
  channels.push(group.id);
  const direct = await db.channel.create({ data: { kind: "bot_dm", name: "dm", directKey: `bot:${members[0]!.id}:${stamp}` } });
  channels.push(direct.id);
  const tasks = new GroupTaskService(db);
  const [a, b, c] = members as [typeof members[0], typeof members[0], typeof members[0]];
  return { tasks, group, direct, a, b, c, outsider, members };
}

const code = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
  throw new Error("expected a refusal");
};
const user = { kind: "user" } as const;

suite("group task board", () => {
  test("numbers tasks per group from 1 and refuses an unfinished duplicate, pointing at it", async () => {
    const { tasks, group, a, b } = await fixture();
    const first = await tasks.create(group.id, a.id, { title: "Research pricing" });
    expect(first.created).toBe(true);
    expect([first.task.number, first.task.status, first.task.revision, first.task.creator?.id]).toEqual([1, "open", 1, a.id]);
    const second = await tasks.create(group.id, b.id, { title: "Draft the email" });
    expect(second.task.number).toBe(2);

    try {
      await tasks.create(group.id, b.id, { title: "  research   PRICING " });
      throw new Error("expected duplicate");
    } catch (error) {
      expect((error as ApiError).code).toBe("group_task_duplicate");
      expect(((error as ApiError).details as { existing: GroupTaskView }).existing.number).toBe(1);
    }
    expect((await tasks.list(group.id, user)).tasks).toHaveLength(2);
  });

  test("a finished task no longer blocks the same title", async () => {
    const { tasks, group, a } = await fixture();
    const first = await tasks.create(group.id, a.id, { title: "Weekly report", assignTo: "me" });
    await tasks.update(group.id, { kind: "bot", botId: a.id }, first.task.number, { status: "done", note: "Sent" });
    const again = await tasks.create(group.id, a.id, { title: "Weekly report" });
    expect(again.task.number).toBe(2);
  });

  test("the same clientRequestId returns the first task instead of creating another", async () => {
    const { tasks, group, a } = await fixture();
    const first = await tasks.create(group.id, a.id, { title: "Once", clientRequestId: "retry-1" });
    const retry = await tasks.create(group.id, a.id, { title: "Once", clientRequestId: "retry-1" });
    expect([retry.created, retry.task.id]).toEqual([false, first.task.id]);
    expect((await tasks.list(group.id, user)).tasks).toHaveLength(1);
  });

  test("assignTo me claims in the same call; assignTo a name or id hands it to that member", async () => {
    const { tasks, group, a, b, c } = await fixture();
    const mine = await tasks.create(group.id, a.id, { title: "Mine", assignTo: "me" });
    expect([mine.task.status, mine.task.assignee?.id]).toEqual(["in_progress", a.id]);
    const byName = await tasks.create(group.id, a.id, { title: "For B", assignTo: b.name.toUpperCase() });
    expect([byName.task.status, byName.task.assignee?.id]).toEqual(["open", b.id]);
    const byId = await tasks.create(group.id, a.id, { title: "For C", assignTo: c.id });
    expect(byId.task.assignee?.id).toBe(c.id);
  });

  test("exactly one of many concurrent claims wins; the rest are told who owns it", async () => {
    const { tasks, group, a, b, c } = await fixture();
    const { task } = await tasks.create(group.id, a.id, { title: "Contested" });
    const results = await Promise.allSettled([a, b, c].map((bot) => tasks.claim(group.id, bot.id, task.number)));
    const winners = results.filter((result) => result.status === "fulfilled");
    const losers = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers.map((loser) => (loser.reason as ApiError).code)).toEqual(["group_task_claimed", "group_task_claimed"]);
    const winner = (winners[0] as PromiseFulfilledResult<GroupTaskView>).value;
    expect(winner.status).toBe("in_progress");
    expect(winner.revision).toBe(2);
    expect((losers[0]!.reason as ApiError).message).toContain(winner.assignee!.name);
    const stored = await tasks.list(group.id, user);
    expect(stored.tasks[0]!.assignee?.id).toBe(winner.assignee!.id);
  });

  test("a claim by the owner is idempotent and does not bump the revision", async () => {
    const { tasks, group, a } = await fixture();
    const { task } = await tasks.create(group.id, a.id, { title: "Mine", assignTo: "me" });
    const again = await tasks.claim(group.id, a.id, task.number);
    expect(again.revision).toBe(task.revision);
  });

  test("concurrent creates of the same title produce one task", async () => {
    const { tasks, group, a, b, c } = await fixture();
    const results = await Promise.allSettled([a, b, c].map((bot) => tasks.create(group.id, bot.id, { title: "Same job" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")
      .map((result) => ((result as PromiseRejectedResult).reason as ApiError).code)).toEqual(["group_task_duplicate", "group_task_duplicate"]);
  });

  test("concurrent creates of different titles get distinct consecutive numbers", async () => {
    const { tasks, group, a, b, c } = await fixture();
    const created = await Promise.all([a, b, c].map((bot, index) => tasks.create(group.id, bot.id, { title: `Job ${index}` })));
    expect(created.map((result) => result.task.number).sort()).toEqual([1, 2, 3]);
  });

  test("owner moves through the states; others are refused; finished tasks stay finished", async () => {
    const { tasks, group, a, b } = await fixture();
    const A = { kind: "bot", botId: a.id } as const;
    const B = { kind: "bot", botId: b.id } as const;
    const { task } = await tasks.create(group.id, a.id, { title: "Flow" });
    expect(await code(tasks.update(group.id, B, task.number, { title: "Hijack" }))).toBe("group_task_forbidden");
    await tasks.claim(group.id, a.id, task.number);
    expect(await code(tasks.update(group.id, B, task.number, { status: "done", note: "x" }))).toBe("group_task_forbidden");
    expect(await code(tasks.update(group.id, A, task.number, { status: "done" }))).toBe("invalid_request");
    const blocked = await tasks.update(group.id, A, task.number, { status: "blocked", note: "Waiting for credentials" });
    expect([blocked.status, blocked.note]).toEqual(["blocked", "Waiting for credentials"]);
    const resumed = await tasks.update(group.id, A, task.number, { status: "in_progress" });
    expect([resumed.status, resumed.note]).toEqual(["in_progress", null]);
    const done = await tasks.update(group.id, A, task.number, { status: "done", note: "Shipped" });
    expect([done.status, done.note, done.completedAt === null]).toEqual(["done", "Shipped", false]);
    expect(done.revision).toBe(5);
    expect(await code(tasks.update(group.id, A, task.number, { status: "in_progress" }))).toBe("group_task_closed");
    expect(await code(tasks.claim(group.id, b.id, task.number))).toBe("group_task_closed");
  });

  test("hand over, release and reclaim", async () => {
    const { tasks, group, a, b, c } = await fixture();
    const A = { kind: "bot", botId: a.id } as const;
    const { task } = await tasks.create(group.id, a.id, { title: "Pass it on", assignTo: "me" });
    const handed = await tasks.update(group.id, A, task.number, { assignTo: b.name });
    expect([handed.assignee?.id, handed.status]).toEqual([b.id, "open"]);
    expect(await code(tasks.claim(group.id, c.id, task.number))).toBe("group_task_claimed");
    const started = await tasks.claim(group.id, b.id, task.number);
    expect(started.status).toBe("in_progress");
    const released = await tasks.update(group.id, { kind: "bot", botId: b.id }, task.number, { assignTo: "none" });
    expect([released.assignee, released.status]).toEqual([null, "open"]);
    const taken = await tasks.claim(group.id, c.id, task.number);
    expect(taken.assignee?.id).toBe(c.id);
  });

  test("assigning to a non-member or an ambiguous name is refused", async () => {
    const { tasks, group, a, outsider } = await fixture();
    expect(await code(tasks.create(group.id, a.id, { title: "To outsider", assignTo: outsider.id }))).toBe("group_task_assignee_invalid");
    expect(await code(tasks.create(group.id, a.id, { title: "To nobody", assignTo: "Nobody Here" }))).toBe("group_task_assignee_invalid");
  });

  test("a stale expectedRevision changes nothing and returns the current task", async () => {
    const { tasks, group, a } = await fixture();
    const A = { kind: "bot", botId: a.id } as const;
    const { task } = await tasks.create(group.id, a.id, { title: "Versioned", assignTo: "me" });
    await tasks.update(group.id, A, task.number, { description: "More detail" });
    try {
      await tasks.update(group.id, A, task.number, { expectedRevision: task.revision, title: "Renamed" });
      throw new Error("expected conflict");
    } catch (error) {
      expect((error as ApiError).code).toBe("group_task_revision_conflict");
      expect(((error as ApiError).details as { task: GroupTaskView }).task.revision).toBe(2);
    }
    expect((await tasks.list(group.id, user)).tasks[0]!.title).toBe("Versioned");
  });

  test("subtasks: one level, independent owners, parent cannot finish early, cancel cascades", async () => {
    const { tasks, group, a, b } = await fixture();
    const A = { kind: "bot", botId: a.id } as const;
    const parent = (await tasks.create(group.id, a.id, { title: "Launch", assignTo: "me" })).task;
    const one = (await tasks.create(group.id, a.id, { title: "Copy", parent: parent.number, assignTo: b.id })).task;
    const two = (await tasks.create(group.id, a.id, { title: "Copy", parent: parent.number }).catch((error) => error)) as ApiError;
    expect(two.code).toBe("group_task_duplicate");
    const sibling = (await tasks.create(group.id, a.id, { title: "Design", parent: parent.number })).task;
    expect([one.parentNumber, sibling.parentNumber]).toEqual([parent.number, parent.number]);
    // The same title under another parent, or at top level, is allowed.
    expect((await tasks.create(group.id, a.id, { title: "Copy" })).task.parentNumber).toBeNull();

    expect(await code(tasks.create(group.id, a.id, { title: "Nested", parent: one.number }))).toBe("group_task_depth");
    expect(await code(tasks.update(group.id, A, parent.number, { status: "done", note: "all done" }))).toBe("group_task_subtasks_open");

    const cancelled = await tasks.update(group.id, A, parent.number, { status: "cancelled", note: "Dropped" });
    expect(cancelled.status).toBe("cancelled");
    const board = await tasks.list(group.id, user, { includeClosed: true });
    const children = board.tasks.filter((task) => task.parentNumber === parent.number);
    expect(children.map((task) => task.status)).toEqual(["cancelled", "cancelled"]);
    expect(await code(tasks.create(group.id, a.id, { title: "Late child", parent: parent.number }))).toBe("group_task_closed");
  });

  test("a parent can finish once its subtasks are finished", async () => {
    const { tasks, group, a } = await fixture();
    const A = { kind: "bot", botId: a.id } as const;
    const parent = (await tasks.create(group.id, a.id, { title: "Parent", assignTo: "me" })).task;
    const child = (await tasks.create(group.id, a.id, { title: "Child", parent: parent.number, assignTo: "me" })).task;
    await tasks.update(group.id, A, child.number, { status: "done", note: "ok" });
    const done = await tasks.update(group.id, A, parent.number, { status: "done", note: "all good" });
    expect(done.status).toBe("done");
  });

  test("only group members may use the board; a direct chat has none", async () => {
    const { tasks, group, direct, a, outsider } = await fixture();
    expect(await code(tasks.create(group.id, outsider.id, { title: "Sneak" }))).toBe("group_task_unavailable");
    expect(await code(tasks.list(group.id, { kind: "bot", botId: outsider.id }))).toBe("group_task_unavailable");
    expect(await code(tasks.create(direct.id, a.id, { title: "In a dm" }))).toBe("group_task_unavailable");
    expect(await code(tasks.list(direct.id, user))).toBe("channel_not_found");
  });

  test("a task number from another group is not reachable", async () => {
    const one = await fixture();
    const two = await fixture();
    const { task } = await one.tasks.create(one.group.id, one.a.id, { title: "Private to group one" });
    expect(await code(two.tasks.claim(two.group.id, two.a.id, task.number))).toBe("group_task_not_found");
  });

  test("the active task limit is enforced", async () => {
    const { tasks, group, a } = await fixture();
    await db.groupTask.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        channelId: group.id, number: index + 1, title: `T${index}`, titleKey: `t${index}`, creatorBotId: a.id,
      })),
    });
    expect(await code(tasks.create(group.id, a.id, { title: "One too many" }))).toBe("group_task_limit");
  });

  test("a member removed from the group releases its tasks; finished ones stay as they are", async () => {
    const { tasks, group, a, b } = await fixture();
    const B = { kind: "bot", botId: b.id } as const;
    const running = (await tasks.create(group.id, b.id, { title: "B's running", assignTo: "me" })).task;
    const finished = (await tasks.create(group.id, b.id, { title: "B's done", assignTo: "me" })).task;
    await tasks.update(group.id, B, finished.number, { status: "done", note: "ok" });
    const kept = (await tasks.create(group.id, a.id, { title: "A's", assignTo: "me" })).task;

    const released = await db.$transaction((tx) => releaseGroupTasksForBots(tx, [b.id], group.id));
    expect(released).toBe(1);
    const board = await tasks.list(group.id, user, { includeClosed: true });
    const byNumber = new Map(board.tasks.map((task) => [task.number, task]));
    expect([byNumber.get(running.number)!.assignee, byNumber.get(running.number)!.status]).toEqual([null, "open"]);
    expect(byNumber.get(running.number)!.revision).toBe(running.revision + 1);
    expect(byNumber.get(finished.number)!.assignee?.id).toBe(b.id);
    expect(byNumber.get(kept.number)!.assignee?.id).toBe(a.id);
  });

  test("the user can release or cancel any unfinished task, guarded by revision", async () => {
    const { tasks, group, a } = await fixture();
    const { task } = await tasks.create(group.id, a.id, { title: "Stuck", assignTo: "me" });
    expect(await code(tasks.userAct(group.id, task.number, { action: "release", expectedRevision: 99 }))).toBe("group_task_revision_conflict");
    const released = await tasks.userAct(group.id, task.number, { action: "release", expectedRevision: task.revision });
    expect([released.assignee, released.status]).toEqual([null, "open"]);
    const cancelled = await tasks.userAct(group.id, task.number, { action: "cancel", expectedRevision: released.revision });
    expect([cancelled.status, cancelled.note]).toEqual(["cancelled", "Cancelled by the user"]);
    expect(await code(tasks.userAct(group.id, task.number, { action: "cancel", expectedRevision: cancelled.revision }))).toBe("group_task_closed");
  });

  test("the board is deleted with its group", async () => {
    const { tasks, group, a } = await fixture();
    await tasks.create(group.id, a.id, { title: "Goes away" });
    await db.channel.delete({ where: { id: group.id } });
    expect(await db.groupTask.count({ where: { channelId: group.id } })).toBe(0);
  });

  test("the per-turn snapshot exists only for a member of a group and reflects the live board", async () => {
    const { tasks, group, direct, a, b, outsider } = await fixture();
    expect(await tasks.snapshotFor(a.id, direct.id)).toBeNull();
    expect(await tasks.snapshotFor(outsider.id, group.id)).toBeNull();
    const empty = await tasks.snapshotFor(a.id, group.id);
    expect(empty).toContain("No unfinished tasks.");
    await tasks.create(group.id, b.id, { title: "Look at pricing", assignTo: "me" });
    const seenByA = (await tasks.snapshotFor(a.id, group.id))!;
    expect(seenByA).toContain(`#1 [in_progress] Look at pricing — ${b.name}`);
    expect(seenByA).not.toContain("(you)");
    expect((await tasks.snapshotFor(b.id, group.id))!).toContain(`${b.name} (you)`);
  });

  test("the tool adapter is bound to the run's own group", async () => {
    const { tasks, group, direct, a, b } = await fixture();
    const tools = new GroupTaskTools(tasks);
    const context = (botId: string, channelId: string) =>
      ({ runId: crypto.randomUUID(), botId, conversationId: crypto.randomUUID(), channelId, deliveryId: null, origin: "user", callId: "c", replyToMessageId: null, isFork: false }) as ToolContext;
    const call = (botId: string, channelId: string, tool: string, args: unknown) =>
      tools.execute({ tool, arguments: args } as unknown as DynamicToolCallRequest, context(botId, channelId)) as Promise<any>;

    const created = await call(a.id, group.id, "CreateGroupTask", { title: "Via tool", assignTo: "me" });
    expect(created.task.number).toBe(1);
    expect(created.nextStep).toContain("claimed");
    const listed = await call(b.id, group.id, "ListGroupTasks", {});
    expect(listed.tasks.map((task: GroupTaskView) => task.title)).toEqual(["Via tool"]);
    expect(await code(call(b.id, group.id, "ClaimGroupTask", { task: 1 }))).toBe("group_task_claimed");
    const done = await call(a.id, group.id, "UpdateGroupTask", { task: 1, status: "done", note: "Finished it" });
    expect(done.task.status).toBe("done");

    expect(await code(call(a.id, direct.id, "ListGroupTasks", {}))).toBe("group_task_unavailable");
    // A channel id is not an argument: a bot cannot point the call at another group.
    expect(await code(call(a.id, group.id, "ListGroupTasks", { channelId: direct.id }))).toBe("invalid_request");
    expect(await code(call(a.id, group.id, "ClaimGroupTask", { task: "one" }))).toBe("invalid_request");
  });
});
