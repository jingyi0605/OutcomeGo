import { afterAll, describe, expect, test } from "bun:test";
import { ACTIVITY_LIST_LIMIT, ACTIVITY_TITLE_LIMIT } from "@outcomego/contracts/task-overview";
import { updateFeatureSettings } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { ActivityService } from "../src/services/activity-service";

// Specs/004.10 task 4.1 (requirements A1, A2): the owner's list of unfinished requests across every bot, and the detail
// of one. Needs a disposable PostgreSQL database; skipped without OUTCOMEGO_TEST_DATABASE_URL. Fixtures are
// scenario-neutral placeholders, and each rule is checked on two bots with different wording and numbers.
const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
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
