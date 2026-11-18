import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createPrismaClient, type PrismaClient } from "@outcomego/db";
import { Effect } from "effect";
import { ExploreService } from "../../../src/services/explore-service";
import { OutcomePlanningService } from "../../../src/services/outcome-planning-service";
import { OutcomeService } from "../../../src/services/outcome-service";
import { createOutcomegoBackup, validateOutcomegoBackup } from "../../../../../scripts/migration/validate-outcomego-backup";
import { disposableDatabaseUrl } from "../../../../../scripts/outcome-recovery/report";

const actor = "owner:local" as const;
const requestId = () => `populated-backup:${crypto.randomUUID()}`;
const sourceFiles = [
  "packages/db/prisma/schema.prisma", "packages/db/prisma/sql/raw-schema.sql",
  "apps/server/src/services/outcome-planning-service.ts", "apps/server/src/services/explore-service.ts",
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

async function seedPlanningAndExplore(db: PrismaClient) {
  let inferenceCalls = 0;
  const planning = new OutcomePlanningService(db, async () => {
    inferenceCalls++;
    return { text: JSON.stringify({
      goal: [{ text: "Compare fictional backup alternatives — 数据保留" }],
      acceptance: [{ text: "Keep every linked identity and source digest", required: true }],
      boundaries: [{ text: "Disposable local data only", kind: "included" }],
      questions: [],
    }) };
  });
  const explore = new ExploreService(db, planning), outcomes = new OutcomeService(db);
  const bot = await db.bot.create({ data: {
    name: "Fictional populated backup fixture", status: "active", defaultDirectory: "/tmp",
    conversation: { create: {} },
  } });
  const createPlan = (sourceText: string) => planning.create({
    sourceText, context: { botId: bot.id }, clientRequestId: requestId(),
  });
  const ready = await Effect.runPromise(createPlan("Fictional ready planning draft"));
  const consumed = await Effect.runPromise(createPlan("Fictional approved source delivery"));
  const deliveryInput = (planId: string, title: string) => ({
    planId, title, clientRequestId: requestId(),
    goal: { selectedOptionIds: ["goal-1"], customEntries: [] },
    acceptance: { selectedOptionIds: ["acceptance-1"], customEntries: [] },
    boundaries: { selectedOptionIds: ["boundaries-1"], customEntries: [] },
  });
  const sourceInput = deliveryInput(consumed.planId, "Fictional source Outcome");
  const source = await Effect.runPromise(outcomes.createFromDraft(sourceInput, actor));
  const approval = { expectedRevision: 1, confirmationText: "Confirm fictional local contract", clientRequestId: requestId() };
  await Effect.runPromise(outcomes.approve(source.id, 1, approval, actor));
  const references = [{
    sourceRef: "fixture:populated-backup/source", sourceType: "fixture" as const,
    title: "Fictional source record", version: sha256("fictional immutable source bytes"),
  }];
  const createIdea = (title: string) => explore.create({
    title, note: "Fictional investigation — 保留原文与来源", sourceOutcomeId: source.id,
    sourceReferences: references, budget: { timeLimitMinutes: 12, costLimit: null },
    clientRequestId: requestId(),
  }, actor);
  const draft = await Effect.runPromise(createIdea("Unconverted draft idea"));
  const proposed = await Effect.runPromise(createIdea("Unconverted proposed idea"));
  const proposalInput = { clientRequestId: requestId() };
  const proposal = await Effect.runPromise(explore.propose(proposed.id, proposalInput, actor));
  const converted = await Effect.runPromise(createIdea("Converted idea"));
  const convertedProposal = await Effect.runPromise(explore.propose(converted.id, { clientRequestId: requestId() }, actor));
  const convertedInput = deliveryInput(convertedProposal.plan.planId, "Independent converted Outcome");
  const convertedOutcome = await Effect.runPromise(outcomes.createFromDraft(convertedInput, actor));
  const ids = {
    botId: bot.id, readyPlanId: ready.planId, consumedPlanId: consumed.planId,
    proposedPlanId: proposal.plan.planId, convertedPlanId: convertedProposal.plan.planId,
    draftIdeaId: draft.id, proposedIdeaId: proposed.id, convertedIdeaId: converted.id,
    sourceOutcomeId: source.id, convertedOutcomeId: convertedOutcome.id,
  };
  async function read(client: PrismaClient) {
    const service = new OutcomeService(client);
    const restoredPlanning = new OutcomePlanningService(client, async () => { throw new Error("unexpected_replay_inference"); });
    const restoredExplore = new ExploreService(client, restoredPlanning);
    return {
      plans: await Promise.all([ids.readyPlanId, ids.consumedPlanId, ids.proposedPlanId, ids.convertedPlanId]
        .map(id => Effect.runPromise(restoredPlanning.get(id)))),
      ideas: await Promise.all([ids.draftIdeaId, ids.proposedIdeaId, ids.convertedIdeaId]
        .map(id => Effect.runPromise(restoredExplore.get(id)))),
      outcomes: await Promise.all([ids.sourceOutcomeId, ids.convertedOutcomeId]
        .map(id => Effect.runPromise(service.get(id)))),
    };
  }
  return { ids, inferenceCalls, read, async replay(client: PrismaClient) {
    const service = new OutcomeService(client);
    const restoredPlanning = new OutcomePlanningService(client, async () => { throw new Error("unexpected_replay_inference"); });
    const restoredExplore = new ExploreService(client, restoredPlanning);
    await Effect.runPromise(service.createFromDraft(sourceInput, actor));
    await Effect.runPromise(service.approve(source.id, 1, approval, actor));
    await Effect.runPromise(restoredExplore.propose(proposed.id, proposalInput, actor));
    await Effect.runPromise(service.createFromDraft(convertedInput, actor));
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
  const dumpPath = resolve(output, "planning-explore.dump");
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
    if ((await sourceDb.bot.count()) || (await sourceDb.outcomePlanningDraft.count()) ||
      (await sourceDb.exploreIdea.count()) || (await sourceDb.outcome.count()))
      throw new Error("populated_backup_requires_fresh_fixture_database");
    const fixture = await seedPlanningAndExplore(sourceDb);
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
    const checks = ([
      ["all_physical_tables_full_rows_and_primary_identities_match", compareSnapshots(before, after).length === 0],
      ["portable_backup_content_hash_and_all_references_match", before.portableDataSha256 === after.portableDataSha256],
      ["all_foreign_keys_present_and_validated", before.foreignKeys.length > 0 &&
        before.foreignKeys.every(fk => fk.validated) && canonicalJson(before.foreignKeys) === canonicalJson(after.foreignKeys)],
      ["schema_fingerprint_marker_preserved", !!before.schemaMarker && before.schemaMarker === after.schemaMarker],
      ["service_views_preserve_full_content_and_links", canonicalJson(views) === canonicalJson(restoredViews)],
      ["ready_and_consumed_planning_preserved", restoredViews.plans.map(plan => plan.status).join(",") === "ready,consumed,ready,consumed"],
      ["draft_proposed_converted_explore_preserved", restoredViews.ideas.map(idea => idea.status).join(",") === "draft,proposed_for_delivery,converted"],
      ["conversion_bidirectional_links_preserved", restoredViews.ideas[2]?.proposedOutcomeId === fixture.ids.convertedOutcomeId &&
        restoredViews.outcomes[1]?.sourceExploreId === fixture.ids.convertedIdeaId &&
        restoredViews.ideas.every(idea => idea.sourceOutcomeId === fixture.ids.sourceOutcomeId)],
      ["explore_source_reference_digest_preserved", restoredViews.ideas.every(idea =>
        idea.sourceReferences[0]?.version === sha256("fictional immutable source bytes"))],
      ["approved_source_and_unapproved_independent_conversion_preserved",
        restoredViews.outcomes[0]?.currentRevisionView?.status === "approved" &&
        restoredViews.outcomes[1]?.currentRevisionView?.status === "pending_approval"],
      ["idempotent_service_replay_makes_no_second_facts", canonicalJson(after) === canonicalJson(afterReplay)],
      ["source_database_unchanged_by_restore_and_replay", canonicalJson(before) === canonicalJson(sourceAfter)],
      ["source_dump_bytes_unchanged", sha256(await readFile(dumpPath)) === dumpSha256],
      ["schema_services_and_replay_source_files_unchanged", canonicalJson(sourceHashesBefore) === canonicalJson(sourceHashesAfter)],
    ] satisfies Array<[string, boolean]>).map(([name, passed]) => ({ name, passed }));
    const report = {
      status: checks.every(check => check.passed) ? "PASS" : "FAIL", checks,
      execution: "actual-local-postgres-dump-restore", fixtureIds: fixture.ids, inferenceCalls: fixture.inferenceCalls,
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
