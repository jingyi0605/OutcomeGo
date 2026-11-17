import { ApiError } from "@outcomego/contracts";
import { humanWorkMutationSchema, humanWorkPauseSchema } from "@outcomego/contracts/human-work";
import { AGENT_WORK_ITEM_STATUSES, HUMAN_WORK_ITEM_STATUSES, type WorkItemExecutorType, type WorkItemStatus } from "@outcomego/contracts/outcomes";
import type { ActorRef } from "@outcomego/messaging";
import { json } from "../http";
import type { HumanWorkService } from "../services/human-work-service";
import type { RouteContext } from "./context";

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
const actorFor = async (context: RouteContext): Promise<ActorRef> => {
  if (!context.authenticatedSessionId) return "owner:local";
  const session = await context.app.prisma.session.findUnique({
    where: { id: context.authenticatedSessionId }, select: { userId: true },
  });
  if (!session) throw new ApiError(401, "unauthorized", "The session no longer exists");
  return `user:${session.userId}`;
};

/** The existing server authentication middleware runs before this dispatcher. */
export async function humanWorkRoutes(context: RouteContext, service: HumanWorkService): Promise<Response | undefined> {
  const { path, request, url } = context;
  const list = path.match(/^\/api\/outcomes\/([^/]+)\/work-items$/);
  if (request.method === "GET" && list?.[1]) {
    const status = url.searchParams.get("status") ?? undefined;
    const executorType = url.searchParams.get("executorType") ?? undefined;
    if (status && !([...AGENT_WORK_ITEM_STATUSES, ...HUMAN_WORK_ITEM_STATUSES] as readonly string[]).includes(status))
      throw new ApiError(400, "invalid_request", "Invalid WorkItem status");
    if (executorType && !["agent", "human"].includes(executorType))
      throw new ApiError(400, "invalid_request", "Invalid executor type");
    return json(await service.list(uuid(list[1]), { status: status as WorkItemStatus, executorType: executorType as WorkItemExecutorType }));
  }
  const item = path.match(/^\/api\/work-items\/([^/]+)(?:\/(start|pause))?$/);
  if (!item?.[1]) return undefined;
  const id = uuid(item[1]);
  if (request.method === "GET" && !item[2]) return json(await service.detail(id));
  if (request.method === "POST" && item[2] === "start") {
    const input = await body(request, humanWorkMutationSchema);
    return json(await service.start(id, input, await actorFor(context)));
  }
  if (request.method === "POST" && item[2] === "pause") {
    const input = await body(request, humanWorkPauseSchema);
    return json(await service.pause(id, input, await actorFor(context)));
  }
  return undefined;
}
