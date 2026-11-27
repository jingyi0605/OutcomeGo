import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Schema } from "effect";
import { SendMessageInput } from "@outcomego/contracts";
import { ChannelService, type CreateGoalThreadInTransaction } from "../src/services/channel-service";

describe("goal mode direct message delivery", () => {
  const baseSetup = (options: {
    outcomesEnabled?: boolean;
    botStatus?: "active" | "provisioning";
    goalMode?: boolean;
    replyTo?: { id: string; sequence: bigint; sender: "user" | "agent" | "system"; content: string; metadata: unknown };
  } = {}) => {
    const channelId = "channel-direct";
    const clientId = "goal-mode-nonce-1";
    const createdMessages: Array<{ content: string; metadata: Record<string, unknown> }> = [];
    const createdGoals: Array<Parameters<CreateGoalThreadInTransaction>[1]> = [];
    let acceptedNormalWakes = 0;

    const tx = {
      $executeRaw: async () => 0,
      $queryRaw: async () => [],
      featureSettings: {
        findUnique: async () => ({ outcomesEnabled: options.outcomesEnabled ?? true }),
      },
      conversation: {
        findUnique: async () => ({
          botId: "bot-1",
          bot: { id: "bot-1", status: options.botStatus ?? "active", subagentIdentity: null },
        }),
      },
      idempotencyRecord: {
        findUnique: async () => null,
        create: async () => ({}),
        update: async () => ({}),
      },
      channel: {
        findUnique: async () => ({ id: channelId, archivedAt: null }),
        update: async () => ({}),
      },
      channelMessage: {
        findFirst: async () => options.replyTo ?? null,
        findUnique: async () => null,
        create: async ({ data }: { data: { content: string; metadata: Record<string, unknown> } }) => {
          createdMessages.push(data);
          return {
            id: `${channelId}-message`,
            sequence: 1n,
            channelId,
            sender: "user",
            senderBotId: null,
            sourceRunId: null,
            clientId,
            content: data.content,
            metadata: data.metadata,
            createdAt: new Date("2026-11-22T12:00:00.000Z"),
          };
        },
        count: async () => 0,
      },
      run: {
        findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id }),
      },
      outcome: { findUnique: async () => ({ title: "Fictional goal", status: "planning" }) },
      session: {
        findUnique: async () => ({ userId: "user-1", expiresAt: new Date(Date.now() + 60_000) }),
      },
      bot: { findMany: async () => [] },
      hostMachine: { findUnique: async () => null },
      event: { create: async () => ({}) },
    };

    const prisma = {
      idempotencyRecord: { findUnique: async () => null },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    };

    const messaging = {
      skipBootstrapForUser: async () => null,
      acceptDirectUserMessage: async () => {
        acceptedNormalWakes += 1;
        return { run: { id: "run-normal" }, interruptRunId: null };
      },
      scheduleTranscriptProjection: async () => undefined,
    };

    const service = new ChannelService(
      prisma as never,
      messaging as never,
      "/workspace",
      async () => new Response(null, { status: 200 }),
      undefined,
      undefined,
      undefined,
      async (_tx, input, actor) => {
        expect(actor).toBe("user:user-1");
        createdGoals.push(input);
        return {
          outcome: { id: "outcome-1" } as never,
          turn: { id: "turn-1", runId: "run-goal-1" } as never,
        };
      }
    );

    return { service, clientId, createdMessages, createdGoals, getAcceptedNormalWakes: () => acceptedNormalWakes };
  };

  test("SendMessageInput accepts optional goalMode", () => {
    const decode = Schema.decodeUnknownSync(SendMessageInput);
    expect(decode({ content: "Create a goal", clientId: "client-id-1234", goalMode: true }).goalMode).toBe(true);
    expect(decode({ content: "Normal chat", clientId: "client-id-1234" }).goalMode).toBeUndefined();
  });

  test("goalMode=true always creates a goal thread in chat and does not trigger ordinary DM wake", async () => {
    const f = baseSetup();
    const result = await Effect.runPromise(
      f.service.sendDirectMessage(
        "conversation-1",
        { content: "每周五自动汇总科技新闻", clientId: f.clientId, goalMode: true },
        "session-1"
      )
    );

    expect(f.createdMessages).toHaveLength(2);
    expect(f.createdMessages[0]!.metadata.goalMode).toBe(true);
    expect(f.createdMessages[1]!.metadata.outcomeCard).toMatchObject({ outcomeId: "outcome-1" });
    expect(f.createdGoals).toEqual([
      {
        prompt: "每周五自动汇总科技新闻",
        outcome: {
          kind: "standard", title: "每周五自动汇总科技新闻", description: "每周五自动汇总科技新闻",
          botId: "bot-1", clientRequestId: f.clientId,
        },
      },
    ]);
    expect(f.getAcceptedNormalWakes()).toBe(0);
    expect(result).toMatchObject({
      message: { content: "每周五自动汇总科技新闻", metadata: { goalMode: true } },
      run: { id: "run-goal-1" },
    });
  });

  test("ordinary messages without goalMode keep the intelligent DM chat flow untouched", async () => {
    const f = baseSetup();
    const result = await Effect.runPromise(
      f.service.sendDirectMessage(
        "conversation-1",
        { content: "普通聊天消息", clientId: f.clientId },
        "session-1"
      )
    );

    expect(f.createdMessages).toHaveLength(1);
    expect(f.createdMessages[0]!.metadata.goalMode).toBeUndefined();
    expect(f.createdGoals).toHaveLength(0);
    expect(f.getAcceptedNormalWakes()).toBe(1);
    expect(result).toMatchObject({ run: { id: "run-normal" } });
  });

  test("goalMode=true rejects when goals are disabled or bot is not active", async () => {
    const disabled = baseSetup({ outcomesEnabled: false });
    const disabledResult = await Effect.runPromise(
      Effect.either(
        disabled.service.sendDirectMessage("conversation-1", {
          content: "goal",
          clientId: disabled.clientId,
          goalMode: true,
        })
      )
    );
    expect(disabledResult._tag).toBe("Left");
    if (disabledResult._tag === "Left") {
      expect((disabledResult.left as { code?: string }).code).toBe("outcomes_disabled");
    }

    const provisioning = baseSetup({ botStatus: "provisioning" });
    const provisioningResult = await Effect.runPromise(
      Effect.either(
        provisioning.service.sendDirectMessage("conversation-1", {
          content: "goal",
          clientId: provisioning.clientId,
          goalMode: true,
        })
      )
    );
    expect(provisioningResult._tag).toBe("Left");
    if (provisioningResult._tag === "Left") {
      expect((provisioningResult.left as { code?: string }).code).toBe("bot_not_runnable");
    }
  });
});
