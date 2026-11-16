import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { InternalToolService } from "../src/services/internal-tool-service";

const request = (argumentsValue: unknown) => ({
  runId: "run-1",
  botId: "bot-1",
  conversationId: "conversation-1",
  channelId: "group-1",
  deliveryId: null,
  tool: "UpdateComputerNetworkPolicy",
  arguments: argumentsValue,
  callId: "call-1",
});

function fixture() {
  let approval: any = null;
  const cards: Array<{ channelId: string; input: any }> = [];
  const applied: string[] = [];
  const prisma = {
    run: {
      findUnique: async () => ({
        id: "run-1",
        botId: "bot-1",
        conversationId: "conversation-1",
        channelId: "group-1",
        deliveryId: null,
        status: "running",
        origin: "user",
        inboxEvents: [],
      }),
    },
    subagent: { findUnique: async () => null },
    automationResult: { findUnique: async () => null },
    channel: {
      findUnique: async () => ({ id: "owner-dm", kind: "bot_dm", archivedAt: null }),
    },
    computerNetworkPolicyApproval: {
      upsert: async ({ create: data }: any) => {
        if (approval) return approval;
        approval = {
          id: "a0000000-0000-4000-8000-000000000001",
          widgetMessageId: null,
          status: "verification_pending",
          ...data,
        };
        return approval;
      },
      findFirst: async () => approval,
      updateMany: async ({ data }: any) => {
        approval = { ...approval, ...data };
        return { count: 1 };
      },
    },
  };
  const messaging = {
    sendVisible: async (context: any, input: any, onPersisted: any) => {
      cards.push({ channelId: context.channelId, input });
      await onPersisted(prisma, `card-${cards.length}`);
      return { acknowledgement: { message_id: `card-${cards.length}` } };
    },
  };
  const policy = {
    prepareBotRequest: async () => ({
      expectedRevision: 4,
      mode: "allowlist",
      rules: [
        { id: "existing", address: "10.255.0.0/24", port: "8000-8100", label: "Existing service" },
        { id: "rule-1", address: "10.255.0.83", port: 3425, label: "Model gateway" },
      ],
    }),
    applyApproved: async (approvalId: string) => {
      applied.push(approvalId);
      return { applied: true };
    },
  };
  const service = new InternalToolService(
    prisma as any,
    messaging as any,
    {} as any,
    async () => undefined,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    undefined,
    undefined,
    undefined,
    policy as any
  );
  return { service, prisma, approval: () => approval, cards, applied };
}

describe("UpdateComputerNetworkPolicy", () => {
  test("requires verification, final approval, and a separate apply call", async () => {
    const fixtureState = fixture();
    const run = (value: unknown) => Effect.runPromise(fixtureState.service.execute(request(value)));

    await expect(run({
      mode: "allowlist",
      rules: [{ address: "10.255.0.83", port: 3425, label: "Model gateway" }],
    })).resolves.toMatchObject({
      waiting_for_verification: true,
      approvalId: "a0000000-0000-4000-8000-000000000001",
    });
    expect(fixtureState.cards).toHaveLength(1);
    expect(fixtureState.cards[0]?.channelId).toBe("owner-dm");
    expect(fixtureState.cards[0]?.input.widget.options).toEqual([
      { label: "Verify policy", value: "verify", style: "default" },
      { label: "Cancel", value: "deny", style: "default" },
    ]);

    await expect(run({ approvalId: "a0000000-0000-4000-8000-000000000001" })).resolves.toMatchObject({ waiting_for_verification: true });
    expect(fixtureState.cards).toHaveLength(1);

    fixtureState.approval().status = "approval_pending";
    fixtureState.approval().widgetMessageId = null;
    await expect(run({ approvalId: "a0000000-0000-4000-8000-000000000001" })).resolves.toMatchObject({
      waiting_for_approval: true,
      approvalId: "a0000000-0000-4000-8000-000000000001",
    });
    expect(fixtureState.cards).toHaveLength(2);
    for (const card of fixtureState.cards) {
      expect(card.input.widget.helpText).toContain("10.255.0.0/24 TCP 8000-8100 (Existing service)");
      expect(card.input.widget.helpText).toContain("10.255.0.83 TCP 3425 (Model gateway)");
    }
    expect(fixtureState.cards[1]?.input.widget.options).toEqual([
      { label: "Approve firewall change", value: "approve", style: "danger" },
      { label: "Deny", value: "deny", style: "default" },
    ]);

    fixtureState.approval().status = "approved";
    await expect(run({ approvalId: "a0000000-0000-4000-8000-000000000001" })).resolves.toEqual({ applied: true });
    expect(fixtureState.applied).toEqual(["a0000000-0000-4000-8000-000000000001"]);
  });

  test("does not allow a subagent to request the operation", async () => {
    const fixtureState = fixture();
    const prisma = (fixtureState.service as any).prisma;
    prisma.subagent.findUnique = async () => ({ id: "child", parentBotId: "parent", subagentType: "computerUse" });

    await expect(
      Effect.runPromise(fixtureState.service.execute(request({ mode: "lan", rules: [] })))
    ).rejects.toThrow("Only an owner bot");
    expect(fixtureState.cards).toHaveLength(0);
  });

  test("retries the initial request without publishing another card", async () => {
    const f = fixture();
    const input = { mode: "allowlist", rules: [{ address: "10.255.0.83", port: 3425 }] };
    const first = await Effect.runPromise(f.service.execute(request(input)));
    const retry = await Effect.runPromise(f.service.execute(request(input)));
    expect(retry).toEqual(first);
    expect(f.cards).toHaveLength(1);
  });

  test("rejects routine callers before creating a request", async () => {
    const f = fixture();
    const findRun = f.prisma.run.findUnique;
    f.prisma.run.findUnique = async () => ({ ...await findRun(), origin: "routine" });
    await expect(Effect.runPromise(f.service.execute(request({ mode: "lan", rules: [] })))).rejects.toThrow("Only an owner bot");
    expect(f.approval()).toBeNull();
  });

  test("rejects denial, expiry, consumed approvals, and payload changes", async () => {
    const f = fixture();
    const run = (input: unknown) => Effect.runPromise(f.service.execute(request(input)));
    await run({ mode: "allowlist", rules: [{ address: "10.255.0.83", port: 3425 }] });
    const approvalId = f.approval().id;
    await expect(run({ approvalId, mode: "lan" })).rejects.toThrow("Pass only a valid approvalId");
    f.approval().status = "denied";
    await expect(run({ approvalId })).rejects.toThrow("denied");
    f.approval().status = "approved";
    f.approval().consumedAt = new Date();
    await expect(run({ approvalId })).rejects.toThrow("already used");
    f.approval().consumedAt = null;
    f.approval().expiresAt = new Date(Date.now() - 1_000);
    await expect(run({ approvalId })).rejects.toThrow("expired");
    expect(f.approval().status).toBe("expired");
    expect(f.applied).toHaveLength(0);
  });
});
