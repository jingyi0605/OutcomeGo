import { afterEach, describe, expect, test } from "bun:test";
import { ACTIVITY_LIST_LIMIT, ACTIVITY_TITLE_LIMIT } from "@outcomego/contracts/task-overview";
import { ensureRequestForTask, notifyRequestsNeedingOwner, settleRequestProgress, updateFeatureSettings } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { ActivityService } from "../src/services/activity-service";
import { ScheduleService } from "../src/services/schedule-service";

// Specs/004.10 task 4.1 (requirements A1, A2): the owner's list of unfinished requests across every bot, and the detail
// of one. Needs a disposable PostgreSQL database; skipped without OUTCOMEGO_TEST_DATABASE_URL. Fixtures are
// scenario-neutral placeholders, and each rule is checked on two bots with different wording and numbers.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
// Each test cleans up as soon as it ends: a fixture holds its own connection pool, and the owner's policy is one global
// row, so waiting until the end of the file would exhaust the database's connections and leak one test's policy into the next.
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const hours = (value: number) => new Date(Date.now() + value * 3_600_000);
const minutes = (value: number) => new Date(Date.now() + value * 60_000);

type Fixture = Awaited<ReturnType<typeof outcomeThreadFixture>>;
interface ProgressInput {
  state?: "working" | "waiting" | "blocked" | "complete";
  summary?: string;
  evidence?: string[];
  remaining?: string[];
  nextAction?: string;
  blockSource?: "user" | "policy" | "tool" | "runtime";
  toolError?: string;
  checkAt?: string;
}
interface RequestOptions extends ProgressInput {
  content?: string;
  origin?: "user" | "routine" | "outcome";
  reconciliations?: number;
  nextCheckAt?: Date | null;
  channelId?: string | null;
  stopped?: boolean;
  updatedAt?: Date;
  progress?: null;
}

async function setup() {
  const h = await outcomeThreadFixture();
  cleanups.push(async () => {
    await h.db.featureSettings.deleteMany({ where: { id: "global" } });
    await h.cleanup();
  });
  const service = new ActivityService(h.db);
  return { h, service };
}

let counter = 0;
/** A request as the runtime keeps it: the owner's message, and a run holding the bot's progress record. */
async function request(h: Fixture, options: RequestOptions = {}) {
  counter += 1;
  const message = await h.db.message.create({
    data: {
      botId: h.bot.id, conversationId: h.bot.conversation!.id, role: "user",
      content: options.content ?? `Request number ${counter}`, status: "completed",
    },
  });
  const state = options.state ?? "working";
  const progress =
    options.progress === null
      ? undefined
      : {
          key: `key-${counter}`, state, summary: options.summary ?? `Working on ${counter}`,
          evidence: options.evidence ?? ["EVIDENCE-SECRET-TEXT"], remaining: options.remaining ?? (state === "complete" ? [] : ["Finish it"]),
          ...(options.nextAction !== undefined ? { nextAction: options.nextAction } : state === "complete" ? {} : { nextAction: "Keep going" }),
          ...(options.blockSource ? { blockSource: options.blockSource } : {}),
          ...(options.toolError ? { toolError: options.toolError } : {}),
          ...(options.checkAt ? { checkAt: options.checkAt } : {}),
          runId: "ignored", revision: 3,
        };
  const run = await h.db.run.create({
    data: {
      botId: h.bot.id, conversationId: h.bot.conversation!.id, userMessageId: message.id, status: "completed",
      origin: options.origin ?? "user",
      ...(options.channelId !== undefined ? { channelId: options.channelId } : {}),
      ...(progress ? { requestProgress: progress } : {}),
      requestRevision: 3, requestReconciliations: options.reconciliations ?? 0,
      requestNextCheckAt: options.nextCheckAt ?? null,
      requestStoppedAt: options.stopped ? new Date() : null,
    },
  });
  if (options.updatedAt) await h.db.$executeRaw`UPDATE "outcomego_run" SET "updatedAt" = ${options.updatedAt} WHERE id = ${run.id}::uuid`;
  return run;
}
const ids = (response: { items: Array<{ id: string }> }) => response.items.map((item) => item.id).sort();

describe.skipIf(!url)("the owner's activity list (specs/004.10 task 4.1)", () => {
  test("owner-scopes Outcome-backed activity rows", async () => {
    const t = await setup();
    const ownerId = "activity-owner";
    await t.h.db.outcome.update({ where: { id: t.h.outcome.id }, data: { ownerId } });
    const own = await t.h.db.outcome.create({
      data: { ownerId, kind: "scheduled_once", title: "Owner schedule", botId: t.h.bot.id, status: "scheduled", scheduledAt: minutes(30) },
    });
    const foreign = await t.h.db.outcome.create({
      data: { ownerId: "other-owner", kind: "scheduled_once", title: "Foreign schedule", botId: t.h.bot.id, status: "scheduled", scheduledAt: minutes(45) },
    });

    const response = await t.service.list({ ownerId, botId: t.h.bot.id });

    expect(response.upcoming?.map((item) => item.id)).toEqual([`scheduled_once:${own.id}`]);
    expect(JSON.stringify(response)).not.toContain(foreign.title);
  });

  test("upcoming one-off execution links to its Outcome, not a Routine", async () => {
    const { h, service } = await setup();
    const scheduledAt = minutes(30);
    const outcome = await h.db.outcome.create({ data: {
      title: "One-off reminder", botId: h.bot.id, kind: "scheduled_once", status: "preparing", scheduledAt,
    } });
    const response = await service.list({ botId: h.bot.id });
    expect(response.upcoming).toEqual([expect.objectContaining({
      id: `scheduled_once:${outcome.id}`, type: "scheduled_once", title: "One-off reminder", state: "preparing",
      runAt: scheduledAt.toISOString(), link: { type: "outcome", id: outcome.id },
    })]);
  });

  for (const [name, summary, content] of [
    ["first bot", "Comparing the two options", "Please compare the two options and tell me which is cheaper"],
    ["second bot", "Collecting the numbers", "Gather the figures for the quarter and keep going until they add up"],
  ] as const) {
    test(`(${name}) an unfinished request shows with the start of the owner's message as its title and the bot's summary`, async () => {
      const t = await setup();
      const run = await request(t.h, { content, summary });
      const { items } = await t.service.list({});
      const item = items.find((entry) => entry.id === `request:${run.id}`)!;
      expect(item).toMatchObject({
        type: "request", botId: t.h.bot.id, title: content, doing: summary, state: "in_progress", needsOwner: false,
        nextCheckAt: null, link: { type: "conversation", id: t.h.bot.conversation!.id },
      });
    });
  }

  test("a request that has a channel links to that channel, which is what the owner opens to read it", async () => {
    const t = await setup();
    const run = await request(t.h);
    await t.h.db.run.update({ where: { id: run.id }, data: { channelId: t.h.channel.id } });
    const item = (await t.service.list({ botId: t.h.bot.id })).items.find((entry) => entry.id === `request:${run.id}`)!;
    expect(item.link).toEqual({ type: "channel", id: t.h.channel.id });
  });

  test("the delivery wrapper never names a request: the owner's chat message does, and a hidden wake names nothing", async () => {
    const t = await setup();
    const turn = (body: string) => `<timestamp>Friday, Nov 27, 2026, 9:10 AM (UTC+8)</timestamp>\n<user_query>\n${body}\n</user_query>`;
    /** A request whose message was sent in chat, as the channel keeps it. */
    const sent = async (content: string, metadata: object = {}) => {
      const run = await request(t.h, { content: turn(`[t5u]\n[In reply to t4s0: "Earlier answer"]\n${content}`) });
      const clientId = crypto.randomUUID();
      await t.h.db.message.update({ where: { id: run.userMessageId }, data: { clientId } });
      await t.h.db.run.update({ where: { id: run.id }, data: { channelId: t.h.channel.id } });
      await t.h.db.channelMessage.create({ data: { channelId: t.h.channel.id, clientId, sender: "user", content, metadata } });
      return run;
    };
    const typed = await sent("Check the figures again");
    const files = await sent("", { attachments: [{ fileName: "figures.csv" }, { fileName: "notes.md" }] });
    const unsent = await request(t.h, { content: turn("[t7u]\nSummarize the report") });
    const hidden = await request(t.h, { content: turn("[SAND_HIDDEN_PROMPT]The user submitted the form.") });

    const titles = new Map((await t.service.list({})).items.map((item) => [item.id, item.title]));
    expect(titles.get(`request:${typed.id}`)).toBe("Check the figures again");
    expect(titles.get(`request:${files.id}`)).toBe("figures.csv, notes.md");
    expect(titles.get(`request:${unsent.id}`)).toBe("Summarize the report");
    expect(titles.get(`request:${hidden.id}`)).toBe("");
    expect((await t.service.requestDetail(typed.id))?.title).toBe("Check the figures again");

    // The calendar follow-up reads the same title and names the to-do the request is linked to.
    const todo = await t.h.db.outcome.create({ data: { botId: t.h.bot.id, kind: "todo", status: "open", title: "Reconcile figures" } });
    const checkAt = hours(2);
    await t.h.db.run.update({ where: { id: typed.id }, data: { requestNextCheckAt: checkAt, requestProgress: { state: "waiting" }, outcomeId: todo.id } });
    await t.h.db.run.update({ where: { id: unsent.id }, data: { requestNextCheckAt: checkAt, requestProgress: { state: "waiting" } } });
    const schedule = await new ScheduleService(t.h.db).collect("local",
      { from: hours(1), to: hours(3), kinds: ["follow_up"], botId: t.h.bot.id }, new Date(), "UTC");
    const followUps = new Map(schedule.items.map((item) => [item.id, item]));
    expect(followUps.get(`follow_up:request:${typed.id}`)).toMatchObject({
      title: "Check the figures again", relatedOutcomeId: todo.id, link: { type: "channel", id: t.h.channel.id },
    });
    // The activity list, which the bot's routine list reads, names the linked to-do.
    const listed = new Map((await t.service.list({ botId: t.h.bot.id })).items.map((item) => [item.id, item]));
    expect(listed.get(`request:${typed.id}`)).toMatchObject({
      nextCheckAt: checkAt.toISOString(), relatedOutcome: { id: todo.id, title: "Reconcile figures" },
    });
    expect(listed.get(`request:${unsent.id}`)).not.toHaveProperty("relatedOutcome");
    // The link only groups the entry; opening the follow-up still opens the conversation.
    expect(followUps.get(`follow_up:request:${typed.id}`)?.outcomeId).toBeUndefined();
    expect(followUps.get(`follow_up:request:${unsent.id}`)).not.toHaveProperty("relatedOutcomeId");
  });

  test("a long message is cut to the title limit, and the cut is marked", async () => {
    const t = await setup();
    const content = `${"word ".repeat(80)}END-OF-MESSAGE`;
    const run = await request(t.h, { content });
    const item = (await t.service.list({})).items.find((entry) => entry.id === `request:${run.id}`)!;
    expect(item.title.length).toBeLessThanOrEqual(ACTIVITY_TITLE_LIMIT);
    expect(item.title).toStartWith("word word");
    expect(item.title).not.toContain("END-OF-MESSAGE");
    expect(item.title).toEndWith("…");
  });

  test("the list never carries the evidence or the tool error, and the detail does", async () => {
    const t = await setup();
    const run = await request(t.h, { state: "blocked", blockSource: "tool", toolError: "TOOL-ERROR-TEXT", evidence: ["EVIDENCE-SECRET-TEXT"] });
    const list = JSON.stringify(await t.service.list({ includeAll: true }));
    expect(list).not.toContain("EVIDENCE-SECRET-TEXT");
    expect(list).not.toContain("TOOL-ERROR-TEXT");
    const detail = await t.service.requestDetail(run.id);
    expect(detail).toMatchObject({
      requestRunId: run.id, botId: t.h.bot.id, state: "blocked", blockSource: "tool", evidence: ["EVIDENCE-SECRET-TEXT"],
      toolError: "TOOL-ERROR-TEXT", displayState: "blocked", revision: 3,
    });
  });

  test("a request that does not exist, or never tracked progress, has no detail", async () => {
    const t = await setup();
    expect(await t.service.requestDetail(crypto.randomUUID())).toBeNull();
    const untracked = await request(t.h, { progress: null });
    expect(await t.service.requestDetail(untracked.id)).toBeNull();
  });

  test("it spans every bot, and one bot can be asked for alone", async () => {
    const a = await setup();
    const b = await setup();
    const first = await request(a.h);
    const second = await request(b.h);
    const all = ids(await a.service.list({}));
    expect(all).toEqual(expect.arrayContaining([`request:${first.id}`, `request:${second.id}`]));
    expect(ids(await a.service.list({ botId: a.h.bot.id }))).toEqual([`request:${first.id}`]);
    expect(ids(await a.service.list({ botId: b.h.bot.id }))).toEqual([`request:${second.id}`]);
  });

  test("a stopped request, a request from a routine or goal run, and a run that tracks nothing are left out", async () => {
    const t = await setup();
    const shown = await request(t.h);
    await request(t.h, { stopped: true });
    await request(t.h, { origin: "routine" });
    await request(t.h, { origin: "outcome" });
    await request(t.h, { progress: null });
    expect(ids(await t.service.list({ botId: t.h.bot.id }))).toEqual([`request:${shown.id}`]);
  });
});

describe.skipIf(!url)("how a request is shown", () => {
  test("it is shown by the shared derivation: verifying, no one following up, needs the owner, blocked", async () => {
    const t = await setup();
    const verifying = await request(t.h, { reconciliations: 1 });
    const noFollowUp = await request(t.h, { state: "blocked", blockSource: "runtime" });
    const needsOwner = await request(t.h, { state: "blocked", blockSource: "user", nextAction: "Answer the question" });
    const blocked = await request(t.h, { state: "blocked", blockSource: "tool", toolError: "boom" });
    const byId = new Map((await t.service.list({ botId: t.h.bot.id })).items.map((item) => [item.id, item]));
    const state = (run: { id: string }) => byId.get(`request:${run.id}`)!;
    expect(state(verifying).state).toBe("verifying");
    expect(state(noFollowUp)).toMatchObject({ state: "no_follow_up", needsOwner: true });
    expect(state(needsOwner)).toMatchObject({ state: "needs_owner", needsOwner: true, reason: "Answer the question" });
    expect(state(blocked)).toMatchObject({ state: "blocked", needsOwner: false });
  });

  test("a waiting request shows its next check, and a check that is long overdue reads from the owner's policy", async () => {
    const t = await setup();
    const waiting = await request(t.h, { state: "waiting", nextAction: "Check the reply", checkAt: minutes(-60).toISOString(), nextCheckAt: minutes(-60) });
    const find = async () => (await t.service.list({ botId: t.h.bot.id })).items.find((entry) => entry.id === `request:${waiting.id}`)!;
    // One hour overdue is far beyond the initial tolerance...
    expect(await find()).toMatchObject({ state: "check_not_fired", needsOwner: true, reason: "Check the reply" });
    expect(Math.abs(Date.parse((await find()).nextCheckAt!) - minutes(-60).getTime())).toBeLessThan(5_000);
    // ...and well inside a tolerance the owner has widened. The same row, only the policy differs.
    await updateFeatureSettings(t.h.db, { taskPolicy: { "activity.checkOverdueMinutes": 600 } });
    expect(await find()).toMatchObject({ state: "waiting", needsOwner: false });
    await updateFeatureSettings(t.h.db, { taskPolicy: { "activity.checkOverdueMinutes": 1 } });
    expect((await find()).state).toBe("check_not_fired");
  });

  test("a finished request is shown only while it is recent, by the owner's policy, and 'show all' lifts the limit", async () => {
    const t = await setup();
    const recent = await request(t.h, { state: "complete", updatedAt: hours(-2) });
    const old = await request(t.h, { state: "complete", updatedAt: hours(-50) });
    const only = async (input = {}) => ids(await t.service.list({ botId: t.h.bot.id, ...input }));
    expect(await only()).toEqual([`request:${recent.id}`]);
    expect(await only({ includeAll: true })).toEqual([`request:${old.id}`, `request:${recent.id}`].sort());
    expect(await only({ recentHours: 72 })).toEqual([`request:${old.id}`, `request:${recent.id}`].sort());
    await updateFeatureSettings(t.h.db, { taskPolicy: { "activity.recentCompletedHours": 1 } });
    expect(await only()).toEqual([]);
    await updateFeatureSettings(t.h.db, { taskPolicy: { "activity.recentCompletedHours": 100 } });
    expect(await only()).toEqual([`request:${old.id}`, `request:${recent.id}`].sort());
  });

  test("an unfinished request is shown however long ago it started", async () => {
    const t = await setup();
    const longRunning = await request(t.h, { updatedAt: hours(-24 * 40) });
    expect(ids(await t.service.list({ botId: t.h.bot.id }))).toEqual([`request:${longRunning.id}`]);
  });

  test("the most recently active comes first", async () => {
    const t = await setup();
    const older = await request(t.h, { updatedAt: hours(-5) });
    const newest = await request(t.h, { updatedAt: hours(-1) });
    const middle = await request(t.h, { updatedAt: hours(-3) });
    const order = (await t.service.list({ botId: t.h.bot.id })).items.map((item) => item.id);
    expect(order).toEqual([`request:${newest.id}`, `request:${middle.id}`, `request:${older.id}`]);
  });
});

describe.skipIf(!url)("the size of the list", () => {
  test("it stops at the limit and says it was cut", async () => {
    const t = await setup();
    const total = ACTIVITY_LIST_LIMIT + 5;
    const messages = Array.from({ length: total }, (_, index) => ({
      id: crypto.randomUUID(), botId: t.h.bot.id, conversationId: t.h.bot.conversation!.id, role: "user" as const, content: `Bulk ${index}`, status: "completed" as const,
    }));
    await t.h.db.message.createMany({ data: messages });
    await t.h.db.run.createMany({
      data: messages.map((message, index) => ({
        botId: t.h.bot.id, conversationId: t.h.bot.conversation!.id, userMessageId: message.id, status: "completed" as const,
        requestProgress: { key: `bulk-${index}`, state: "working", summary: "Working", evidence: ["e"], remaining: ["r"], nextAction: "n", runId: "x", revision: 1 },
      })),
    });
    const response = await t.service.list({ botId: t.h.bot.id });
    expect(response.items).toHaveLength(ACTIVITY_LIST_LIMIT);
    expect(response.truncated).toBe(true);
    const exact = await t.service.list({ botId: t.h.bot.id, recentHours: 1 });
    expect(exact.items.length).toBeLessThanOrEqual(ACTIVITY_LIST_LIMIT);
  }, 60_000);

  test("under the limit nothing is flagged as cut", async () => {
    const t = await setup();
    await request(t.h);
    expect((await t.service.list({ botId: t.h.bot.id })).truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Specs/004.10 task 4.2 (requirements A1.3, A3): routines and goal tasks join the list, executors fold into their request.
// ---------------------------------------------------------------------------

let routineCounter = 0;
/** A routine and its most recent execution, as the routine runtime leaves them. */
async function routine(h: Fixture, options: {
  name?: string; last?: "queued" | "running" | "completed" | "failed" | "skipped" | "cancelled" | null;
  error?: unknown; skipReason?: string; inChannel?: boolean; paused?: boolean; enabled?: boolean; deleted?: boolean; nextRunAt?: Date | null; executionAt?: Date;
} = {}) {
  routineCounter += 1;
  const created = await h.db.routine.create({
    data: {
      // A routine belongs to a bot or to a channel, never both (a database constraint); a channel's routine runs on a bot.
      ...(options.inChannel ? { channelId: h.channel.id, executorBotId: h.bot.id } : { botId: h.bot.id }),
      slug: `routine-${routineCounter}-${crypto.randomUUID().slice(0, 6)}`, name: options.name ?? `Routine ${routineCounter}`, prompt: "Do the thing",
      scheduleText: "every day", scheduleKind: "interval", intervalSeconds: 86_400, timezone: "UTC", enabled: options.enabled ?? true,
      nextRunAt: options.nextRunAt === undefined ? hours(10) : options.nextRunAt,
      pausedAt: options.paused ? new Date() : null, deletedAt: options.deleted ? new Date() : null,
    },
  });
  if (options.last) {
    const revision = await h.db.routineRevision.create({
      data: { routineId: created.id, revision: 1, name: created.name, prompt: "Do the thing", scheduleText: "every day", scheduleKind: "interval", intervalSeconds: 86_400, timezone: "UTC", timezoneMode: "installation", enabled: true, source: "fixture" },
    });
    const execution = await h.db.routineExecution.create({
      data: {
        routineId: created.id, routineRevisionId: revision.id, kind: "scheduled", status: options.last, dedupeKey: `exec-${created.id}`, scheduledFor: new Date(),
        ...(options.error !== undefined ? { error: options.error as never } : {}), ...(options.skipReason ? { skipReason: options.skipReason } : {}),
      },
    });
    if (options.executionAt) await h.db.$executeRaw`UPDATE "outcomego_routine_execution" SET "updatedAt" = ${options.executionAt}, "createdAt" = ${options.executionAt} WHERE id = ${execution.id}::uuid`;
  }
  return created;
}

describe.skipIf(!url)("routines in the activity list", () => {
  for (const [name, failure, nextRun] of [["first", "The sandbox refused the command", 5], ["second", "Timed out waiting for the host", 40]] as const) {
    test(`(${name}) a routine whose last run failed shows with the reason and its next run`, async () => {
      const t = await setup();
      const failed = await routine(t.h, { name: `Nightly ${name}`, last: "failed", error: { message: failure }, nextRunAt: hours(nextRun) });
      const item = (await t.service.list({ botId: t.h.bot.id })).items.find((entry) => entry.id === `routine:${failed.id}`)!;
      expect(item).toMatchObject({ type: "routine", botId: t.h.bot.id, title: `Nightly ${name}`, state: "failed", reason: failure, needsOwner: false, link: { type: "routine", id: failed.id } });
      expect(Math.abs(Date.parse(item.nextCheckAt!) - hours(nextRun).getTime())).toBeLessThan(5_000);
    });
  }

  test("a routine that belongs to a channel links to it", async () => {
    const t = await setup();
    const failed = await routine(t.h, { last: "failed", error: { message: "boom" }, inChannel: true });
    const item = (await t.service.list({ botId: t.h.bot.id })).items.find((entry) => entry.id === `routine:${failed.id}`)!;
    // Asked for by the bot that runs it, shown under that bot, and opening the channel it belongs to.
    expect(item).toMatchObject({ botId: t.h.bot.id, link: { type: "channel", id: t.h.channel.id } });
  });

  test("running, queued and skipped runs show; a run that succeeded does not, and neither does one that was cancelled", async () => {
    const t = await setup();
    const running = await routine(t.h, { last: "running" });
    const queued = await routine(t.h, { last: "queued" });
    const skipped = await routine(t.h, { last: "skipped", skipReason: "The previous run was still going" });
    await routine(t.h, { last: "completed" });
    await routine(t.h, { last: "cancelled" });
    await routine(t.h, { last: null });
    const byId = new Map((await t.service.list({ botId: t.h.bot.id })).items.map((item) => [item.id, item]));
    expect([...byId.keys()].sort()).toEqual([`routine:${running.id}`, `routine:${queued.id}`, `routine:${skipped.id}`].sort());
    expect(byId.get(`routine:${running.id}`)!.state).toBe("running");
    expect(byId.get(`routine:${queued.id}`)!.state).toBe("running");
    expect(byId.get(`routine:${skipped.id}`)).toMatchObject({ state: "skipped", reason: "The previous run was still going" });
  });

  test("'show all' adds the routines that are fine, so nothing is hidden for good", async () => {
    const t = await setup();
    const fine = await routine(t.h, { last: "completed" });
    const paused = await routine(t.h, { last: null, paused: true });
    expect(ids(await t.service.list({ botId: t.h.bot.id }))).toEqual([]);
    const all = new Map((await t.service.list({ botId: t.h.bot.id, includeAll: true })).items.map((item) => [item.id, item.state]));
    expect(all.get(`routine:${fine.id}`)).toBe("idle");
    expect(all.get(`routine:${paused.id}`)).toBe("paused");
  });

  test("a paused routine does not hide that its last run failed", async () => {
    const t = await setup();
    const failed = await routine(t.h, { last: "failed", error: { message: "boom" }, paused: true });
    expect((await t.service.list({ botId: t.h.bot.id })).items.find((entry) => entry.id === `routine:${failed.id}`)?.state).toBe("failed");
  });

  test("a routine that was deleted or switched off is not shown", async () => {
    const t = await setup();
    await routine(t.h, { last: "failed", error: { message: "x" }, deleted: true });
    await routine(t.h, { last: "failed", error: { message: "x" }, enabled: false });
    expect(ids(await t.service.list({ botId: t.h.bot.id }))).toEqual([]);
  });

  test("a failure stays until the routine runs well again, and a skip only for the recent window the owner's policy sets", async () => {
    const t = await setup();
    const failed = await routine(t.h, { last: "failed", error: { message: "old failure" }, executionAt: hours(-24 * 20) });
    const skipped = await routine(t.h, { last: "skipped", executionAt: hours(-48) });
    const find = async () => ids(await t.service.list({ botId: t.h.bot.id }));
    expect(await find()).toEqual([`routine:${failed.id}`]);
    await updateFeatureSettings(t.h.db, { taskPolicy: { "activity.recentCompletedHours": 100 } });
    expect(await find()).toEqual([`routine:${failed.id}`, `routine:${skipped.id}`].sort());
    await updateFeatureSettings(t.h.db, { taskPolicy: { "activity.recentCompletedHours": 1 } });
    expect(await find()).toEqual([`routine:${failed.id}`]);
  });

  test("an error that is long is cut, so one bad run cannot flood the list", async () => {
    const t = await setup();
    const failed = await routine(t.h, { last: "failed", error: { message: "x".repeat(5000) } });
    const item = (await t.service.list({ botId: t.h.bot.id })).items.find((entry) => entry.id === `routine:${failed.id}`)!;
    expect(item.reason!.length).toBeLessThan(400);
  });
});

/** A goal with an approved plan and one bot task, as the goal runtime leaves them. */
async function goalTask(h: Fixture, options: {
  title?: string; status?: "queued" | "running"; scheduledAt?: Date | null; statusReason?: string | null;
  progress?: { phase: string; summary?: string; done: number; total: number }; ordinal?: number;
} = {}) {
  const item = await h.item(options.ordinal ?? 1);
  await h.db.outcomeWorkItem.update({
    where: { id: item.id },
    data: {
      title: options.title ?? "Step", status: options.status ?? "queued", scheduledAt: options.scheduledAt ?? null,
      statusReason: options.statusReason ?? null,
      ...(options.progress ? { progress: {
        phase: options.progress.phase, ...(options.progress.summary ? { summary: options.progress.summary } : {}), updatedAt: new Date().toISOString(),
        tasks: Array.from({ length: options.progress.total }, (_, index) => ({ id: `s${index}`, title: `Part ${index}`, status: index < options.progress!.done ? "completed" : "pending" })),
      } } : {}),
    },
  });
  return item;
}

describe.skipIf(!url)("goal tasks in the activity list", () => {
  test("a running task shows its phase and how many parts are done, under 'task — goal'", async () => {
    const t = await setup();
    const item = await goalTask(t.h, { title: "Collect the pieces", status: "running", progress: { phase: "Gathering", summary: "Three sources read", done: 2, total: 5 } });
    const entry = (await t.service.list({ botId: t.h.bot.id })).items.find((candidate) => candidate.id === `goal_task:${item.id}`)!;
    expect(entry).toMatchObject({
      type: "goal_task", botId: t.h.bot.id, title: `Collect the pieces — ${t.h.outcome.title}`, state: "running",
      doing: "Three sources read", progress: { done: 2, total: 5, phase: "Gathering" }, needsOwner: false, link: { type: "outcome", id: t.h.outcome.id },
    });
  });

  test("a task scheduled for later shows as scheduled with its start time, never as working; a deferred one says deferred", async () => {
    const t = await setup();
    const later = hours(30);
    const scheduled = await goalTask(t.h, { scheduledAt: later, ordinal: 1 });
    const deferred = await goalTask(t.h, { scheduledAt: hours(3), statusReason: "deferred_by_agent", ordinal: 2 });
    const byId = new Map((await t.service.list({ botId: t.h.bot.id })).items.map((item) => [item.id, item]));
    expect(byId.get(`goal_task:${scheduled.id}`)).toMatchObject({ state: "scheduled", doing: null, progress: null });
    expect(Math.abs(Date.parse(byId.get(`goal_task:${scheduled.id}`)!.nextCheckAt!) - later.getTime())).toBeLessThan(5_000);
    expect(byId.get(`goal_task:${deferred.id}`)!.state).toBe("deferred");
  });

  test("a task that is waiting its turn with no time, or whose time has passed, is not 'activity'", async () => {
    const t = await setup();
    await goalTask(t.h, { ordinal: 1 });
    await goalTask(t.h, { scheduledAt: hours(-2), ordinal: 2 });
    expect(ids(await t.service.list({ botId: t.h.bot.id }))).toEqual([]);
  });

  test("a goal a bot registered for itself has no task, so it is not activity", async () => {
    const t = await setup();
    await t.h.db.outcome.update({ where: { id: t.h.outcome.id }, data: { kind: "tracked", status: "running" } });
    expect(ids(await t.service.list({ botId: t.h.bot.id }))).toEqual([]);
  });

  test("the tasks of a goal that was accepted or cancelled are gone from the list", async () => {
    const accepted = await setup();
    await goalTask(accepted.h, { status: "running" });
    await accepted.h.db.outcome.update({ where: { id: accepted.h.outcome.id }, data: { acceptedAt: new Date() } });
    expect(ids(await accepted.service.list({ botId: accepted.h.bot.id }))).toEqual([]);
    const cancelled = await setup();
    await goalTask(cancelled.h, { status: "running" });
    await cancelled.h.db.outcome.update({ where: { id: cancelled.h.outcome.id }, data: { cancelledAt: new Date() } });
    expect(ids(await cancelled.service.list({ botId: cancelled.h.bot.id }))).toEqual([]);
  });

  test("a task from a plan that was replaced is not shown", async () => {
    const t = await setup();
    await goalTask(t.h, { status: "running" });
    const next = await t.h.db.outcomeContractRevision.create({
      data: { outcomeId: t.h.outcome.id, revision: 2, status: "approved", approvedAt: new Date(), approvedBy: "owner:local", goal: ["Changed"], boundaries: {}, executionBotId: t.h.bot.id, contentHash: "second", createdBy: "owner:local" },
    });
    await t.h.db.outcome.update({ where: { id: t.h.outcome.id }, data: { currentRevisionId: next.id } });
    expect(ids(await t.service.list({ botId: t.h.bot.id }))).toEqual([]);
  });
});

describe.skipIf(!url)("executors and duplicates", () => {
  /** A scoped worker a request started: its own bot, linked to the request. */
  async function worker(
    h: Fixture,
    requestRunId: string,
    status: "provisioning" | "queued" | "running" | "waiting" | "completed" | "failed",
    nextCheckAt: Date | null = null
  ) {
    const child = await h.db.bot.create({ data: { name: "Worker fixture", defaultDirectory: h.root, status: "active", conversation: { create: {} } } });
    cleanups.push(async () => void (await h.db.bot.delete({ where: { id: child.id } }).catch(() => undefined)));
    const channel = await h.db.channel.findFirstOrThrow({ where: { directKey: `bot:${h.bot.id}` } });
    return h.db.subagent.create({
      data: {
        parentBotId: h.bot.id, childBotId: child.id, parentRunId: requestRunId, requestRunId, parentChannelId: channel.id,
        launchCallId: `call-${crypto.randomUUID()}`, description: "Look into it", prompt: "Look into it", subagentType: "general", outputPath: "out.md", status, nextCheckAt,
      },
    });
  }

  test("the executors a request started are counted under it and never get a row of their own; parked waiting workers without nextCheckAt are not counted", async () => {
    const t = await setup();
    const run = await request(t.h);
    await worker(t.h, run.id, "running");
    await worker(t.h, run.id, "waiting", minutes(30));
    await worker(t.h, run.id, "waiting", null);
    await worker(t.h, run.id, "completed");
    const { items } = await t.service.list({ botId: t.h.bot.id });
    expect(items).toHaveLength(1);
    // Running and scheduled-waiting count as working; parked waiting (nextCheckAt: null) and completed do not.
    expect(items[0]).toMatchObject({ id: `request:${run.id}`, workerCount: 2 });
  });

  test("a request with no executors says zero", async () => {
    const t = await setup();
    const run = await request(t.h);
    expect((await t.service.list({ botId: t.h.bot.id })).items.find((item) => item.id === `request:${run.id}`)!.workerCount).toBe(0);
  });

  test("the run a routine or a goal task made is never a second row for the same thing", async () => {
    const t = await setup();
    // Even when the runtime left progress on such a run, it is the routine's or the goal's own work, shown once as that.
    await request(t.h, { origin: "routine" });
    await request(t.h, { origin: "outcome" });
    const failed = await routine(t.h, { last: "failed", error: { message: "boom" } });
    const task = await goalTask(t.h, { status: "running" });
    const all = (await t.service.list({ botId: t.h.bot.id })).items.map((item) => item.id);
    expect(all.sort()).toEqual([`routine:${failed.id}`, `goal_task:${task.id}`].sort());
    expect(new Set(all).size).toBe(all.length);
  });
});

describe.skipIf(!url)("one list from every source", () => {
  test("requests, routines and goal tasks come together, the most recently active first, each with its type", async () => {
    const t = await setup();
    const oldRequest = await request(t.h, { updatedAt: hours(-6) });
    const failed = await routine(t.h, { last: "failed", error: { message: "x" }, executionAt: hours(-2) });
    const task = await goalTask(t.h, { status: "running" });
    const { items } = await t.service.list({ botId: t.h.bot.id });
    expect(items.map((item) => [item.type, item.id])).toEqual([
      ["goal_task", `goal_task:${task.id}`],
      ["routine", `routine:${failed.id}`],
      ["request", `request:${oldRequest.id}`],
    ]);
  });

  test("the limit covers all sources together, and the list says when it was cut", async () => {
    const t = await setup();
    const total = ACTIVITY_LIST_LIMIT + 3;
    const messages = Array.from({ length: total }, (_, index) => ({
      id: crypto.randomUUID(), botId: t.h.bot.id, conversationId: t.h.bot.conversation!.id, role: "user" as const, content: `Bulk ${index}`, status: "completed" as const,
    }));
    await t.h.db.message.createMany({ data: messages });
    await t.h.db.run.createMany({
      data: messages.map((message, index) => ({
        botId: t.h.bot.id, conversationId: t.h.bot.conversation!.id, userMessageId: message.id, status: "completed" as const,
        requestProgress: { key: `bulk-${index}`, state: "working", summary: "Working", evidence: ["e"], remaining: ["r"], nextAction: "n", runId: "x", revision: 1 },
      })),
    });
    await routine(t.h, { last: "failed", error: { message: "x" } });
    const response = await t.service.list({ botId: t.h.bot.id });
    expect(response.items).toHaveLength(ACTIVITY_LIST_LIMIT);
    expect(response.truncated).toBe(true);
  }, 60_000);

  test("a list with nothing in it is simply empty", async () => {
    const t = await setup();
    expect(await t.service.list({ botId: t.h.bot.id })).toEqual({ items: [], upcoming: [], truncated: false });
  });
});

describe.skipIf(!url)("the requests in the owner's queue (specs/004.10 task 4.4)", () => {
  for (const [name, blockedFor, minutesOverdue] of [["first bot", "needs the owner's choice", 90], ["second bot", "waiting for a reply from the owner", 400]] as const) {
    test(`(${name}) only requests nobody else can move are queued, each once, with the bot's reason`, async () => {
      const t = await setup();
      const ownerBlocked = await request(t.h, { state: "blocked", blockSource: "user", nextAction: blockedFor });
      const runtimeBlocked = await request(t.h, { state: "blocked", blockSource: "runtime" });
      const overdue = await request(t.h, { state: "waiting", nextCheckAt: minutes(-minutesOverdue) });
      await request(t.h, { state: "blocked", blockSource: "tool" });
      await request(t.h, { state: "waiting", nextCheckAt: minutes(60) });
      await request(t.h, { state: "working" });
      await request(t.h, { state: "complete" });
      await request(t.h, { state: "blocked", blockSource: "user", stopped: true });
      await request(t.h, { state: "blocked", blockSource: "user", origin: "routine" });
      const { items } = await t.service.needsMe();
      expect(items.map((item) => item.key).sort()).toEqual([`request:${ownerBlocked.id}`, `request:${runtimeBlocked.id}`, `request:${overdue.id}`].sort());
      const blocked = items.find((item) => item.key === `request:${ownerBlocked.id}`)!;
      expect(blocked).toMatchObject({ source: "request", zone: "blocked", state: "needs_owner", reason: blockedFor, botId: t.h.bot.id });
      expect(items.find((item) => item.key === `request:${overdue.id}`)).toMatchObject({ zone: "exception", state: "check_not_fired" });
      expect(items.find((item) => item.key === `request:${runtimeBlocked.id}`)).toMatchObject({ zone: "exception", state: "no_follow_up" });
    });
  }

  test("the exceptions come first and inside a zone the longest wait is first", async () => {
    const t = await setup();
    const newer = await request(t.h, { state: "blocked", blockSource: "user", updatedAt: minutes(-10) });
    const older = await request(t.h, { state: "blocked", blockSource: "policy", updatedAt: minutes(-500) });
    const exception = await request(t.h, { state: "blocked", blockSource: "runtime", updatedAt: minutes(-1) });
    const { items } = await t.service.needsMe();
    expect(items.map((item) => item.key)).toEqual([`request:${exception.id}`, `request:${older.id}`, `request:${newer.id}`]);
  });

  test("it carries no evidence and no tool error, and the queue is empty once the request moves on", async () => {
    const t = await setup();
    const run = await request(t.h, { state: "blocked", blockSource: "user", evidence: ["EVIDENCE-SECRET-TEXT"], toolError: "TOOL-ERROR-TEXT" });
    const first = await t.service.needsMe();
    expect(JSON.stringify(first)).not.toContain("EVIDENCE-SECRET-TEXT");
    expect(JSON.stringify(first)).not.toContain("TOOL-ERROR-TEXT");
    await t.h.db.run.update({ where: { id: run.id }, data: { requestProgress: { state: "working", summary: "moving", runId: "x", key: "k", revision: 4 } } });
    expect((await t.service.needsMe()).items).toEqual([]);
  });

  test("a request in the activity list is marked as already in the queue, and the two agree", async () => {
    const t = await setup();
    await request(t.h, { state: "blocked", blockSource: "user" });
    await request(t.h, { state: "waiting", nextCheckAt: minutes(-1000) });
    await request(t.h, { state: "working" });
    const queued = (await t.service.needsMe()).items.map((item) => item.key).sort();
    const marked = (await t.service.list({})).items.filter((item) => item.needsOwner).map((item) => item.id).sort();
    expect(queued).toEqual(marked);
  });
});

describe.skipIf(!url)("request recovery is projected without another reminder (specs/004.10 task 4.6)", () => {
  test.each([
    ["Request alpha", "Summary alpha", 30],
    ["Request beta", "Summary beta", 90],
  ])("%s uses the persisted reconciliation and check state", async (content, summary, tolerance) => {
    const { h, service } = await setup();
    const run = await request(h, { content, progress: null });
    await h.db.run.update({ where: { id: run.id }, data: { channelId: h.channel.id } });
    await h.db.$transaction((tx) => ensureRequestForTask(tx, h.bot.id, run.id));
    const activityId = `request:${run.id}`;
    const eventWhere = { botId: h.bot.id, type: "request.check" };
    const notificationWhere = { channelId: h.channel.id, kind: "request" };
    const readStored = () => h.db.run.findUniqueOrThrow({ where: { id: run.id } });
    const settle = () => h.db.$transaction((tx) => settleRequestProgress(tx, h.messaging, h.bot.id, run.id));

    for (const attempt of [1, 2, 3]) {
      await settle();
      await settle();
      const saved = await readStored();
      expect(saved.requestReconciliations).toBe(attempt);
      expect(saved.requestNextCheckAt).toBeNull();
      if (attempt < 3) expect(saved.requestProgress).toMatchObject({ state: "working" });
      else expect(saved.requestProgress).toMatchObject({ state: "blocked", blockSource: "runtime" });
      expect(await h.db.channelNotification.count({ where: notificationWhere })).toBe(0);

      for (const _read of [1, 2]) {
        const { items } = await service.list({ botId: h.bot.id });
        expect(items.find((item) => item.id === activityId)).toMatchObject({
          title: content, state: attempt < 3 ? "verifying" : "no_follow_up", needsOwner: attempt === 3,
        });
        expect((await service.needsMe()).items.filter((item) => item.key === activityId)).toEqual(attempt < 3 ? [] : [
          expect.objectContaining({ state: "no_follow_up", zone: "exception" }),
        ]);
        expect((await service.requestDetail(run.id))?.displayState).toBe(attempt < 3 ? "verifying" : "no_follow_up");
      }
      expect(await readStored()).toEqual(saved);
      expect(await h.db.inboxEvent.count({ where: eventWhere })).toBe(attempt);
      expect(await h.db.channelNotification.count({ where: notificationWhere })).toBe(0);
      if (attempt < 3) {
        await notifyRequestsNeedingOwner(h.db);
        expect(await h.db.channelNotification.count({ where: notificationWhere })).toBe(0);
      }
      await h.db.inboxEvent.updateMany({ where: { ...eventWhere, status: "pending" }, data: { status: "completed" } });
    }

    await settle();
    expect(await h.db.inboxEvent.count({ where: eventWhere })).toBe(3);
    await notifyRequestsNeedingOwner(h.db);
    await notifyRequestsNeedingOwner(h.db);
    expect(await h.db.channelNotification.count({ where: notificationWhere })).toBe(1);
    await h.db.event.deleteMany({ where: { entityId: h.channel.id, topic: "notification.created" } });

    const now = new Date();
    const nextCheckAt = new Date(now.getTime() - tolerance * 60_000);
    const waiting = await request(h, { content, summary, state: "waiting", nextCheckAt });
    await updateFeatureSettings(h.db, { taskPolicy: { "activity.checkOverdueMinutes": tolerance } });
    const waitingId = `request:${waiting.id}`;
    expect((await service.needsMe(now)).items.some((item) => item.key === waitingId)).toBe(false);
    const overdue = new Date(now.getTime() + 1);
    expect((await service.needsMe(overdue)).items.find((item) => item.key === waitingId)).toMatchObject({
      state: "check_not_fired", zone: "exception",
    });
    expect((await service.list({ botId: h.bot.id }, overdue)).items.find((item) => item.id === waitingId)).toMatchObject({
      doing: summary, state: "check_not_fired", needsOwner: true,
    });
    expect(await h.db.run.findUniqueOrThrow({ where: { id: waiting.id } })).toEqual(waiting);
    expect(await h.db.inboxEvent.count({ where: eventWhere })).toBe(3);
    expect(await h.db.channelNotification.count({ where: notificationWhere })).toBe(1);
  });

  test("cancelled runs, inactive bots and archived channels are excluded; owner stopRequest closes active and completed requests with open workers", async () => {
    const t = await setup();
    const cancelled = await request(t.h, { state: "blocked", blockSource: "user", summary: "Cancelled request" });
    await t.h.db.run.update({ where: { id: cancelled.id }, data: { status: "cancelled", error: { code: "cancelled_by_user" } } });
    const peerInterrupted = await request(t.h, { state: "blocked", blockSource: "user", summary: "Peer interrupted request" });
    await t.h.db.run.update({ where: { id: peerInterrupted.id }, data: { status: "cancelled", error: { code: "priority_peer_interrupt" } } });
    const archivedChannel = await t.h.db.channel.create({ data: { kind: "group", name: "Archived", archivedAt: new Date() } });
    cleanups.push(async () => void (await t.h.db.channel.delete({ where: { id: archivedChannel.id } }).catch(() => undefined)));
    const archivedRun = await request(t.h, { state: "waiting", nextCheckAt: minutes(30), channelId: archivedChannel.id });
    const completed = await request(t.h, { state: "complete", summary: "Done recently" });

    expect((await t.service.needsMe()).items.map((item) => item.key)).toEqual([`request:${peerInterrupted.id}`]);
    expect((await t.service.list({ botId: t.h.bot.id, includeAll: true })).items.map((item) => item.id).sort()).toEqual(
      [`request:${completed.id}`, `request:${peerInterrupted.id}`].sort()
    );
    const schedule = new ScheduleService(t.h.db);
    const scheduleItems = await schedule.list("local", {
      from: minutes(-5).toISOString(),
      to: minutes(60).toISOString(),
      kinds: ["follow_up"],
    });
    expect(scheduleItems.items.some((item) => item.id === `follow_up:request:${archivedRun.id}`)).toBe(false);

    const stopped = await t.service.stopRequest(peerInterrupted.id);
    expect(stopped).toEqual({ stopped: true, requestRunId: peerInterrupted.id, stoppedWorkers: 0 });
    expect((await t.service.needsMe()).items).toEqual([]);
    await t.service.stopRequest(completed.id);
    expect((await t.service.list({ botId: t.h.bot.id, includeAll: true })).items).toEqual([]);
  });
});
