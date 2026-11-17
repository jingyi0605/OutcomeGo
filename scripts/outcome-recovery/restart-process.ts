import { createPrismaClient } from "@outcomego/db";
import { disposableDatabaseUrl } from "./report";

// This disposable executor owns only the supplied fixture Run. Its exit confirms
// that local executor stopped; it provides no evidence about a remote Computer.
const [runId, workItemId] = process.argv.slice(2);
if (!runId || !workItemId) throw new Error("fixture_identifiers_required");
const db = createPrismaClient(disposableDatabaseUrl(process.env));
try {
  await db.$transaction(async tx => {
    const run = await tx.run.findUniqueOrThrow({ where: { id: runId } });
    if (run.outcomeWorkItemId !== workItemId || run.origin !== "outcome") throw new Error("fixture_lineage_mismatch");
    await tx.run.update({ where: { id: runId }, data: { status: "running", startedAt: new Date(), runtimeTurnId: `fixture:${process.pid}` } });
    await tx.inboxEvent.updateMany({ where: { runId }, data: { status: "processing" } });
    await tx.botRunLease.create({ data: {
      botId: run.botId, runId, scope: `outcome:${workItemId}`, ownerId: `fixture:${process.pid}`,
      expiresAt: new Date(Date.now() - 60_000),
    } });
  });
  console.log(JSON.stringify({ ready: true, runId, pid: process.pid }));
  await new Promise<void>(() => { setInterval(() => {}, 1_000); });
} finally { await db.$disconnect(); }
