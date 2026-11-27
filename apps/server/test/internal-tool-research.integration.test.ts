import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiError } from "@outcomego/contracts";
import { createPrismaClient, type OutcomePlanMode } from "@outcomego/db";
import { AgentDataStore } from "@outcomego/messaging";
import { Effect } from "effect";
import { InternalToolService } from "../src/services/internal-tool-service";
import { PluginInvocations } from "../src/services/plugin/invocations";
import { PluginTransport } from "../src/services/plugin/transport";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const tool = (name: string, risk: "read" | "write" | "destructive", extra = {}) => ({ name, description: name, inputSchema: { type: "object" }, risk, ...extra });
const snapshot = [tool("lookup_record", "read"), tool("search_records", "write", { annotations: { readOnlyHint: true } }),
  tool("update_record", "write"), tool("delete_record", "destructive", { annotations: { readOnlyHint: true } }),
  tool("host_poll", "read", { _meta: { "outcomego/hostOnly": true } })];

describe.skipIf(!url)("Server authorization for read-only Outcome research", () => {
  let db: ReturnType<typeof createPrismaClient>;
  let service: InternalToolService;
  let root: string;
  let plannerId: string;
  let targetId: string;
  let unrelatedId: string;
  let plannerChannelId: string;
  let conversationId: string;
  let installationId: string;
  let connectionId: string;
  let noteId: string;
  let changeSnapshotBeforeExecution = false;
  const outputs: string[] = [];
  const ownerId = `research-${crypto.randomUUID()}`;
  const channelIds: string[] = [];
  const botIds: string[] = [];

  beforeAll(async () => {
    db = createPrismaClient(url!);
    root = await mkdtemp(join(tmpdir(), "outcome-research-"));
    const store = new AgentDataStore(db, { root: join(root, "agent-data"), workspaceRoot: root });
    for (const label of ["Planner", "Assigned", "Unrelated"]) {
      const bot = await db.bot.create({ data: { name: label, status: "active", defaultDirectory: root, conversation: { create: {} } }, include: { conversation: true } });
      botIds.push(bot.id);
      const channel = await db.channel.create({ data: { kind: "bot_dm", name: `${label} DM`, directKey: `bot:${bot.id}`, members: { create: { botId: bot.id, ordinal: 0 } } } });
      channelIds.push(channel.id);
      await db.channelMessage.create({ data: { channelId: channel.id, clientId: crypto.randomUUID(), sender: "user", content: `Visible ${label} discussion` } });
      await db.memoryFact.create({ data: { namespace: `agent:${bot.id}`, scope: "agent", writtenByBotId: bot.id, fact: `Research Context ${label} private fact`, factHash: crypto.randomUUID() } });
      if (label === "Planner") conversationId = bot.conversation!.id;
    }
    [plannerId, targetId, unrelatedId] = botIds as [string, string, string];
    [plannerChannelId] = channelIds as [string];
    noteId = (await db.outcome.create({ data: { ownerId, kind: "note", title: "Shared note", status: "active" } })).id;
    await db.memoryFact.create({ data: { namespace: "user:notes", scope: "user", tier: "note", sourceOutcomeId: noteId, fact: "Research Context shared note", factHash: crypto.randomUUID() } });
    const installation = await db.pluginInstallation.create({ data: {
      pluginKey: ownerId, version: "1", name: "Research MCP", publisher: "Test", manifest: {},
    } });
    installationId = installation.id;
    connectionId = (await db.pluginConnection.create({ data: {
      installationId, connectorKey: "docs", name: "Research MCP", transport: "http", authType: "none",
      endpoint: "https://example.test/mcp", status: "ready", toolSnapshot: snapshot,
    } })).id;
    const transport = new PluginTransport(db, { call: async (_connection: string, _options: unknown, toolName: string) => {
      outputs.push(toolName);
      return { content: [{ type: "text", text: toolName }] };
    } } as never, "http://127.0.0.1");
    const invocations = new PluginInvocations(db, async (callId, signal) => {
      if (changeSnapshotBeforeExecution) await db.pluginConnection.update({ where: { id: connectionId }, data: { toolSnapshot: [tool("lookup_record", "write")] } });
      return transport.executeInvocation(callId, signal);
    });
    service = new InternalToolService(db, { agentData: store } as never, {} as never, async () => {},
      {} as never, {} as never, {} as never, { invoke: invocations.invoke } as never);
  });

  afterAll(async () => {
    if (!db) return;
    await db.pluginActivity.deleteMany({ where: { installationId } });
    if (installationId) await db.pluginInstallation.deleteMany({ where: { id: installationId } });
    await db.memoryFact.deleteMany({ where: { OR: [{ writtenByBotId: { in: botIds } }, ...(noteId ? [{ sourceOutcomeId: noteId }] : [])] } });
    await db.outcome.deleteMany({ where: { ownerId } });
    await db.bot.deleteMany({ where: { id: { in: botIds } } });
    await db.channel.deleteMany({ where: { id: { in: channelIds } } });
    await db.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function makeResearch(mode: OutcomePlanMode | null = "advice") {
    const outcome = await db.outcome.create({ data: { ownerId, title: "Research task", botId: targetId } });
    const thread = await db.outcomeThread.create({ data: { outcomeId: outcome.id, botId: plannerId } });
    const message = await db.message.create({ data: { botId: plannerId, conversationId, role: "user", content: "Research" } });
    const run = await db.run.create({ data: { botId: plannerId, conversationId, channelId: plannerChannelId, userMessageId: message.id, status: "running", origin: "outcome_thread", outcomeThreadId: thread.id } });
    const turn = await db.outcomeThreadTurn.create({ data: { runId: run.id, threadId: thread.id, purpose: mode === null ? "replan" : "plan", planMode: mode, outcomeRevision: outcome.revision,
      status: "running", trigger: "Research", triggerBy: "owner:local", clientRequestId: crypto.randomUUID() } });
    const call = async (name: string, args: unknown = {}, callId = crypto.randomUUID()) => {
      const result = await Effect.runPromise(Effect.either(service.execute({ runId: run.id, botId: plannerId, channelId: plannerChannelId, conversationId, deliveryId: null,
        tool: name, arguments: args, callId })));
      if (result._tag === "Left") throw result.left as ApiError;
      return result.right;
    };
    return { call, run, turn, outcome };
  }

  test("permits eligible persisted MCP reads and audits the executing planner and borrowed Outcome Bot", async () => {
    const { call, turn, run, outcome } = await makeResearch();
    const callId = crypto.randomUUID();
    const input = { connectionId, toolName: "lookup_record", borrowedBotId: unrelatedId, accessMode: "full" };
    const before = outputs.length;
    expect(await call("PluginCall", input, callId)).toMatchObject({ content: [{ text: "lookup_record" }] });
    await call("PluginCall", input, callId);
    expect(outputs.slice(before)).toEqual(["lookup_record"]);
    await call("PluginCall", { connectionId, toolName: "search_records" });
    const invocation = await db.pluginInvocation.findUniqueOrThrow({ where: { callId } });
    expect(invocation).toMatchObject({ botId: plannerId, runId: run.id, status: "completed" });
    expect(await db.pluginActivity.findMany({ where: { botId: plannerId, kind: "research_readonly.tool_authorized", metadata: { path: ["invocationId"], equals: invocation.id } } })).toMatchObject([{
      metadata: { invocationId: invocation.id, runId: run.id, outcomeId: outcome.id, turnId: turn.id, planMode: "advice", sourceBotId: targetId, borrowedBotId: targetId, accessMode: "research_readonly" },
    }]);
  });

  test("denies writes, destructive and host-only tools before dispatch and rechecks changed snapshots before transport", async () => {
    const { call } = await makeResearch();
    const before = outputs.length;
    for (const toolName of ["update_record", "delete_record", "host_poll", "unregistered"]) {
      const callId = crypto.randomUUID();
      await expect(call("PluginCall", { connectionId, toolName, source: "notion/notion", readOnly: true }, callId)).rejects.toMatchObject({ status: 403, code: "readonly_mcp_tool_required" });
      expect(await db.pluginInvocation.findUnique({ where: { callId } })).toBeNull();
    }
    changeSnapshotBeforeExecution = true;
    try {
      await expect(call("PluginCall", { connectionId, toolName: "lookup_record" })).rejects.toMatchObject({ status: 403, code: "readonly_mcp_tool_required" });
    } finally {
      changeSnapshotBeforeExecution = false;
      await db.pluginConnection.update({ where: { id: connectionId }, data: { toolSnapshot: snapshot } });
    }
    expect(outputs).toHaveLength(before);
  });

  test("limits recall and transcript history to the planner and its linked Bot, not a caller-supplied peer", async () => {
    const { call } = await makeResearch("triage");
    const recall = await call("RecallMemory", { query: "Research Context", borrowedBotId: unrelatedId }) as string;
    expect(recall).toContain("Planner private fact");
    expect(recall).toContain("Assigned private fact");
    expect(recall).not.toContain("Unrelated private fact");
    expect(recall).toContain(`[noteId: ${noteId}]`);
    const transcript = await call("ReadTranscript", { in: targetId }) as { rows: Array<{ content: string; ownerMessageRef?: string }> };
    expect(transcript.rows).toEqual([expect.objectContaining({ content: "Visible Assigned discussion" })]);
    expect(transcript.rows[0]?.ownerMessageRef).toBeUndefined();
    expect(await call("ReadTranscript", {})).toMatchObject({ rows: [expect.objectContaining({ content: "Visible Planner discussion" })] });
    await expect(call("ReadTranscript", { in: unrelatedId })).rejects.toMatchObject({ status: 404, code: "transcript_unavailable" });
    const activity = await call("ReadAgentActivity", {}) as string;
    expect(activity).toContain("Visible Assigned discussion");
    expect(activity).not.toContain("Visible Unrelated discussion");
  });

  test("rejects direct effects and fails closed when the turn link is missing or borrowed authorization goes stale", async () => {
    const { call, run, outcome } = await makeResearch(null);
    for (const name of ["SendToUser", "WakeParent", "UpdateRoutine", "CopyToBox", "CopyFromBox", "InstallPlugin", "ReadProcessSecrets", "UpdateMemory", "TodoWrite", "PrepareConnectorTransfer"])
      await expect(call(name, { accessMode: "full" })).rejects.toMatchObject({ status: 403, code: "readonly_action_forbidden" });
    await db.outcome.update({ where: { id: outcome.id }, data: { botId: unrelatedId, revision: { increment: 1 } } });
    expect(await call("RecallMemory", { query: "Research Context" })).not.toContain("Unrelated private fact");
    await expect(call("ReadTranscript", { in: unrelatedId })).rejects.toMatchObject({ code: "transcript_unavailable" });
    await db.run.update({ where: { id: run.id }, data: { outcomeThreadId: null } });
    await expect(call("RecallMemory", { query: "Research Context" })).rejects.toMatchObject({ code: "tool_context_invalid" });
  });

  test("requires an active primary borrower and the exact active planner binding", async () => {
    const { call, run, turn } = await makeResearch();
    await db.bot.update({ where: { id: targetId }, data: { status: "archived" } });
    try {
      expect(await call("RecallMemory", { query: "Research Context" })).not.toContain("Assigned private fact");
      await expect(call("ReadTranscript", { in: targetId })).rejects.toMatchObject({ code: "transcript_unavailable" });
      await call("PluginCall", { connectionId, toolName: "lookup_record" });
      expect(await db.pluginActivity.findFirst({ where: {
        kind: "research_readonly.tool_authorized", metadata: { path: ["runId"], equals: run.id },
      } })).toMatchObject({ metadata: { borrowedBotId: null, sourceBotId: plannerId } });
    } finally {
      await db.bot.update({ where: { id: targetId }, data: { status: "active" } });
    }
    await db.outcomeThread.update({ where: { id: turn.threadId }, data: { botId: unrelatedId } });
    await expect(call("RecallMemory", { query: "Research Context" })).rejects.toMatchObject({ code: "tool_context_invalid" });
  });
});
