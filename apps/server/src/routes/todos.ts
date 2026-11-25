import { ApiError } from "@outcomego/contracts";
import { TodoAction, TodoActionInput, TodoAutoAcceptRuleCreate, TodoAutoAcceptRuleUpdate, TodoBulkInput, TodoCreate, TodoId, TodoListQuery, TodoUpdate } from "@outcomego/contracts/todo";
import { json } from "../http";
import type { OwnerTodoService } from "../services/owner-todo-service";
import type { RouteContext } from "./context";

function parse<Value>(schema: { safeParse(input: unknown): { success: true; data: Value } | { success: false; error: { flatten(): unknown } } }, input: unknown): Value {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, "invalid_request", "Todo input failed validation", result.error.flatten());
  return result.data;
}

export const createTodoRoutes = (todos: OwnerTodoService) => async (context: RouteContext): Promise<Response | undefined> => {
  const { request, url, path, authMode, authenticatedSessionId } = context;
  const list = path === "/api/todos";
  const match = path.match(/^\/api\/todos\/([^/]+)(?:\/([^/]+))?$/);
  if (!list && !match) return undefined;
  const ownerId = await todos.ownerForSession(authMode, authenticatedSessionId);
  const body = () => request.json().catch(() => null);
  if (match?.[1] === "auto-accept-rules") {
    if (!match[2] && request.method === "GET") return json(await todos.listAutoAcceptRules(ownerId));
    if (!match[2] && request.method === "POST") return json(await todos.createAutoAcceptRule(ownerId, parse(TodoAutoAcceptRuleCreate, await body())), 201);
    if (match[2] && request.method === "PATCH") return json(await todos.updateAutoAcceptRule(ownerId, parse(TodoId, match[2]), parse(TodoAutoAcceptRuleUpdate, await body())));
    if (match[2] && request.method === "DELETE") {
      await todos.deleteAutoAcceptRule(ownerId, parse(TodoId, match[2]));
      return new Response(null, { status: 204 });
    }
    return undefined;
  }
  if (list && request.method === "GET") return json(await todos.list(ownerId, parse(TodoListQuery, Object.fromEntries(url.searchParams))));
  if (list && request.method === "POST") return json(await todos.create(ownerId, parse(TodoCreate, await body())), 201);
  if (path === "/api/todos/bulk" && request.method === "POST") return json(await todos.bulk(ownerId, parse(TodoBulkInput, await body())));
  if (!match) return undefined;
  const id = parse(TodoId, match[1]);
  if (!match[2] && request.method === "GET") return json(await todos.detail(ownerId, id));
  if (!match[2] && request.method === "PATCH") return json(await todos.update(ownerId, id, parse(TodoUpdate, await body())));
  if (match[2] && request.method === "POST") {
    const action = parse(TodoAction, match[2]);
    return json(await todos.act(ownerId, id, action, parse(TodoActionInput[action], await body())));
  }
  return undefined;
};
