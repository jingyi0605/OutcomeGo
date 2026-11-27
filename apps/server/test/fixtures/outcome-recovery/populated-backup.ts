import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createPrismaClient, type PrismaClient } from "@outcomego/db";
import { AgentDataStore, AgentMessaging, settleOutcomeThreadTurn, startOutcomeThreadTurn, type ToolContext } from "@outcomego/messaging";
import type { ClassifyOutcomeInput, SaveOutcomeContractInput, SavePlanAdviceInput } from "@outcomego/contracts/outcome-thread";
import { Effect } from "effect";
import { OutcomeClassificationService } from "../../../src/services/outcome-classification";
import { OutcomeService } from "../../../src/services/outcome-service";
import { OutcomeThreadService } from "../../../src/services/outcome-thread-service";
import { OutcomeThreadTools } from "../../../src/services/outcome-thread-tools";
import { createOutcomegoBackup, validateOutcomegoBackup } from "../../../../../scripts/migration/validate-outcomego-backup";
import { disposableDatabaseUrl } from "../../../../../scripts/outcome-recovery/report";

const actor = "owner:local" as const;
const requestId = () => `populated-backup:${crypto.randomUUID()}`;
const sourceFiles = [
  "packages/db/prisma/schema.prisma", "packages/db/prisma/sql/raw-schema.sql",
  "apps/server/src/services/outcome-classification.ts", "apps/server/src/services/outcome-thread-service.ts",
  "apps/server/src/services/outcome-thread-tools.ts", "packages/messaging/src/outcome-threads.ts",
  "apps/server/src/services/outcome-service.ts", "scripts/migration/backup-schema.ts",
  "scripts/migration/validate-outcomego-backup.ts", "apps/server/test/fixtures/outcome-recovery/populated-backup.ts",
  "scripts/test-outcome-populated-backup.ts",
];
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function backupOptions(args: string[], environment: Record<string, string | undefined>) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!, value = args[index + 1];
    if (!["--container", "--restore-database", "--output"].includes(key) ||
      !value || value.startsWith("--") || values.has(key)) throw new Error("invalid_backup_arguments");
    values.set(key, value);
  }
  const source = new URL(disposableDatabaseUrl(environment));
  const container = values.get("--container"), restoredDatabase = values.get("--restore-database");
  const output = values.get("--output");
  const sourceDatabase = decodeURIComponent(source.pathname.slice(1));
  if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(container) ||
    !restoredDatabase || !/^[a-zA-Z][a-zA-Z0-9_]+$/.test(restoredDatabase) ||
    restoredDatabase === sourceDatabase || !sourceDatabase || !source.username || !output)
    throw new Error("explicit_distinct_backup_databases_required");
  const restored = new URL(source);
  restored.pathname = `/${restoredDatabase}`;
  return { source, restored, sourceDatabase, restoredDatabase, container, output: resolve(output) };
}

type TableDigest = { count: number; sha256: string; identities: unknown[] };
export type DatabaseSnapshot = {
  tables: Record<string, TableDigest>;
  foreignKeys: Array<{ name: string; table: string; definition: string; validated: boolean }>;
  schemaMarker: string | null;
  portableDataSha256: string;
};
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Read every physical row; reports retain hashes and primary identities, not business text. */
export async function databaseSnapshot(db: PrismaClient): Promise<DatabaseSnapshot> {
  const tableNames = await db.$queryRaw<Array<{ name: string }>>`
    SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const primaryKeys = await db.$queryRaw<Array<{ name: string; columns: string[] }>>`
    SELECT c.relname AS name, array_agg(a.attname::text ORDER BY k.ordinality) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
    WHERE i.indisprimary AND n.nspname='public' GROUP BY c.relname`;
  const raw: Record<string, Array<Record<string, unknown>>> = {};
  const tables: Record<string, TableDigest> = {};
  for (const { name } of tableNames) {
    const rows = await db.$queryRawUnsafe<Array<{ data: string }>>(
      `SELECT to_jsonb(t)::text AS data FROM ${identifier(name)} t`);
    raw[name] = rows.map(row => JSON.parse(row.data) as Record<string, unknown>);
    // Hash PostgreSQL's complete JSON text before JS parsing can round bigint/numeric values.
    const contents = rows.map(row => row.data).sort();
    const keys = primaryKeys.find(key => key.name === name)?.columns ?? [];
    tables[name] = {
      count: rows.length, sha256: sha256(canonicalJson(contents)),
      identities: raw[name].map(row => Object.fromEntries(keys.map(key => [key, row[key]])))
        .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    };
  }
  // Reuse the current-schema validator, including all explicit foreign-key references.
  const portable = validateOutcomegoBackup(JSON.stringify(createOutcomegoBackup(raw)));
  const foreignKeys = await db.$queryRaw<DatabaseSnapshot["foreignKeys"]>`
    SELECT con.conname AS name, c.relname AS table, pg_get_constraintdef(con.oid) AS definition,
      con.convalidated AS validated
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE con.contype='f' AND n.nspname='public' ORDER BY c.relname,con.conname`;
  const markers = await db.$queryRaw<Array<{ marker: string | null }>>`
    SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname='public'`;
  return { tables, foreignKeys, schemaMarker: markers[0]?.marker ?? null,
    portableDataSha256: portable.dataSha256 };
}

export function compareSnapshots(before: DatabaseSnapshot, after: DatabaseSnapshot) {
  const names = new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]);
  return [...names].filter(name => canonicalJson(before.tables[name] ?? null) !== canonicalJson(after.tables[name] ?? null));
}

function backupServices(client: PrismaClient, output: string) {
  const store = new AgentDataStore(client, { root: resolve(output, "agent-data"), workspaceRoot: output });
  const messaging = new AgentMessaging(client, { send: async () => "fixture-wake" } as never, store);
  const threads = new OutcomeThreadService(client, messaging);
  const enqueuePlan = threads.plan.bind(threads);
  const outcomes = new OutcomeService(client, messaging, undefined, undefined, undefined, { enqueuePlan });
  const classification = new OutcomeClassificationService(client, outcomes, enqueuePlan);
  const tools = new OutcomeThreadTools(client, outcomes, undefined, undefined, undefined, classification);
  return { messaging, threads, outcomes, tools };
}

async function seedUnifiedPlanning(db: PrismaClient, output: string) {
  const { messaging, threads, outcomes, tools } = backupServices(db, output);
  await db.featureSettings.create({ data: { id: "global", outcomesEnabled: true } });
  const bot = await db.bot.create({ data: {
    name: "Fictional populated backup fixture", status: "active", defaultDirectory: output,
    conversation: { create: {} },
  }, include: { conversation: true } });
  const channel = await db.channel.create({ data: {
    kind: "bot_dm", name: "Fictional backup", directKey: `bot:${bot.id}`,
    members: { create: { botId: bot.id, ordinal: 0 } },
  } });
  const context = (runId: string, tool: string): ToolContext => ({
    runId, botId: bot.id, channelId: channel.id, conversationId: bot.conversation!.id, deliveryId: null,
    origin: "outcome_thread", callId: tool, replyToMessageId: null, isFork: false,
  });
  const invoke = (target: OutcomeThreadTools, runId: string, tool: string, args: unknown) => {
    const toolContext = context(runId, tool);
    return target.execute({ ...toolContext, tool, arguments: args }, toolContext);
  };
  const start = (runId: string) => db.$transaction(async tx => {
    await tx.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date() } });
    await startOutcomeThreadTurn(tx, runId);
  });
  const settle = (runId: string) => db.$transaction(async tx => {
    await tx.run.update({ where: { id: runId }, data: { status: "completed", completedAt: new Date() } });
    await tx.inboxEvent.updateMany({ where: { runId }, data: { status: "completed", completedAt: new Date() } });
    await settleOutcomeThreadTurn(tx, runId, messaging);
  });
  const intakeInput = { text: "Fictional backup alternatives — 数据保留\nKeep the original note and derive the follow-ups.", botId: bot.id, clientRequestId: requestId() };
  const source = await Effect.runPromise(outcomes.createIntake(intakeInput, actor));
  const triage = source.turn;
  if (!triage?.runId) throw new Error("populated_backup_missing_triage_run");
  const classification: ClassifyOutcomeInput = {
    strategy: "split_from_note", summary: "Keep the original note and separate the review from the research idea.",
    memoryFacts: ["Fictional source retained for backup comparison"],
    children: [
      { kind: "standard", title: "Fictional backup review" },
      { kind: "explore_idea", title: "Fictional investigation — 保留原文与来源", budget: { timeLimitMinutes: 12, costLimit: null } },
      { kind: "todo", title: "Record the restore test result" },
    ], clientRequestId: requestId(),
  };
  await start(triage.runId);
  await invoke(tools, triage.runId, "ClassifyOutcome", classification);
  await settle(triage.runId);
  const children = await db.outcome.findMany({ where: { parentOutcomeId: source.outcome.id }, select: { id: true, kind: true, revision: true } });
  const standard = children.find(child => child.kind === "standard");
  const idea = children.find(child => child.kind === "explore_idea");
  const todo = children.find(child => child.kind === "todo");
  if (!standard || !idea || !todo) throw new Error("populated_backup_missing_children");
  const planInput = { mode: "contract_plan" as const, expectedRevision: standard.revision, clientRequestId: requestId() };
  const plan = await threads.plan(standard.id, planInput, actor);
  if (!plan.runId) throw new Error("populated_backup_missing_contract_plan_run");
  const contract: SaveOutcomeContractInput = {
    title: "Fictional backup review", goal: ["Compare two backup options"],
    acceptance: [{ statement: "Keep the source reference and stable identities", required: true }],
    boundaries: { included: ["Disposable local data"], excluded: ["Production data"] }, clientRequestId: requestId(),
  };
  await start(plan.runId);
  await invoke(tools, plan.runId, "SaveOutcomeContract", contract);
  await settle(plan.runId);
  const approval = { expectedRevision: 1, confirmationText: "Confirm fictional local contract", clientRequestId: requestId() };
  await Effect.runPromise(outcomes.approve(standard.id, 1, approval, actor));
  const adviceInput = { mode: "advice" as const, expectedRevision: idea.revision, clientRequestId: requestId() };
  const adviceTurn = await threads.plan(idea.id, adviceInput, actor);
  if (!adviceTurn.runId) throw new Error("populated_backup_missing_advice_run");
  const advice: SavePlanAdviceInput = {
    summary: "Investigate the fictional source", facts: [{ statement: "Source bytes match", source: sha256("fictional immutable source bytes") }],
    gaps: ["No recovery time measurement"], recommendations: [{ action: "Measure a restore", needsOwnerConfirm: true }], clientRequestId: requestId(),
  };
  await start(adviceTurn.runId);
  await invoke(tools, adviceTurn.runId, "SavePlanAdvice", advice);
  await settle(adviceTurn.runId);
  const ids = {
    botId: bot.id, sourceOutcomeId: source.outcome.id, standardOutcomeId: standard.id, ideaOutcomeId: idea.id, todoOutcomeId: todo.id,
    triageTurnId: triage.id, contractTurnId: plan.id, adviceTurnId: adviceTurn.id,
  };
  const outcomeIds = [ids.sourceOutcomeId, standard.id, idea.id, todo.id];
  async function read(client: PrismaClient) {
    const restored = backupServices(client, output);
    return {
      threads: await Promise.all(outcomeIds.map(id => restored.threads.list(id))),
      outcomes: await Promise.all(outcomeIds.map(id => Effect.runPromise(restored.outcomes.get(id)))),
    };
  }
  return { ids, read, async replay(client: PrismaClient) {
    const restored = backupServices(client, output);
    await Effect.runPromise(restored.outcomes.createIntake(intakeInput, actor));
    await invoke(restored.tools, triage.runId!, "ClassifyOutcome", classification);
    await restored.threads.plan(standard.id, planInput, actor);
    await invoke(restored.tools, plan.runId!, "SaveOutcomeContract", contract);
    await Effect.runPromise(restored.outcomes.approve(standard.id, 1, approval, actor));
    await restored.threads.plan(idea.id, adviceInput, actor);
    await invoke(restored.tools, adviceTurn.runId!, "SavePlanAdvice", advice);
  } };
}

async function command(args: string[], stdout?: string) {
  const child = Bun.spawn(args, { stdout: stdout ? Bun.file(stdout) : "pipe", stderr: "pipe" });
  const [out, error, exitCode] = await Promise.all([
    typeof child.stdout === "number" ? Promise.resolve("") : new Response(child.stdout).text(),
    new Response(child.stderr).text(), child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`backup_command_failed:${args[0]}:${exitCode}:${error.slice(0, 300)}`);
  return out.trim();
}

export async function runPopulatedBackup(options: ReturnType<typeof backupOptions>) {
  const { source, restored, sourceDatabase, restoredDatabase, container, output } = options;
  const readSourceHashes = async () => Object.fromEntries(
    await Promise.all(sourceFiles.map(async path => [path, sha256(await readFile(path))])));
  const sourceHashesBefore = await readSourceHashes();
  await mkdir(output, { recursive: true });
  const dumpPath = resolve(output, "unified-outcomes.dump");
  if (await Bun.file(dumpPath).exists()) throw new Error("backup_output_already_exists");
  const bindings = JSON.parse(await command(["docker", "inspect", "--format",
    "{{json .NetworkSettings.Ports}}", container])) as Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  if (!bindings["5432/tcp"]?.some(binding =>
    ["127.0.0.1", "::1"].includes(binding.HostIp) && binding.HostPort === (source.port || "5432")))
    throw new Error("container_does_not_match_explicit_local_database");
  const user = decodeURIComponent(source.username);
  const sourceDb = createPrismaClient(source.toString());
  let restoredDb: PrismaClient | undefined;
  try {
    if ((await sourceDb.bot.count()) || (await sourceDb.outcome.count()))
      throw new Error("populated_backup_requires_fresh_fixture_database");
    const fixture = await seedUnifiedPlanning(sourceDb, output);
    const views = await fixture.read(sourceDb), before = await databaseSnapshot(sourceDb);
    await command(["docker", "exec", container, "pg_dump", "-U", user, "-d", sourceDatabase,
      "--format=custom", "--no-owner", "--no-acl"], dumpPath);
    const dumpSha256 = sha256(await readFile(dumpPath));
    await command(["docker", "exec", container, "createdb", "-U", user, "--", restoredDatabase]);
    const restore = Bun.spawn(["docker", "exec", "-i", container, "pg_restore", "-U", user,
      "-d", restoredDatabase, "--exit-on-error", "--no-owner", "--no-acl"],
    { stdin: Bun.file(dumpPath), stdout: "pipe", stderr: "pipe" });
    const [restoreOut, restoreError, restoreCode] = await Promise.all([
      new Response(restore.stdout).text(), new Response(restore.stderr).text(), restore.exited,
    ]);
    await Bun.write(resolve(output, "restore.log"), restoreOut + restoreError);
    if (restoreCode !== 0) throw new Error(`restore_failed:${restoreCode}`);
    restoredDb = createPrismaClient(restored.toString());
    const after = await databaseSnapshot(restoredDb);
    const restoredViews = await fixture.read(restoredDb);
    await fixture.replay(restoredDb);
    const afterReplay = await databaseSnapshot(restoredDb);
    const sourceAfter = await databaseSnapshot(sourceDb);
    const sourceHashesAfter = await readSourceHashes();
    const [source, standard, idea, todo] = restoredViews.outcomes;
    const [triage, contract, advice] = restoredViews.threads.map(thread => thread.turns[0]);
    const checks = ([
      ["all_physical_tables_full_rows_and_primary_identities_match", compareSnapshots(before, after).length === 0],
      ["portable_backup_content_hash_and_all_references_match", before.portableDataSha256 === after.portableDataSha256],
      ["all_foreign_keys_present_and_validated", before.foreignKeys.length > 0 &&
        before.foreignKeys.every(fk => fk.validated) && canonicalJson(before.foreignKeys) === canonicalJson(after.foreignKeys)],
      ["schema_fingerprint_marker_preserved", !!before.schemaMarker && before.schemaMarker === after.schemaMarker],
      ["service_views_preserve_full_content_and_links", canonicalJson(views) === canonicalJson(restoredViews)],
      ["completed_unified_planning_turns_preserved", triage?.planMode === "triage" && triage.status === "completed" &&
        contract?.planMode === "contract_plan" && contract.status === "completed" && advice?.planMode === "advice" && advice.status === "completed"],
      ["intake_source_and_children_preserved", source?.kind === "note" && source.status === "active" && source.description.includes("Keep the original note") &&
        triage?.planMode === "triage" && triage.result?.sourceOutcomeId === source.id &&
        [standard, idea, todo].every(child => child?.parentOutcomeId === source.id && triage.result?.createdChildren.some(entry => entry.outcomeId === child.id))],
      ["structured_advice_and_source_digest_preserved", advice?.planMode === "advice" &&
        advice.result?.facts[0]?.source === sha256("fictional immutable source bytes")],
      ["approved_contract_unconverted_idea_and_open_todo_preserved", standard?.kind === "standard" &&
        standard.currentRevisionView?.status === "approved" && idea?.kind === "explore_idea" && idea.status === "draft" && todo?.kind === "todo" && todo.status === "open"],
      ["idempotent_service_replay_makes_no_second_facts", canonicalJson(after) === canonicalJson(afterReplay)],
      ["source_database_unchanged_by_restore_and_replay", canonicalJson(before) === canonicalJson(sourceAfter)],
      ["source_dump_bytes_unchanged", sha256(await readFile(dumpPath)) === dumpSha256],
      ["schema_services_and_replay_source_files_unchanged", canonicalJson(sourceHashesBefore) === canonicalJson(sourceHashesAfter)],
    ] satisfies Array<[string, boolean]>).map(([name, passed]) => ({ name, passed }));
    const report = {
      status: checks.every(check => check.passed) ? "PASS" : "FAIL", checks,
      execution: "actual-local-postgres-dump-restore", fixtureIds: fixture.ids,
      sourceDatabase, restoredDatabase, container, sourceHead: await command(["git", "rev-parse", "HEAD"]),
      dump: { path: dumpPath, bytes: (await stat(dumpPath)).size, sha256: dumpSha256 },
      sourceHashesBefore, sourceHashesAfter, before, after, afterReplay,
      serviceViewSha256: sha256(canonicalJson(views)), restoredServiceViewSha256: sha256(canonicalJson(restoredViews)),
      limits: { inference: "fictional-deterministic-test-port", oldImageRollback: "PENDING",
        remoteProvider: "PENDING", volumesAndDeviceInstall: "NOT_EXECUTED" },
    };
    await Bun.write(resolve(output, "result.json"), JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally {
    await sourceDb.$disconnect();
    await restoredDb?.$disconnect();
  }
}
