import { AgentMessaging } from "../../src";
import { defaultTaskConfiguration } from "@outcomego/contracts/task-configuration";
import { formatFriendlyDate } from "../../src/timestamps";

export async function promptFixture(scope: "home" | "automation" | "outcome", outcomesEnabled = false) {
  const item = {
    id: "work-item", outcomeId: "outcome", botId: "bot",
    contractRevision: { revision: 1, approvedAt: new Date("2026-11-17T00:00:00Z"), status: "approved",
      goal: ["Approved goal"], boundaries: { included: ["Public research"], excluded: ["Production changes"] },
      criteria: [{ id: "criterion", statement: "Cite sources", required: true }] },
  };
  const db = {
    bot: { findUniqueOrThrow: async () => ({ id: "bot", name: "Fixture", todos: [], subagentIdentity: null, instructions: "Durable instruction", defaultDirectory: "/workspace" }), findMany: async () => [] },
    contextSession: { findFirst: async () => ({ scope, scopeId: scope === "outcome" ? "work-item" : "session" }), findMany: async () => [] },
    channel: { findMany: async () => [], findFirst: async () => null }, botConnectorState: { findMany: async () => [] },
    routine: { findMany: async () => [] }, routineExecution: { findUnique: async () => null },
    automationResult: { findMany: async () => [] }, run: { findMany: async () => [] },
    outcomeWorkItem: { findFirst: async () => item }, $queryRaw: async () => [],
    featureSettings: { findUnique: async () => ({ outcomesEnabled }) },
  };
  const store = {
    root: "/fixture/agent-data", workspaceRoot: "/workspace", assetRoot: "/fixture/assets",
    promptContext: async () => ({ compactionEpoch: 0, profileSection: "Fixture agent profile", profileSnapshot: null,
      identityAnnouncement: "", memory: { policy: "Fixture memory policy", facts: "Fixture shared facts" }, skillRender: "", warnings: [] }),
    loadTaskConfiguration: async () => defaultTaskConfiguration(),
    preparePlatformSections: async (_bot: string, _session: string, _epoch: number, sections: unknown) => ({ sections, receipts: [], memory: { facts: "Fixture shared facts" } }),
  };
  const messaging = new AgentMessaging(db as never, {} as never, store as never);
  messaging.userTimeZone = async () => "UTC";
  const prompt = await messaging.platformPrompt("bot", "session", "Fixture connector instructions", "channel", defaultTaskConfiguration(), scope === "home" ? "user" : scope === "automation" ? "routine" : "outcome", scope === "outcome" ? "work-item" : undefined);
  return JSON.parse(JSON.stringify(prompt).replaceAll(formatFriendlyDate(new Date(), "UTC"), "<current-date>"));
}
