import type { TodoAction, TodoActionInput, TodoCreate, TodoItemView, TodoListQuery, TodoListResponse } from "@outcomego/contracts/todo";

export interface TodoClient {
  list(query: Pick<TodoListQuery, "view" | "cursor">): Promise<TodoListResponse>;
  create(input: TodoCreate): Promise<TodoItemView>;
  act(id: string, action: TodoAction, input: TodoActionInput): Promise<TodoItemView>;
}

export function createTodoApi(request: <Result>(path: string, init?: RequestInit) => Promise<Result>): TodoClient {
  const path = "/api/todos";
  const post = (url: string, body: TodoCreate | TodoActionInput) =>
    request<TodoItemView>(url, { method: "POST", body: JSON.stringify(body) });
  return {
    list: ({ view, cursor }) => {
      const query = new URLSearchParams();
      if (view) query.set("view", view);
      if (cursor) query.set("cursor", cursor);
      return request(query.size ? `${path}?${query}` : path);
    },
    create: (input) => post(path, input),
    act: (id, action, input) => post(`${path}/${encodeURIComponent(id)}/${action}`, input),
  };
}
