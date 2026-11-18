import { describe, expect, test } from "bun:test";
import { ApiError, AUTOMATION_PARENT_ONLY_TOOLS, type DynamicToolCallRequest } from "@outcomego/contracts";
import { Effect } from "effect";
import { InternalToolService } from "../src/services/internal-tool-service";

const request = (tool: string, args: unknown = {}): DynamicToolCallRequest => ({
  runId: "current-run", botId: "bot", conversationId: "conversation", channelId: "channel",
  deliveryId: null, callId: "call", tool, arguments: args,
});

const CONNECTION = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";

const fixture = (origin: "user" | "routine" | "outcome", options: { handedOff?: boolean; child?: boolean; approvals?: unknown[] } = {}) => {
  const lookups: string[] = [];
  const calls = { speech: 0, narration: 0, visible: 0, reminder: 0, acknowledgements: 0 };
  const pluginResult = { content: [{ type: "text", text: "Draft saved" }] };
  const service = new InternalToolService({
    run: { findUnique: async () => ({
      id: "current-run", botId: "bot", conversationId: "conversation", channelId: "channel",
      deliveryId: null, status: "running", origin,
      outcomeWorkItemId: origin === "outcome" ? "work-item" : null,
      inboxEvents: [{ payload: { automationContextRunId: "routine-root" } }],
    }) },
    subagent: { findUnique: async () => options.child ? { parentBotId: "parent", parentRunId: "parent-run", subagentType: "executor" } : null },
    automationResult: { findUnique: async ({ where }: { where: { runId: string } }) => {
      lookups.push(where.runId);
      return options.handedOff ? { wakeRunId: "foreground-wake" } : null;
    } },
    externalMessageReceipt: { findFirst: async () => null },
    pluginConnection: {
      findUnique: async () => { calls.reminder++; return null; },
      findMany: async () => [{ id: CONNECTION, alias: "Home vault" }],
    },
    outcomeWorkItem: { findUnique: async () => ({ outcomeId: "outcome" }) },
    outcomeDecision: { findMany: async () => [] },
  } as never, {
    sendVisible: async () => { calls.visible++; return { acknowledgement: "sent", interruptRunId: null }; },
    sendNarration: async () => { calls.narration++; return { acknowledgement: { message_id: "message" } }; },
    acknowledgeCardOutcomes: async () => { calls.acknowledgements++; },
  } as never, {} as never, async () => {}, {} as never, {} as never, {} as never,
  { invoke: async () => pluginResult } as never, undefined, undefined,
  async () => { calls.speech++; return true; }, undefined, undefined,
  options.approvals ? { RequestBitwardenReadApproval: async (req) => { options.approvals!.push(req.arguments); return { decisionId: "d", status: "waiting_for_user" }; } } : {});
  return { service, lookups, calls, pluginResult };
};

const failure = async (service: InternalToolService, tool: string, args?: unknown) => {
  const result = await Effect.runPromise(Effect.either(service.execute(request(tool, args))));
  if (result._tag === "Right") throw new Error(`Expected ${tool} to fail`);
  expect(result.left).toBeInstanceOf(ApiError);
  return (result.left as ApiError).code;
};

describe("Outcome background tools preserve the Routine communication boundary", () => {
  for (const origin of ["routine", "outcome"] as const) {
    test(`${origin} keeps parent-only tools, progress, speech and narration unavailable`, async () => {
      const f = fixture(origin);
      for (const tool of AUTOMATION_PARENT_ONLY_TOOLS)
        expect(await failure(f.service, tool)).toBe("automation_tool_forbidden");
      for (const [tool, code] of [
        ["ReportRequestProgress", "request_progress_unavailable"],
        ["UpdateComputerNetworkPolicy", "computer_network_policy_bot_forbidden"],
        ["VoiceSpeak", "speech_unavailable"], ["VoiceNarration", "narration_unavailable"],
      ] as const) expect(await failure(f.service, tool)).toBe(code);
      expect(f.calls).toEqual({ speech: 0, narration: 0, visible: 0, reminder: 0, acknowledgements: 0 });
    });

    test(`${origin} rejects tools after WakeParent using its own durable marker`, async () => {
      const f = fixture(origin, { handedOff: true });
      expect(await failure(f.service, "VoiceSpeak", { callId: "speech", text: "Hello" })).toBe("automation_turn_ended");
      expect(f.lookups).toEqual([origin === "outcome" ? "current-run" : "routine-root"]);
      expect(await Effect.runPromise(f.service.execute(request("AcknowledgeCardOutcomes", { receipts: [] })))).toEqual({ acknowledged: true });
      expect(f.calls.acknowledgements).toBe(1);
      expect(f.lookups).toHaveLength(1);
    });
  }

  test("routine runs still cannot touch Bitwarden, because nobody can answer them", async () => {
    const f = fixture("routine");
    for (const tool of ["SearchBitwardenItems", "RequestBitwardenReadApproval", "ReadBitwardenCredential"])
      expect(await failure(f.service, tool)).toBe("bitwarden_tool_forbidden");
  });

  test("an Outcome run is let through to Bitwarden's own checks instead of being refused as automation", async () => {
    const f = fixture("outcome");
    // Past the gate: the empty search is rejected for its content, not for where it came from.
    expect(await failure(f.service, "SearchBitwardenItems")).toBe("bitwarden_search_invalid");
    // Reading needs the owner's step approval for this Outcome; none exists, so it is refused.
    expect(await failure(f.service, "ReadBitwardenCredential", { itemId: ITEM, field: "password" })).toBe("bitwarden_read_not_approved");
  });

  test("an Outcome run asks through a step approval instead of a chat widget", async () => {
    const approvals: unknown[] = [];
    const f = fixture("outcome", { approvals });
    const candidate = { connectionId: CONNECTION, itemId: ITEM, title: "Unraid", hostname: "10.255.0.75" };
    expect(await Effect.runPromise(f.service.execute(request("RequestBitwardenReadApproval", { candidates: [candidate] }))))
      .toEqual({ decisionId: "d", status: "waiting_for_user" });
    expect(f.calls.visible).toBe(0);
    expect(approvals).toEqual([{ candidates: [{ ...candidate, instanceName: "Home vault" }] }]);
  });

  test("a chat widget is never used for an Outcome run even when step approvals are not registered", async () => {
    const f = fixture("outcome");
    const candidate = { connectionId: CONNECTION, itemId: ITEM, title: "Unraid", hostname: "10.255.0.75" };
    expect(await failure(f.service, "RequestBitwardenReadApproval", { candidates: [candidate] })).toBe("outcome_credential_approval_unavailable");
    expect(f.calls.visible).toBe(0);
  });

  test("ordinary chat retains visible delivery, speech and narration", async () => {
    const f = fixture("user", { handedOff: true });
    expect(await Effect.runPromise(f.service.execute(request("SendToUser", { type: "text", content: "Hello" })))).toBe("sent");
    expect(await Effect.runPromise(f.service.execute(request("VoiceSpeak", { callId: "speech", text: "Hello" })))).toEqual({ spoken: true });
    expect(await Effect.runPromise(f.service.execute(request("VoiceNarration", { text: "Working" })))).toEqual({ message_id: "message" });
    expect(f.calls.visible).toBe(1);
    expect(f.calls.speech).toBe(1);
    expect(f.calls.narration).toBe(1);
    expect(f.lookups).toEqual([]);
  });

  for (const [origin, child, reminder] of [
    ["user", false, 1], ["routine", false, 0], ["outcome", false, 0], ["user", true, 0],
  ] as const) test(`${origin} child=${child} offers connector draft cards only to the user-facing parent`, async () => {
    const f = fixture(origin, { child });
    expect(await Effect.runPromise(f.service.execute(request("PluginCall", { connectionId: "connector", toolName: "create_draft" })))).toEqual(f.pluginResult);
    expect(f.calls.reminder).toBe(reminder);
  });
});
