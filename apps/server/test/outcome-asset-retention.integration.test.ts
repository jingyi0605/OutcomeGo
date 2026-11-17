import { afterAll, describe, expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { AssetStore } from "@outcomego/messaging";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppService } from "../src/app-service";
import { HumanWorkService } from "../src/services/human-work-service";
import { humanWorkScenario } from "./human-work-fixtures";

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
      let planningPrunes = 0;
      // Exercise the actual maintenance method without constructing or starting application services.
      const app = Object.assign(Object.create(AppService.prototype), {
        prisma, assets, outcomePlanning: { pruneExpired: async () => { planningPrunes += 1; } },
      }) as { pruneUnreferencedAssets(): Promise<void> };
      await app.pruneUnreferencedAssets();
      expect(planningPrunes).toBe(1);
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
});
