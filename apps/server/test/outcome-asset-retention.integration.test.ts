import { afterAll, describe, expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { AssetStore } from "@outcomego/messaging";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppService } from "../src/app-service";
import { HumanWorkService } from "../src/services/human-work-service";
import { HumanReceiptService } from "../src/services/human-receipt-service";
import { humanActionScenario, humanWorkScenario } from "./human-work-fixtures";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;

describe.skipIf(!url)("durable Outcome asset retention", () => {
  const prisma = createPrismaClient(url!);
  afterAll(() => prisma.$disconnect());

  test("normal cleanup retains receipt history, Evidence and knowledge snapshots while pruning old orphans", async () => {
    const service = new HumanWorkService(prisma, { resolve: async () => [] });
    const f = await humanWorkScenario(prisma, service);
    const root = await mkdtemp(join(tmpdir(), "outcomego-durable-assets-"));
    const assets = new AssetStore({ root });
    const channel = await prisma.channel.create({ data: { name: "Synthetic asset retention", kind: "bot_dm" } });
    try {
      const names = ["submitted", "accepted", "rejected", "evidence", "card", "receipt-source", "message", "orphan", "recent", "malformed"] as const;
      const refs = Object.fromEntries(await Promise.all(names.map(async name => [
        name, await assets.ingestBytes({ fileName: `${name}.log`, bytes: Buffer.from(`Synthetic ${name} material`) }),
      ]))) as Record<typeof names[number], { assetId: string }>;
      const linkedRef = (assetId: string) => `file:${crypto.randomUUID()}:0:asset:${assetId}`;
      for (const [index, status] of (["submitted", "accepted", "rejected"] as const).entries()) {
        await prisma.outcomeHumanReceipt.create({ data: {
          outcomeId: f.outcome.id, workItemId: f.card.workItemId, sequence: index + 1,
          status, submittedBy: "owner:local", payload: {}, assetRefs: [`asset:${refs[status].assetId}`],
        } });
      }
      await prisma.outcomeHumanReceipt.update({
        where: { workItemId_sequence: { workItemId: f.card.workItemId, sequence: 1 } },
        data: {
          payload: { references: [{ sourceRef: linkedRef(refs["receipt-source"].assetId) }] },
          assetRefs: [
            `asset:${refs.submitted.assetId}`,
            `invalid:asset:${refs.malformed.assetId}`,
            42,
          ],
        },
      });
      await prisma.outcomeEvidence.create({ data: {
        outcomeId: f.outcome.id, contractRevisionId: f.revision.id, sourceType: "asset",
        sourceRef: `asset:${refs.evidence.assetId}`, credibility: "human_confirmed", capturedBy: "owner:local",
      } });
      await prisma.outcomeHumanActionCard.update({
        where: { workItemId: f.card.workItemId },
        data: { references: [{ sourceType: "file", sourceRef: linkedRef(refs.card.assetId) }] },
      });
      await prisma.channelMessage.create({ data: {
        channelId: channel.id, sender: "user", content: "Synthetic message attachment",
        metadata: { attachments: [{ assetId: refs.message.assetId }] },
      } });
      const old = new Date(Date.now() - 25 * 60 * 60_000);
      await Promise.all(names.filter(name => name !== "recent").flatMap(name =>
        [".blob", ".json"].map(extension => utimes(join(root, `${refs[name].assetId}${extension}`), old, old))
      ));
      // Exercise the actual maintenance method without constructing or starting application services.
      const app = Object.assign(Object.create(AppService.prototype), {
        prisma, assets,
      }) as { pruneUnreferencedAssets(): Promise<void> };
      await app.pruneUnreferencedAssets();
      for (const name of names.filter(name => name !== "orphan" && name !== "malformed")) {
        expect(await assets.metadata(refs[name].assetId)).toMatchObject({ assetId: refs[name].assetId });
      }
      for (const name of ["orphan", "malformed"] as const) {
        await expect(assets.metadata(refs[name].assetId)).rejects.toMatchObject({ code: "asset_not_found" });
      }
    } finally {
      await prisma.bot.delete({ where: { id: f.bot.id } });
      await prisma.channel.delete({ where: { id: channel.id } });
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a real receipt committed after the cleanup snapshot retains its old asset", async () => {
    const knowledge = { resolve: async () => [] };
    const humanWork = new HumanWorkService(prisma, knowledge);
    const f = await humanActionScenario(prisma, humanWork);
    try {
      const card = await prisma.$transaction(tx => humanWork.createFromAgentRequest(tx, {
        runId: f.run.id, workItemId: f.agent.id, input: {
          ...f.cardInput.card,
          evidenceRequirements: [{ criterionOrdinal: 1, label: "Observed log", kind: "asset" }],
        },
      }));
      await humanWork.start(card.workItemId, {
        expectedContractRevision: 1, clientRequestId: crypto.randomUUID(),
      }, "owner:local");
      const ref = await f.assets.ingestBytes({ fileName: "observed.log", bytes: Buffer.from("Synthetic race log") });
      const old = new Date(Date.now() - 25 * 60 * 60_000);
      await Promise.all([".blob", ".json"].map(extension =>
        utimes(join(f.assets.root, `${ref.assetId}${extension}`), old, old)
      ));
      let snapshotReached!: () => void;
      const snapshot = new Promise<void>(resolve => { snapshotReached = resolve; });
      let releasePrune!: () => void;
      const receiptCommitted = new Promise<void>(resolve => { releasePrune = resolve; });
      const realPrune = f.assets.prune.bind(f.assets);
      f.assets.prune = async (...args: Parameters<AssetStore["prune"]>) => {
        expect(args[0].has(ref.assetId)).toBe(false);
        snapshotReached();
        await receiptCommitted;
        return realPrune(...args);
      };
      const app = Object.assign(Object.create(AppService.prototype), {
        prisma, assets: f.assets,
      }) as { pruneUnreferencedAssets(): Promise<void> };
      const pruning = app.pruneUnreferencedAssets();
      await snapshot;
      let receipt;
      try {
        receipt = await new HumanReceiptService(prisma, f.assets, knowledge, f.messaging).submit(card.workItemId, {
          expectedContractRevision: 1, clientRequestId: crypto.randomUUID(),
          assetRefs: [`asset:${ref.assetId}`],
        }, "owner:local");
      } finally {
        releasePrune();
      }
      await pruning;
      expect(receipt.evidenceIds).toHaveLength(1);
      expect(await prisma.outcomeHumanReceipt.findUniqueOrThrow({ where: { id: receipt.id } }))
        .toMatchObject({ status: "submitted", assetRefs: [`asset:${ref.assetId}`] });
      expect(await f.assets.metadata(ref.assetId)).toMatchObject({ assetId: ref.assetId });
    } finally {
      await f.cleanup();
    }
  });

  test("the cleanup lock remains held through unlink so a receipt cannot publish a deleted asset", async () => {
    const knowledge = { resolve: async () => [] };
    const humanWork = new HumanWorkService(prisma, knowledge);
    const f = await humanActionScenario(prisma, humanWork);
    let releaseRemove!: () => void;
    try {
      const card = await prisma.$transaction(tx => humanWork.createFromAgentRequest(tx, {
        runId: f.run.id, workItemId: f.agent.id, input: {
          ...f.cardInput.card,
          evidenceRequirements: [{ criterionOrdinal: 1, label: "Observed log", kind: "asset" }],
        },
      }));
      await humanWork.start(card.workItemId, {
        expectedContractRevision: 1, clientRequestId: crypto.randomUUID(),
      }, "owner:local");
      const ref = await f.assets.ingestBytes({ fileName: "old.log", bytes: Buffer.from("Synthetic deletion barrier") });
      const old = new Date(Date.now() - 25 * 60 * 60_000);
      await Promise.all([".blob", ".json"].map(extension =>
        utimes(join(f.assets.root, `${ref.assetId}${extension}`), old, old)
      ));
      let beforeRemove!: () => void;
      const removing = new Promise<void>(resolve => { beforeRemove = resolve; });
      const mayRemove = new Promise<void>(resolve => { releaseRemove = resolve; });
      const realPrune = f.assets.prune.bind(f.assets);
      f.assets.prune = (referenced, grace, guard) => {
        if (!guard) throw new Error("Application cleanup must guard publication through unlink");
        return realPrune(referenced, grace, (assetId, remove) => guard(assetId, async () => {
          beforeRemove();
          await mayRemove;
          return remove();
        }));
      };
      const app = Object.assign(Object.create(AppService.prototype), {
        prisma, assets: f.assets,
      }) as { pruneUnreferencedAssets(): Promise<void> };
      const pruning = app.pruneUnreferencedAssets();
      await removing;
      const submitting = new HumanReceiptService(prisma, f.assets, knowledge, f.messaging).submit(card.workItemId, {
        expectedContractRevision: 1, clientRequestId: crypto.randomUUID(), assetRefs: [`asset:${ref.assetId}`],
      }, "owner:local").then(() => null, error => error as { code: string });
      const lockKey = `human-receipt-asset:asset:${ref.assetId}`;
      let waiting = false;
      for (const deadline = Date.now() + 2_000; Date.now() < deadline && !waiting;) {
        const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
              AND objid = ((hashtext(${lockKey})::bigint & 4294967295)::oid)
          ) AS waiting`;
        waiting = row?.waiting ?? false;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      expect(await prisma.outcomeHumanReceipt.count({ where: { workItemId: card.workItemId } })).toBe(0);
      releaseRemove();
      await pruning;
      expect(await submitting).toMatchObject({ code: "receipt_asset_not_found" });
      expect(await prisma.outcomeHumanReceipt.count({ where: { workItemId: card.workItemId } })).toBe(0);
      await expect(f.assets.metadata(ref.assetId)).rejects.toMatchObject({ code: "asset_not_found" });
    } finally {
      releaseRemove?.();
      await f.cleanup();
    }
  });
});
