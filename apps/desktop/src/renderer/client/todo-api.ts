import type {
  TodoAction, TodoActionInput, TodoAutoAcceptRuleCreate, TodoAutoAcceptRuleUpdate, TodoAutoAcceptRuleView,
  TodoBulkInput, TodoCreate, TodoItemView, TodoListQuery, TodoListResponse, TodoUpdate,
} from "@outcomego/contracts/todo";

export interface TodoAutoAcceptRulesClient {
  list(): Promise<{ rules: TodoAutoAcceptRuleView[] }>;
  create(input: TodoAutoAcceptRuleCreate): Promise<TodoAutoAcceptRuleView>;
  update(id: string, input: TodoAutoAcceptRuleUpdate): Promise<TodoAutoAcceptRuleView>;
  remove(id: string): Promise<void>;
}

export interface TodoClient {
  list(query: Pick<TodoListQuery, "view" | "cursor">): Promise<TodoListResponse>;
  create(input: TodoCreate): Promise<TodoItemView>;
  act(id: string, action: TodoAction, input: TodoActionInput): Promise<TodoItemView>;
  bulk(input: TodoBulkInput): Promise<{ items: TodoItemView[] }>;
  update(id: string, input: TodoUpdate): Promise<TodoItemView>;
  autoAcceptRules?: TodoAutoAcceptRulesClient;
}

export function createTodoApi(request: <Result>(path: string, init?: RequestInit) => Promise<Result>): TodoClient {
  const path = "/api/todos";
  const rulesPath = `${path}/auto-accept-rules`;
  const post = <Result>(url: string, body: TodoCreate | TodoActionInput | TodoBulkInput | TodoAutoAcceptRuleCreate) =>
    request<Result>(url, { method: "POST", body: JSON.stringify(body) });
  return {
    list: ({ view, cursor }) => {
      const query = new URLSearchParams();
      if (view) query.set("view", view);
      if (cursor) query.set("cursor", cursor);
      return request(query.size ? `${path}?${query}` : path);
    },
    create: (input) => post(path, input),
    act: (id, action, input) => post(`${path}/${encodeURIComponent(id)}/${action}`, input),
    bulk: (input) => post(`${path}/bulk`, input),
    update: (id, input) => request(`${path}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
    autoAcceptRules: {
      list: () => request(rulesPath),
      create: (input) => post(rulesPath, input),
      update: (id, input) => request(`${rulesPath}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
      remove: (id) => request(`${rulesPath}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    },
  };
}
