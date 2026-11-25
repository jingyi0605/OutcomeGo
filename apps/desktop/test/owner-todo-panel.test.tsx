import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { TodoActionInput, TodoBulkInput, TodoCreate, TodoItemView } from "@outcomego/contracts/todo";
import { OutcomeGoClientError } from "@outcomego/client-core";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root;
let host: HTMLElement;

beforeAll(async () => {
  Object.assign(dom.document, { oninput: null });
  Object.assign(dom.window.HTMLElement.prototype, { getClientRects: () => [] });
  Object.assign(dom.window, { matchMedia: () => ({ matches: false }) });
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const storage = new Map<string, string>();
  Object.defineProperty(dom.window, "localStorage", { value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  Object.defineProperty(dom.window, "navigator", { value: { language: "en" } });
  ({ createRoot } = await import("react-dom/client"));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const timestamp = "2026-11-25T12:00:00.000Z";
const todo = (id: string, changes: Partial<TodoItemView> = {}): TodoItemView => ({
  id, title: id, note: null, status: "open", executor: "owner", createdVia: "owner_ui", createdBy: "owner",
  createdByRunId: null, createdByRoutineId: null, authorizedByMessageId: null, ownerMessagePreview: null, acceptedBy: "owner", autoAcceptRuleId: null,
  urgency: "normal", sourceRef: null, summary: null, botId: null, tags: [], dueAt: null, scheduledAt: null,
  snoozeUntil: null, followUpAt: null, linkedOutcomeId: null, handoffBotId: null, handoffMessageId: null, expiresAt: null,
  completedAt: null, completionNote: null, dismissedAt: null, dismissReason: null, revision: 1,
  createdAt: timestamp, updatedAt: timestamp, displayState: "unscheduled", overdue: false, ...changes,
});

async function mount(initial: TodoItemView[] = [], options: { failCreateOnce?: boolean; serverMissing?: boolean } = {}) {
  const { TodoPanel } = await import("../src/renderer/components/outcomego/outcomes/dashboard/todo-panel");
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const creates: TodoCreate[] = [];
  const changes: Array<{ id: string; action: string; input: TodoActionInput }> = [];
  const batches: TodoBulkInput[] = [];
  let items = initial;
  const client = {
    list: async ({ view }: { view?: string }) => {
      if (options.serverMissing) throw new OutcomeGoClientError("Not found", "not_found", 404);
      return {
        items: items.filter((item) => view === "suggestions" ? item.status === "suggested" :
          (item.status === "done" || item.status === "dismissed") === (view === "history")),
        nextCursor: null,
      };
    },
    create: async (input: TodoCreate) => {
      creates.push(input);
      if (options.failCreateOnce && creates.length === 1) throw new Error("Connection closed");
      const created = todo(`added-${creates.length}`, { title: input.title, dueAt: input.dueAt ?? null, tags: input.tags ?? [] });
      items = [created, ...items];
      return created;
    },
    act: async (id: string, action: string, input: TodoActionInput) => {
      changes.push({ id, action, input });
      const current = items.find((item) => item.id === id)!;
      const updates = { ...current, revision: current.revision + 1 };
      const updated: TodoItemView = action === "complete"
        ? { ...updates, status: "done", displayState: "done" }
        : action === "dismiss"
          ? { ...updates, status: "dismissed", displayState: "dismissed" }
          : action === "snooze"
          ? { ...updates, displayState: "snoozed", snoozeUntil: input.snoozeUntil ?? null }
          : { ...updates, status: "open", displayState: "unscheduled" };
      items = items.map((item) => item.id === id ? updated : item);
      return updated;
    },
    bulk: async (input: TodoBulkInput) => {
      batches.push(input);
      const changed = items.filter((item) => input.action === "dismissBot" ? item.botId === input.botId : input.items.some(({ id }) => item.id === id));
      const updated: TodoItemView[] = changed.map((item) => ({
        ...item, revision: item.revision + 1, status: input.action === "accept" ? "open" : "dismissed",
        displayState: input.action === "accept" ? "unscheduled" : "dismissed",
      }));
      items = [...items.filter((item) => !changed.includes(item)), ...updated];
      return { items: updated };
    },
  };
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(I18nProvider, { children: createElement(TodoPanel, { client }) })));
  return { creates, changes, batches };
}

const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
const typeInto = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
const submit = () => act(async () => void host.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
const click = (element: Element) => act(async () => void element.dispatchEvent(new dom.window.Event("click", { bubbles: true })));

test.each([
  { title: "Item alpha", due: "", tags: "", expected: {} },
  { title: "Item beta", due: "2026-12-02T17:45", tags: "group-a, group-b", expected: { dueAt: new Date("2026-12-02T17:45").toISOString(), tags: ["group-a", "group-b"] } },
])("adds $title with optional fields and clears its composer", async ({ title, due, tags, expected }) => {
  const { creates } = await mount();
  await typeInto(field("New to-do"), ` ${title} `);
  await typeInto(field("Due date"), due);
  await typeInto(field("To-do tags"), tags);
  await submit();
  expect(creates).toEqual([{ title, ...expected, clientRequestId: expect.any(String) }]);
  expect(host.textContent).toContain(title);
  expect(field("New to-do").value).toBe("");
});

test("retries an unchanged creation with the same idempotency key", async () => {
  const { creates } = await mount([], { failCreateOnce: true });
  await typeInto(field("New to-do"), "Item gamma");
  await submit();
  expect(field("New to-do").value).toBe("Item gamma");
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await submit();
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual(creates[0]);
});

test("groups each active item once and excludes snoozed items from the timeline", async () => {
  await mount([
    todo("Dated overdue", { dueAt: timestamp, displayState: "today", overdue: true }),
    todo("No deadline", { overdue: true }),
    todo("Today item", { dueAt: timestamp, displayState: "today" }),
    todo("Later this week", { dueAt: timestamp, displayState: "this_week" }),
    todo("Follow-up item", { status: "waiting", displayState: "follow_up", followUpAt: timestamp }),
    todo("Sleeping item", { dueAt: timestamp, overdue: true, displayState: "snoozed" }),
    todo("Deferred triage", { status: "suggested", displayState: "suggested" }),
  ]);
  const timeline = host.querySelector('[aria-label="To-do timeline"]')!;
  expect([...timeline.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["Overdue", "Today", "Needs follow-up", "This week", "No date"]);
  expect(timeline.textContent).not.toContain("Sleeping item");
  expect(host.textContent).toContain("Sleeping item");
  expect(host.textContent).not.toContain("Deferred triage");
  expect(timeline.querySelector('[aria-label="No date"]')?.textContent).toContain("No deadline");
});

test.each([
  { kind: "kind-1", id: "opaque-1", label: "<img src='one'>", title: "<b>Alpha</b>" },
  { kind: "kind-2", id: "opaque-2", label: "https://example.invalid/path", title: "<i>Beta</i>" },
])("renders opaque bot text as text for $kind", async ({ title, ...sourceRef }) => {
  await mount([todo("bot-todo", { title, sourceRef, createdVia: "agent_turn", note: "<script>text</script>" })]);
  const timeline = host.querySelector('[aria-label="To-do timeline"]')!;
  expect(timeline.textContent).toContain(title);
  expect(timeline.textContent).toContain(sourceRef.label);
  expect(timeline.textContent).toContain("<script>text</script>");
  expect(timeline.textContent).toContain("Written by the bot");
  expect(timeline.querySelector("a, img, script, b, i")).toBeNull();
});

test("completes with the current revision, then shows and restores the item in history", async () => {
  const { changes } = await mount([todo("Item delta", { revision: 7 })]);
  await click(button("Complete"));
  expect(changes).toEqual([{ id: "Item delta", action: "complete", input: { revision: 7 } }]);
  expect(host.textContent).not.toContain("Item delta");
  await click(button("Show to-do history"));
  expect(host.textContent).toContain("Item delta");
  await click(button("Restore"));
  expect(changes[1]).toEqual({ id: "Item delta", action: "restore", input: { revision: 8 } });
  expect(host.textContent).not.toContain("Item delta");
  await click(button("Show current to-dos"));
  expect(host.textContent).toContain("Item delta");
});

test("snoozing an item moves it out of the current timeline", async () => {
  const { changes } = await mount([todo("Item epsilon", { revision: 3 })]);
  const local = "2099-01-02T17:45";
  await typeInto(host.querySelector<HTMLInputElement>('details input[type="datetime-local"]')!, local);
  await click(button("Snooze to-do"));
  expect(changes).toEqual([{ id: "Item epsilon", action: "snooze", input: { revision: 3, snoozeUntil: new Date(local).toISOString() } }]);
  expect(host.querySelector('[aria-label="To-do timeline"]')?.textContent).not.toContain("Item epsilon");
  expect(host.textContent).toContain("Item epsilon");
});

test("a server without the to-do API does not show the panel", async () => {
  await mount([], { serverMissing: true });
  expect(host.querySelector("section")).toBeNull();
});

const suggestion = (id: string, title: string, changes: Partial<TodoItemView> = {}) => todo(id, {
  title, status: "suggested", displayState: "suggested", acceptedBy: null, createdVia: "agent_turn", ...changes,
});

test("triage accepts or dismisses individual suggestions and carries their revisions", async () => {
  const { changes } = await mount([
    suggestion("suggestion-a", "Suggestion alpha", { revision: 5 }),
    suggestion("suggestion-b", "Suggestion beta", { revision: 8 }),
    suggestion("suggestion-c", "Snoozed suggestion", { displayState: "snoozed" }),
  ]);
  await click(button("To-do suggestions"));
  expect(host.textContent).not.toContain("Snoozed suggestion");
  await click(button("Accept suggestion"));
  expect(host.textContent).not.toContain("Suggestion alpha");
  await click(button("Dismiss to-do"));
  expect(host.textContent).not.toContain("Suggestion beta");
  expect(changes).toEqual([
    { id: "suggestion-a", action: "accept", input: { revision: 5 } },
    { id: "suggestion-b", action: "dismiss", input: { revision: 8 } },
  ]);
});

test("triage sends the selected suggestions as a single revisioned batch", async () => {
  const first = suggestion("00000000-0000-4000-8000-000000000001", "Suggestion gamma", { revision: 2 });
  const second = suggestion("00000000-0000-4000-8000-000000000002", "Suggestion delta", { revision: 4 });
  const { batches } = await mount([first, second]);
  await click(button("To-do suggestions"));
  await click(button("Select visible suggestions"));
  await click(button("Accept selected suggestions"));
  expect(batches).toEqual([{ action: "accept", items: [{ id: first.id, revision: 2 }, { id: second.id, revision: 4 }] }]);
  expect(host.textContent).toContain("No suggestions to review.");
});

test("the authorized message preview is separate plain text from the bot summary", async () => {
  await mount([todo("Item eta", {
    createdVia: "owner_chat", authorizedByMessageId: "message-1", ownerMessagePreview: "<strong>Owner words</strong>", summary: "<em>Bot summary</em>",
  })]);
  const preview = host.querySelector("blockquote");
  expect(preview?.textContent).toBe("<strong>Owner words</strong>");
  expect(preview?.children).toHaveLength(0);
  expect(host.textContent).toContain("Your original message");
  expect(host.textContent).toContain("<em>Bot summary</em>");
});
