import { ApiError } from "@outcomego/contracts";
import { humanWorkMutationSchema, humanWorkPauseSchema, humanReceiptSchema, humanKnowledgeSearchSchema } from "@outcomego/contracts/human-work";
import { AGENT_WORK_ITEM_STATUSES, HUMAN_WORK_ITEM_STATUSES, type WorkItemExecutorType, type WorkItemStatus } from "@outcomego/contracts/outcomes";
import { json } from "../http";
import type { HumanWorkService } from "../services/human-work-service";
import type { HumanReceiptService } from "../services/human-receipt-service";
import type { HumanKnowledgeService } from "../services/human-knowledge-service";
import type { RouteContext } from "./context";
import { outcomeOwner, requireOutcomeOwner } from "./outcome-owner";

const uuid = (value: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new ApiError(400, "invalid_request", "Invalid WorkItem or Outcome ID");
  return value;
};
const body = async <T>(request: Request, schema: {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { flatten(): unknown } };
}): Promise<T> => {
  let value: unknown;
  try { value = await request.json(); }
  catch { throw new ApiError(400, "invalid_json", "Request body must be valid JSON"); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid human work request", parsed.error.flatten());
  return parsed.data;
};
/** The existing server authentication middleware runs before this dispatcher. */
export async function humanWorkRoutes(context: RouteContext, service: HumanWorkService, dependencies?: {
  humanReceipts: HumanReceiptService; knowledge: HumanKnowledgeService;
}): Promise<Response | undefined> {
  const { path, request, url } = context;
  const knowledge = path.match(/^\/api\/outcomes\/([^/]+)\/knowledge\/(search|read)$/);
  if (request.method === "POST" && knowledge?.[1]) {
    if (!dependencies) throw new ApiError(503, "manual_action_unavailable", "Knowledge support has not been registered");
    const outcomeId = uuid(knowledge[1]);
    const { ownerId } = await outcomeOwner(context);
    await requireOutcomeOwner(context, outcomeId, ownerId);
    if (knowledge[2] === "search")
      return json(await dependencies.knowledge.search(outcomeId, await body(request, humanKnowledgeSearchSchema)));
    let value: unknown;
    try { value = await request.json(); }
    catch { throw new ApiError(400, "invalid_json", "Request body must be valid JSON"); }
    return json(await dependencies.knowledge.read(outcomeId, (value as { reference?: unknown } | null)?.reference));
  }
  const list = path.match(/^\/api\/outcomes\/([^/]+)\/work-items$/);
  if (request.method === "GET" && list?.[1]) {
    const outcomeId = uuid(list[1]);
    const { ownerId } = await outcomeOwner(context);
    await requireOutcomeOwner(context, outcomeId, ownerId);
    const status = url.searchParams.get("status") ?? undefined;
    const executorType = url.searchParams.get("executorType") ?? undefined;
    if (status && !([...AGENT_WORK_ITEM_STATUSES, ...HUMAN_WORK_ITEM_STATUSES] as readonly string[]).includes(status))
      throw new ApiError(400, "invalid_request", "Invalid WorkItem status");
    if (executorType && !["agent", "human"].includes(executorType))
      throw new ApiError(400, "invalid_request", "Invalid executor type");
    return json(await service.list(outcomeId, { status: status as WorkItemStatus, executorType: executorType as WorkItemExecutorType }));
  }
  const item = path.match(/^\/api\/work-items\/([^/]+)(?:\/(start|pause|receipts))?$/);
  if (!item?.[1]) return undefined;
  if ((!item[2] && request.method !== "GET") || (item[2] && request.method !== "POST")) return undefined;
  const id = uuid(item[1]);
  const { ownerId, actor } = await outcomeOwner(context);
  const owned = await context.app.prisma.outcomeWorkItem.findFirst({ where: { id, outcome: { ownerId } }, select: { id: true } });
  if (!owned) throw new ApiError(404, "work_item_not_found", "Work item not found");
  if (request.method === "GET" && !item[2]) return json(await service.detail(id));
  if (request.method === "POST" && item[2] === "start") {
    const input = await body(request, humanWorkMutationSchema);
    return json(await service.start(id, input, actor));
  }
  if (request.method === "POST" && item[2] === "pause") {
    const input = await body(request, humanWorkPauseSchema);
    return json(await service.pause(id, input, actor));
  }
  if (request.method === "POST" && item[2] === "receipts") {
    if (!dependencies) throw new ApiError(503, "manual_action_unavailable", "Receipt support has not been registered");
    return json(await dependencies.humanReceipts.submit(id, await body(request, humanReceiptSchema), actor), 201);
  }
  return undefined;
}
