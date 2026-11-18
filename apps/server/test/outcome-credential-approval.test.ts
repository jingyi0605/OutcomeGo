import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { enqueueOutcomeTurn, transitionWorkItem } from "@outcomego/messaging";
import { outcomeThreadFixture } from "../../../packages/messaging/test/fixtures/outcome-thread";
import { DecisionService } from "../src/services/decision-service";
import { OutcomeService } from "../src/services/outcome-service";
import {
  createOutcomeCredentialApprovalTool,
  findOutcomeCredentialGrant,
} from "../src/services/outcome-credential-approval";

const grantItem = {
  connectionId: "11111111-1111-4111-8111-111111111111",
  itemId: "22222222-2222-4222-8222-222222222222",
  title: "Unraid",
  hostname: "10.255.0.75",
  instanceName: "Home vault",
};

const stub = (rows: Array<{ resolvedOption: unknown }>) => {
  const queries: unknown[] = [];
  const prisma = {
    outcomeWorkItem: { findUnique: async () => ({ outcomeId: "outcome-1" }) },
    outcomeDecision: {
      findMany: async (args: unknown) => {
        queries.push(args);
        return rows;
      },
    },
  };
  return { prisma: prisma as never, queries };
};

describe("Outcome credential grants", () => {
  test("a chosen allow option grants only its own item and instance", async () => {
    const { prisma } = stub([{ resolvedOption: { id: "option-1", credentialGrant: [grantItem] } }]);
    expect(await findOutcomeCredentialGrant(prisma, "item", grantItem.itemId, null)).toEqual(grantItem);
    expect(await findOutcomeCredentialGrant(prisma, "item", grantItem.itemId.toUpperCase(), grantItem.connectionId)).toEqual(grantItem);
    expect(await findOutcomeCredentialGrant(prisma, "item", "33333333-3333-4333-8333-333333333333", null)).toBeNull();
    expect(
      await findOutcomeCredentialGrant(prisma, "item", grantItem.itemId, "44444444-4444-4444-8444-444444444444"),
    ).toBeNull();
  });

  test("the deny option and a custom answer carry no grant", async () => {
    const { prisma } = stub([{ resolvedOption: { id: "option-2" } }, { resolvedOption: null }]);
    expect(await findOutcomeCredentialGrant(prisma, "item", grantItem.itemId, null)).toBeNull();
  });

  test("only resolved credential decisions of this Outcome answered by a person are read", async () => {
    const { prisma, queries } = stub([]);
    await findOutcomeCredentialGrant(prisma, "item", grantItem.itemId, null);
    expect(queries[0]).toMatchObject({
      where: {
        outcomeId: "outcome-1",
        reasonCode: "credential_access_required",
        status: "resolved",
        OR: [{ resolvedBy: { startsWith: "owner:" } }, { resolvedBy: { startsWith: "user:" } }],
      },
    });
  });

  test("an item that is already granted is not asked about again", async () => {
    const { prisma } = stub([{ resolvedOption: { id: "option-1", credentialGrant: [grantItem] } }]);
    const tool = createOutcomeCredentialApprovalTool(prisma, {} as never);
    const result = await tool(
      { runId: "r", botId: "b", conversationId: "c", channelId: "ch", deliveryId: "d", tool: "RequestBitwardenReadApproval", callId: "x", arguments: { candidates: [grantItem] } } as never,
      { runId: "r", workItemId: "item", botId: "b" },
    );
    expect(result).toEqual({ approved: true, already_granted: true });
  });

  test("a request without candidates is rejected", async () => {
    const { prisma } = stub([]);
    const tool = createOutcomeCredentialApprovalTool(prisma, {} as never);
    await expect(
      tool({ arguments: { candidates: [] } } as never, { runId: "r", workItemId: "item", botId: "b" }),
    ).rejects.toThrow("Bitwarden candidates");
  });
});

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("Outcome credential step approval", () => {
  const setup = async () => {
    const h = await outcomeThreadFixture();
    const item = await h.item();
    const wake = await h.db.$transaction((tx) =>
      enqueueOutcomeTurn(tx, h.messaging, { workItemId: item.id, content: "Execute", reason: "start", clientId: `outcome-run:${h.outcome.id}:1:${item.id}` }),
    );
    if (wake.status !== "enqueued") throw new Error("Expected an enqueued run");
    await h.db.run.update({ where: { id: wake.runId }, data: { status: "running", startedAt: new Date() } });
    await h.db.$transaction((tx) => transitionWorkItem(tx, { workItemId: item.id, to: "running", actor: "system:test", reason: "claimed" }));
    const decisions = new DecisionService(h.db, { messaging: h.messaging, createRevision: new OutcomeService(h.db).createRevisionInTransaction });
    const tool = createOutcomeCredentialApprovalTool(h.db, decisions);
    const source = await h.db.run.findUniqueOrThrow({ where: { id: wake.runId } });
    const request = {
      runId: source.id, botId: h.bot.id, conversationId: source.conversationId, channelId: source.channelId!,
      deliveryId: source.deliveryId, tool: "RequestBitwardenReadApproval", callId: "fixture",
      arguments: { candidates: [grantItem] },
    };
    return { h, item, source, decisions, tool, request, context: { runId: source.id, workItemId: item.id, botId: h.bot.id } };
  };

  test("the owner's allow answer unlocks reads for the whole Outcome, a refusal never does", async () => {
    const f = await setup();
    try {
      expect(await findOutcomeCredentialGrant(f.h.db, f.item.id, grantItem.itemId, null)).toBeNull();
      const result = (await f.tool(f.request as never, f.context)) as { decisionId: string; status: string };
      expect(result.status).toBe("waiting_for_user");
      expect((await f.h.db.outcomeWorkItem.findUniqueOrThrow({ where: { id: f.item.id } })).status).toBe("waiting_decision");
      // Pending is not a grant.
      expect(await findOutcomeCredentialGrant(f.h.db, f.item.id, grantItem.itemId, null)).toBeNull();
      await f.h.db.run.update({ where: { id: f.source.id }, data: { status: "completed", completedAt: new Date() } });
      await Effect.runPromise(
        f.decisions.resolve(result.decisionId, { optionId: "option-1", expectedContractRevision: 1, clientRequestId: crypto.randomUUID() }, "owner:local"),
      );
      expect(await findOutcomeCredentialGrant(f.h.db, f.item.id, grantItem.itemId, null)).toMatchObject({ itemId: grantItem.itemId });
      // The grant belongs to the Outcome, so another work item of it is covered too.
      const sibling = await f.h.item(2);
      expect(await findOutcomeCredentialGrant(f.h.db, sibling.id, grantItem.itemId, null)).not.toBeNull();
    } finally {
      await f.h.cleanup();
    }
  });

  test("custom text cannot be used to answer a credential approval", async () => {
    const f = await setup();
    try {
      const result = (await f.tool(f.request as never, f.context)) as { decisionId: string };
      const decision = await f.h.db.outcomeDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
      expect(decision.customEntryAllowed).toBe(false);
      expect(decision.reasonCode).toBe("credential_access_required");
    } finally {
      await f.h.cleanup();
    }
  });
});
