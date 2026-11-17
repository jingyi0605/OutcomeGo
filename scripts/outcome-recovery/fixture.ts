import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient, type Prisma } from "@outcomego/db";
import { AgentDataStore, AgentMessaging, enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { disposableDatabaseUrl, type RecoveryReport, type RecoveryScenario } from "./report";

export async function recoveryFixture() {
  const db = createPrismaClient(disposableDatabaseUrl(process.env));
  const root = await mkdtemp(join(tmpdir(), "outcome-recovery-replay-"));
  const store = new AgentDataStore(db, { root: join(root, "agent-data"), workspaceRoot: root });
  const messaging = new AgentMessaging(db, { send: async () => "fixture-job" } as never, store);
  const bot = await db.bot.create({ data: {
    name: "Fictional recovery fixture", status: "active", defaultDirectory: root,
    conversation: { create: {} },
  }, include: { conversation: true } });
  const channel = await db.channel.create({ data: {
    kind: "bot_dm", name: "Fictional recovery fixture", directKey: `bot:${bot.id}`,
    members: { create: { botId: bot.id, ordinal: 0 } },
  } });
  const outcome = await db.outcome.create({ data: { botId: bot.id, title: "Fictional recovery check" } });
  const revision = await db.outcomeContractRevision.create({ data: {
    outcomeId: outcome.id, revision: 1, status: "approved", approvedAt: new Date(), approvedBy: "owner:local",
    createdBy: "owner:local", contentHash: "fictional-recovery", goal: ["Verify recovery"],
    boundaries: { excluded: ["Production access"] }, executionBotId: bot.id,
    criteria: { create: { ordinal: 1, statement: "Observe a consistent result", required: true, verificationMethod: "human_review" } },
  }, include: { criteria: true } });
  await db.outcome.update({ where: { id: outcome.id }, data: { currentRevisionId: revision.id, status: "approved" } });
  const item = await db.outcomeWorkItem.create({ data: {
    outcomeId: outcome.id, contractRevisionId: revision.id, botId: bot.id, executorType: "agent",
    title: "Fictional isolated work", instructions: "Verify without production effects", ordinal: 1, status: "queued",
  } });
  const main = await db.$transaction(tx => messaging.enqueueWake(tx, {
    botId: bot.id, channelId: channel.id, origin: "user", type: "user.message",
    content: "Fictional ordinary conversation", clientId: `main:${outcome.id}`, priority: 300,
  }));
  await db.run.update({ where: { id: main.run.id }, data: {
    status: "running", requestProgress: { phase: "working", fixture: true }, requestRevision: 7,
  } });
  await db.botRunLease.create({ data: {
    botId: bot.id, scope: "foreground", runId: main.run.id, ownerId: "fixture-main",
    expiresAt: new Date(Date.now() + 3_600_000),
  } });
  const foregroundBefore = await foreground();

  async function foreground() {
    return {
      run: await db.run.findUniqueOrThrow({ where: { id: main.run.id } }),
      lease: await db.botRunLease.findUnique({ where: { botId_scope: { botId: bot.id, scope: "foreground" } } }),
      visibleMessages: await db.channelMessage.findMany({ where: { channelId: channel.id }, orderBy: { createdAt: "asc" } }),
    };
  }
  async function enqueue() {
    const result = await db.$transaction(tx => enqueueOutcomeTurn(tx, messaging, {
      workItemId: item.id, content: "Execute fictional isolated work", reason: "start", clientId: `fixture-start:${item.id}`,
    }));
    if (result.status !== "enqueued") throw new Error("fixture_enqueue_failed");
    await db.$transaction(tx => transitionWorkItem(tx, {
      workItemId: item.id, to: "running", reason: "fixture_claim", actor: "system:replay",
    }));
    return result.runId;
  }
  async function locked<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcome.id}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome-work-item:${item.id}`}))`;
      return fn(tx);
    });
  }
  async function snapshot() {
    const current = await db.outcomeWorkItem.findUniqueOrThrow({ where: { id: item.id } });
    return {
      outcomeStatus: (await db.outcome.findUniqueOrThrow({ where: { id: outcome.id } })).status,
      workItemStatus: current.status,
      recoveryCount: "recoveryCount" in current ? current.recoveryCount : null,
      runCount: await db.run.count({ where: { outcomeWorkItemId: item.id } }),
    };
  }
  const checks: RecoveryReport["evidence"]["checks"] = [];
  const check = (name: string, passed: boolean) => { checks.push({ name, passed }); };
  async function report(scenario: RecoveryScenario, initialState: Record<string, unknown>, injectedEventId: string, replayed: number, observations: Record<string, unknown> = {}): Promise<RecoveryReport> {
    check("foreground_run_lease_and_visible_messages_unchanged", JSON.stringify(await foreground()) === JSON.stringify(foregroundBefore));
    check("run_lineage_bound_to_same_work_item", await db.run.count({ where: { botId: bot.id, origin: "outcome", outcomeWorkItemId: { not: item.id } } }) === 0);
    return {
      scenario, status: checks.every(entry => entry.passed) ? "PASS" : "FAIL",
      initialState, injectedEventId, replayed, finalState: await snapshot(),
      outputCount: await db.outcomeOutput.count({ where: { outcomeId: outcome.id } }),
      decisionCount: await db.outcomeDecision.count({ where: { outcomeId: outcome.id } }),
      evidence: { fixtureBotId: bot.id, outcomeId: outcome.id, workItemId: item.id, checks, observations,
        execution: "local-disposable-database", remoteReplay: "PENDING" },
    };
  }
  async function cleanup() {
    const [items, decisions, runs] = await Promise.all([
      db.outcomeWorkItem.findMany({ where: { outcomeId: outcome.id }, select: { id: true } }),
      db.outcomeDecision.findMany({ where: { outcomeId: outcome.id }, select: { id: true } }),
      db.run.findMany({ where: { botId: bot.id }, select: { id: true } }),
    ]);
    const notifications = await db.channelNotification.findMany({ where: { channelId: channel.id }, select: { id: true } });
    const ids = [outcome.id, channel.id, ...items.map(row => row.id), ...decisions.map(row => row.id), ...runs.map(row => row.id), ...notifications.map(row => row.id)];
    const events = await db.event.findMany({ where: { entityId: { in: ids } }, select: { payload: true } });
    const eventIds = events.flatMap(row => {
      const eventId = (row.payload as { eventId?: unknown } | null)?.eventId;
      return typeof eventId === "string" ? [eventId] : [];
    });
    await db.event.deleteMany({ where: { entityId: { in: ids } } });
    await db.idempotencyRecord.deleteMany({ where: { OR: [
      ...ids.map(id => ({ scope: { contains: id } })),
      { scope: { startsWith: "outcome-event:" }, key: { in: eventIds } },
    ] } });
    await db.outboxDelivery.deleteMany({ where: { payload: { path: ["outcomeId"], equals: outcome.id } } });
    await db.bot.delete({ where: { id: bot.id } });
    await db.channel.delete({ where: { id: channel.id } });
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
  return { db, root, store, messaging, bot, channel, outcome, revision, item, main, foregroundBefore,
    runtime: { messaging, workspaceRoot: root }, foreground, enqueue, locked, snapshot, check, report, cleanup };
}
export type RecoveryFixture = Awaited<ReturnType<typeof recoveryFixture>>;
