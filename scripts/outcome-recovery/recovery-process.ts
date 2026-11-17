import { createPrismaClient } from "@outcomego/db";
import { AgentDataStore, AgentMessaging, recoverOutcomeWorkItem } from "@outcomego/messaging";
import { join } from "node:path";
import { disposableDatabaseUrl } from "./report";

const [workItemId, confirmedStoppedRunId, root] = process.argv.slice(2);
if (!workItemId || !confirmedStoppedRunId || !root) throw new Error("fixture_identifiers_required");
const db = createPrismaClient(disposableDatabaseUrl(process.env));
try {
  const store = new AgentDataStore(db, { root: join(root, "agent-data"), workspaceRoot: root });
  const messaging = new AgentMessaging(db, { send: async () => "fixture-recovery-job" } as never, store);
  const action = await db.$transaction(tx => recoverOutcomeWorkItem(tx, workItemId, {
    messaging, workspaceRoot: root, confirmedStoppedRunIds: new Set([confirmedStoppedRunId]),
  }));
  console.log(JSON.stringify({ action }));
} finally { await db.$disconnect(); }
