import { ApiError } from "@outcomego/contracts";
import { humanActionInputSchema } from "@outcomego/contracts/human-work";
import type { PrismaClient } from "@outcomego/db";
import type { HumanWorkService } from "./human-work-service";
import type { OutcomeThreadToolHandler } from "./internal-tool-service";
import { mapOutcomeError } from "./outcome-write";

export const humanActionTool = (prisma: PrismaClient, service: HumanWorkService): OutcomeThreadToolHandler =>
  async (request, context) => {
    const parsed = humanActionInputSchema.safeParse(request.arguments);
    if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid RequestHumanAction arguments", parsed.error.flatten());
    try {
      const result = await prisma.$transaction(tx => service.createFromAgentRequest(tx, {
        runId: context.runId, workItemId: context.workItemId, input: parsed.data,
      }), { timeout: 30_000 });
      const detail = await service.detail(result.workItemId);
      return {
        ...result, status: "waiting_human", waiting_for_human: true, end_turn: true,
        knowledge: detail.card?.references.map(reference => ({
          referenceId: reference.id, sourceRef: reference.sourceRef, version: reference.version,
          digest: reference.digest, excerpt: reference.excerpt?.slice(0, 500),
        })) ?? [],
      };
    } catch (error) { throw mapOutcomeError(error); }
  };
