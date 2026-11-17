import type { PrismaClient } from "@outcomego/db";
import type { AgentDataStore, AgentMessaging, AssetStore } from "@outcomego/messaging";
import { humanActionTool } from "./human-action-tool";
import { HumanKnowledgeService } from "./human-knowledge-service";
import { HumanReceiptService } from "./human-receipt-service";
import { HumanWorkService } from "./human-work-service";

/** AppService owns this production assembly; no fixture provider is registered. */
export const createHumanWorkServices = (
  prisma: PrismaClient, messaging: AgentMessaging,
  agentData: Pick<AgentDataStore, "root" | "botDirectory">,
  assets: Pick<AssetStore, "metadata" | "contentPath">,
) => {
  const knowledge = new HumanKnowledgeService(prisma, agentData, assets);
  const humanWork = new HumanWorkService(prisma, knowledge, assets);
  const humanReceipts = new HumanReceiptService(prisma, assets, knowledge, messaging);
  return { knowledge, humanWork, humanReceipts, humanActionTool: humanActionTool(prisma, humanWork) };
};
