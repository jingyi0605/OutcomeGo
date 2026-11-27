import { afterAll, afterEach, beforeAll, expect, setSystemTime, test } from "bun:test";
import type {
  ActOnOutcomeInput, ConvertOutcomeInput, CreateOutcomeAutoAcceptRuleInput, CreateOutcomeInput, OutcomeAutoAcceptRuleView,
  UpdateOutcomeAutoAcceptRuleInput, UpdateOutcomeInput,
} from "@outcomego/contracts/outcomes";
import type { OutcomeTodoAttentionItem } from "@outcomego/contracts/task-overview";
import type { TodoOutcome } from "../src/renderer/components/outcomego/outcomes/dashboard/todo-state";
import { OutcomeGoClientError } from "@outcomego/client-core";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root;
let host: HTMLElement;

// A Wednesday noon in local time, so "today" and "this week" mean the same on every machine and day.
const now = new Date(2026, 10, 25, 12);
const local = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();

beforeAll(async () => {
  setSystemTime(now);
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
  setSystemTime();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const timestamp = "2026-11-25T12:00:00.000Z";
type Status = TodoOutcome["status"];
const todo = (id: string, changes: Partial<TodoOutcome> = {}): TodoOutcome => ({
  id, title: id, kind: "todo", status: "open", executor: "owner", kindMeta: { createdVia: "owner_ui", acceptedBy: "owner" },
  urgency: "normal", botId: null, tags: [], attachments: [], parentOutcomeId: null, currentRevision: null,
  description: "", sourceRef: null, closeSummary: null, dueAt: null, scheduledAt: null,
  snoozeUntil: null, followUpAt: null, revision: 1, updatedAt: timestamp, ...changes,
});
/** What the list endpoint returns: the detail-only fields are missing. */
const summaryOf = ({ description, sourceRef, closeSummary, ...summary }: TodoOutcome): TodoOutcome => summary;
const inView = (item: TodoOutcome, query: URLSearchParams) => {
  const view = query.get("view");
  if (view === "suggestions") return item.status === "suggested";
  if (view === "history") return item.status === "accepted" || item.status === "cancelled";
  return item.status === "open" || item.status === "waiting";
};
const afterAction = (current: TodoOutcome, input: ActOnOutcomeInput): TodoOutcome => {
  const next = { ...current, revision: current.revision + 1 };
  if (input.action === "complete") return { ...next, status: "accepted" };
  if (input.action === "dismiss") return { ...next, status: "cancelled" };
  if (input.action === "snooze") return { ...next, snoozeUntil: input.payload.snoozeUntil };
  return { ...next, status: "open" };
};

async function mount(initial: TodoOutcome[] = [], options: {
  failCreateOnce?: boolean; serverMissing?: boolean; attention?: OutcomeTodoAttentionItem[]; rules?: OutcomeAutoAcceptRuleView[];
} = {}) {
  const { TodoPanel } = await import("../src/renderer/components/outcomego/outcomes/dashboard/todo-panel");
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const creates: CreateOutcomeInput[] = [];
  const changes: Array<{ id: string; input: ActOnOutcomeInput }> = [];
  const updates: Array<{ id: string; input: UpdateOutcomeInput }> = [];
  const ruleCreates: CreateOutcomeAutoAcceptRuleInput[] = [];
  const ruleUpdates: Array<{ id: string; input: UpdateOutcomeAutoAcceptRuleInput }> = [];
  const ruleRemovals: string[] = [];
  let rules = options.rules ?? [];
  const autoAcceptRules = {
    list: async () => ({ rules }),
    create: async (input: CreateOutcomeAutoAcceptRuleInput) => {
      ruleCreates.push(input);
      const rule = ruleFixture({ ...input, id: `rule-${ruleCreates.length}` } as Partial<OutcomeAutoAcceptRuleView>);
      rules = [...rules, rule];
      return rule;
    },
    update: async (id: string, input: UpdateOutcomeAutoAcceptRuleInput) => {
      ruleUpdates.push({ id, input });
      rules = rules.map((rule) => rule.id === id ? { ...rule, ...input } as OutcomeAutoAcceptRuleView : rule);
      return rules.find((rule) => rule.id === id)!;
    },
    remove: async (id: string) => {
      ruleRemovals.push(id);
      rules = rules.filter((rule) => rule.id !== id);
    },
  };
  let items = initial;
  const client = {
    autoAcceptRules,
    list: async (query = "") => {
      if (options.serverMissing) throw new OutcomeGoClientError("Not found", "not_found", 404);
      const params = new URLSearchParams(query);
      if (params.get("kinds") !== "todo") return { items: [], nextCursor: null };
      return { items: items.filter((item) => inView(item, params)).map(summaryOf), nextCursor: null };
    },
    get: async (id: string) => items.find((item) => item.id === id)!,
    create: async (input: CreateOutcomeInput) => {
      creates.push(input);
      if (options.failCreateOnce && creates.length === 1) throw new Error("Connection closed");
      const created = todo(`added-${creates.length}`, { title: input.title, dueAt: input.dueAt ?? null, tags: [...(input.tags ?? [])] });
      items = [created, ...items];
      return { outcome: created, turn: null };
    },
    act: async (id: string, input: ActOnOutcomeInput) => {
      changes.push({ id, input });
      const updated = afterAction(items.find((item) => item.id === id)!, input);
      items = items.map((item) => item.id === id ? updated : item);
      return updated;
    },
    update: async (id: string, input: UpdateOutcomeInput) => {
      updates.push({ id, input });
      items = items.map((item) => item.id === id ? {
        ...item, status: (input.followUpAt ? "waiting" : "open") as Status, followUpAt: input.followUpAt ?? null, revision: item.revision + 1,
      } : item);
      return items.find((item) => item.id === id)!;
    },
  };
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  const { OutcomeDashboard } = await import("../src/renderer/components/outcomego/outcomes/dashboard/outcome-dashboard");
  const nothing = () => undefined;
  const element = options.rules ? createElement((await import("../src/renderer/components/outcomego/settings/todo-auto-accept-rules")).TodoAutoAcceptRules, {
    client: autoAcceptRules,
  }) : options.attention ? createElement(OutcomeDashboard as never, {
    outcomes: { ...client, needsMe: async () => ({
      items: [{ key: "request", title: "Blocked request", botId: "bot", zone: "blocked", state: "needs_owner", since: timestamp, link: { type: "conversation", id: "conversation" } }],
      todos: options.attention?.filter(({ outcome }) => items.some((item) => item.id === outcome.id && item.status === outcome.status)),
      todoDigest: { date: "2026-11-25", counts: { overdue: 1, today: 2, follow_up: 1, suggested: 1 }, titles: ["Digest item"] },
    }) },
    inbox: { list: async () => ({ items: [], nextCursor: null }) }, bots: [],
    onSelectOutcome: nothing, onSelectStep: nothing, onShowSteps: nothing, onShowGoals: nothing, onCreateGoal: nothing, onCreateIdea: nothing,
  }) : createElement(TodoPanel, { client: client as never });
  await act(async () => root.render(createElement(I18nProvider, { children: element })));
  return { creates, changes, updates, ruleCreates, ruleUpdates, ruleRemovals };
}

const routineId = "00000000-0000-4000-8000-000000000001";
const ruleFixture = (changes: Partial<OutcomeAutoAcceptRuleView> = {}): OutcomeAutoAcceptRuleView => ({
  id: "rule-a", name: "Rule alpha", routineId, botId: null, sourceKind: null, enabled: true, matchCount: 2,
  lastMatchedAt: timestamp, createdAt: timestamp, updatedAt: timestamp, ...changes,
});

const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
const typeInto = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
});
const submit = () => act(async () => void host.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
const click = (element: Element) => act(async () => void element.dispatchEvent(new dom.window.Event("click", { bubbles: true })));

test("hands an item to a bot and upgrades it to a goal in place", async () => {
  const { TodoHandoffControls, TodoHandoffProgress } = await import("../src/renderer/components/outcomego/outcomes/dashboard/todo-panel");
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const item = todo("Item alpha", { executor: "bot", botId: "bot", kindMeta: { handoffBotId: "00000000-0000-4000-8000-000000000009" } });
  const actions: Array<{ id: string; input: ActOnOutcomeInput }> = [];
  const conversions: Array<{ id: string; input: ConvertOutcomeInput }> = [];
  const opened: string[] = [];
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  const handoff = {
    bots: [{ id: "bot", name: "Bot" }],
    client: {
      act: async (id: string, input: ActOnOutcomeInput) => { actions.push({ id, input }); return item; },
      convert: async (id: string, input: ConvertOutcomeInput) => { conversions.push({ id, input }); return { outcome: item, turn: null }; },
    } as never,
    change: async (write: () => Promise<unknown>) => { await write(); return true; },
    onSelectOutcome: (id: string) => opened.push(id),
  };
  await act(async () => root.render(createElement(I18nProvider, { children: createElement("div", {},
    createElement(TodoHandoffProgress, { item }), createElement(TodoHandoffControls, { item, actions: handoff, disabled: false })) })));
  expect(host.textContent).toContain("Handed to bot");
  await click(button("Hand to the bot"));
  await submit();
  expect(actions).toEqual([{ id: item.id, input: {
    action: "handoff_to_bot", payload: { botId: "bot", instruction: "Please handle this to-do." }, expectedRevision: 1, clientRequestId: expect.any(String),
  } }]);
  await click(button("Upgrade to goal"));
  await submit();
  expect(conversions).toEqual([{ id: item.id, input: { targetKind: "standard", botId: "bot", expectedRevision: 1, clientRequestId: expect.any(String) } }]);
  expect(opened).toEqual([item.id]);
});

test.each([
  { title: "Item alpha", due: "", tags: "", expected: {} },
  { title: "Item beta", due: "2026-12-02T17:45", tags: "group-a, group-b", expected: { dueAt: new Date("2026-12-02T17:45").toISOString(), tags: ["group-a", "group-b"] } },
])("adds $title with optional fields and clears its composer", async ({ title, due, tags, expected }) => {
  const { creates } = await mount();
  await typeInto(field("New to-do"), ` ${title} `);
  await typeInto(field("Due date"), due);
  await typeInto(field("To-do tags"), tags);
  await submit();
  expect(creates).toEqual([{ kind: "todo", title, ...expected, clientRequestId: expect.any(String) }]);
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
    todo("Dated overdue", { dueAt: local(25, 9) }),
    todo("No deadline"),
    todo("Today item", { dueAt: local(25, 18) }),
    todo("Later this week", { dueAt: local(27) }),
    todo("Follow-up item", { status: "waiting", followUpAt: local(24) }),
    todo("Sleeping item", { dueAt: local(24), snoozeUntil: local(30) }),
    todo("Deferred triage", { status: "suggested" }),
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
  await mount([todo("bot-todo", { title, sourceRef, kindMeta: { createdVia: "agent_turn" }, description: "<script>text</script>" })]);
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
  const request = (action: string, expectedRevision: number) => ({ action, expectedRevision, clientRequestId: expect.any(String) });
  expect(changes).toEqual([{ id: "Item delta", input: request("complete", 7) as never }]);
  expect(host.textContent).not.toContain("Item delta");
  await click(button("Show to-do history"));
  expect(host.textContent).toContain("Item delta");
  await click(button("Restore"));
  expect(changes[1]).toEqual({ id: "Item delta", input: request("restore", 8) as never });
  expect(host.textContent).not.toContain("Item delta");
  await click(button("Show current to-dos"));
  expect(host.textContent).toContain("Item delta");
});

test("snoozing an item moves it out of the current timeline", async () => {
  const { changes } = await mount([todo("Item epsilon", { revision: 3 })]);
  const until = "2099-01-02T17:45";
  await typeInto(host.querySelector<HTMLInputElement>('details input[type="datetime-local"]')!, until);
  await click(button("Snooze to-do"));
  expect(changes).toEqual([{ id: "Item epsilon", input: {
    action: "snooze", payload: { snoozeUntil: new Date(until).toISOString() }, expectedRevision: 3, clientRequestId: expect.any(String),
  } }]);
  expect(host.querySelector('[aria-label="To-do timeline"]')?.textContent).not.toContain("Item epsilon");
  expect(host.textContent).toContain("Item epsilon");
});

test("a server without the to-do API does not show the panel", async () => {
  await mount([], { serverMissing: true });
  expect(host.querySelector("section")).toBeNull();
});

const suggestion = (id: string, title: string, changes: Partial<TodoOutcome> = {}) => todo(id, {
  title, status: "suggested", kindMeta: { createdVia: "agent_turn" }, ...changes,
});

test("triage accepts or dismisses individual suggestions and carries their revisions", async () => {
  const { changes } = await mount([
    suggestion("suggestion-a", "Suggestion alpha", { revision: 5 }),
    suggestion("suggestion-b", "Suggestion beta", { revision: 8 }),
    suggestion("suggestion-c", "Snoozed suggestion", { snoozeUntil: local(30) }),
  ]);
  await click(button("To-do suggestions"));
  expect(host.textContent).not.toContain("Snoozed suggestion");
  await click(button("Accept suggestion"));
  expect(host.textContent).not.toContain("Suggestion alpha");
  await click(button("Dismiss to-do"));
  expect(host.textContent).not.toContain("Suggestion beta");
  expect(changes).toMatchObject([
    { id: "suggestion-a", input: { action: "accept_todo", expectedRevision: 5 } },
    { id: "suggestion-b", input: { action: "dismiss", expectedRevision: 8 } },
  ]);
});

test("triage sends each selected suggestion with the revision the owner saw", async () => {
  const first = suggestion("00000000-0000-4000-8000-000000000001", "Suggestion gamma", { revision: 2 });
  const second = suggestion("00000000-0000-4000-8000-000000000002", "Suggestion delta", { revision: 4 });
  const { changes } = await mount([first, second]);
  await click(button("To-do suggestions"));
  await click(button("Select visible suggestions"));
  await click(button("Accept selected suggestions"));
  expect(changes).toMatchObject([
    { id: first.id, input: { action: "accept_todo", expectedRevision: 2 } },
    { id: second.id, input: { action: "accept_todo", expectedRevision: 4 } },
  ]);
  expect(host.textContent).toContain("No suggestions to review.");
});

test("the authorized message preview is separate plain text from the bot summary", async () => {
  await mount([todo("Item eta", {
    kindMeta: { createdVia: "owner_chat", ownerMessagePreview: "<strong>Owner words</strong>", summary: "<em>Bot summary</em>" },
  })]);
  const preview = host.querySelector("blockquote");
  expect(preview?.textContent).toBe("<strong>Owner words</strong>");
  expect(preview?.children).toHaveLength(0);
  expect(host.textContent).toContain("Your original message");
  expect(host.textContent).toContain("<em>Bot summary</em>");
});

test("waiting requires a follow-up time and can return to open", async () => {
  const { updates } = await mount([todo("Item theta", { revision: 4 })]);
  const followUp = "2099-05-15T11:30";
  await typeInto(field("Follow-up time"), followUp);
  await click(button("Mark as waiting"));
  expect(updates).toEqual([{ id: "Item theta", input: { followUpAt: new Date(followUp).toISOString(), expectedRevision: 4, clientRequestId: expect.any(String) } }]);
  expect(host.querySelector('[aria-label="To-do timeline"]')?.textContent).not.toContain("Item theta");
  await click(button("Stop waiting"));
  expect(updates[1]).toEqual({ id: "Item theta", input: { followUpAt: null, expectedRevision: 5, clientRequestId: expect.any(String) } });
  expect(host.querySelector('[aria-label="To-do timeline"]')?.textContent).toContain("Item theta");
});

test("the unified queue deduplicates to-dos, sorts by section then urgency, and refreshes inline actions", async () => {
  const late = todo("Late item", { dueAt: local(24) });
  const today = todo("Today item", { dueAt: local(25, 18) });
  const follow = todo("Follow item", { status: "waiting", urgency: "high", followUpAt: local(24) });
  const next = suggestion("Suggested item", "Suggested item", { urgency: "high" });
  const attention = (item: TodoOutcome, band: OutcomeTodoAttentionItem["attention"]): OutcomeTodoAttentionItem => ({
    key: `todo:${item.id}`, outcome: item, since: timestamp, urgency: item.urgency, attention: band,
  });
  const { changes } = await mount([late, today, follow, next], { attention: [
    attention(today, "today"), attention(next, "suggested"), attention(late, "overdue"), attention(late, "overdue"), attention(follow, "follow_up"),
  ] });
  const section = host.querySelector('section[aria-label="Needs your action"]')!;
  await click([...section.querySelectorAll("button")].find((item) => item.textContent === "View all")!);
  expect([...section.querySelectorAll(".outcome-row-title")].map((title) => title.textContent)).toEqual([
    "Late item", "Blocked request", "Follow item", "Today item", "Suggested item",
  ]);
  expect(section.querySelector("h2")?.textContent).toContain("5");
  expect(section.textContent).toContain("Digest item");
  expect(host.textContent?.match(/Late item/g)).toHaveLength(1);
  await click([...section.querySelectorAll("button")].find((item) => item.textContent === "Complete")!);
  expect(changes[0]).toMatchObject({ id: late.id, input: { action: "complete", expectedRevision: 1 } });
  expect(section.textContent).not.toContain("Late item");
  expect(section.querySelector("h2")?.textContent).toContain("4");
});

test("rule management requires a routine or bot and supports updating, disabling, and deleting a rule", async () => {
  const { ruleCreates, ruleUpdates, ruleRemovals } = await mount([], { rules: [ruleFixture()] });
  expect(host.textContent).toContain("2 matches");
  expect(host.textContent).toContain("Last match:");
  await click(button("Disable rule"));
  expect(ruleUpdates).toEqual([{ id: "rule-a", input: { enabled: false } }]);
  await click(button("Edit rule"));
  await typeInto(field("Rule name"), "Rule beta");
  await submit();
  expect(ruleUpdates[1]?.input).toMatchObject({ name: "Rule beta", routineId });
  await click(button("New auto-accept rule"));
  await typeInto(field("Rule name"), "Rule gamma");
  await typeInto(field("Source type (optional)"), "kind-opaque");
  await submit();
  expect(ruleCreates).toHaveLength(0);
  await typeInto(field("Routine ID"), routineId);
  await submit();
  expect(ruleCreates[0]).toMatchObject({ name: "Rule gamma", routineId, sourceKind: "kind-opaque" });
  await click(button("Delete rule"));
  await click(button("Confirm rule deletion"));
  expect(ruleRemovals).toEqual(["rule-a"]);
});

test("triage requires confirmation and uses the persisted routine when creating a rule", async () => {
  const { ruleCreates } = await mount([
    suggestion("suggestion-routine", "Routine item", {
      kindMeta: { createdVia: "agent_turn", createdByRoutineId: routineId }, sourceRef: { kind: "opaque", id: "identifier", label: "Label" },
    }),
    suggestion("suggestion-unbound", "Unbound item"),
  ]);
  await click(button("To-do suggestions"));
  expect([...host.querySelectorAll("button")].filter((item) => item.textContent === "Auto-accept from this routine")).toHaveLength(1);
  await click(button("Auto-accept from this routine"));
  expect(ruleCreates).toHaveLength(0);
  await click(button("Confirm auto-accept rule"));
  expect(ruleCreates).toEqual([{ name: expect.any(String), routineId }]);
});

test("an auto-accepted item is labeled and can be dismissed directly", async () => {
  const { changes } = await mount([todo("Item iota", { kindMeta: { acceptedBy: "rule" }, revision: 3 })]);
  expect(host.textContent).toContain("Auto-accepted");
  const dismiss = button("Dismiss to-do");
  expect(dismiss.closest("details")).toBeNull();
  await click(dismiss);
  expect(changes[0]).toMatchObject({ id: "Item iota", input: { action: "dismiss", expectedRevision: 3 } });
  expect(host.textContent).not.toContain("Item iota");
});

test("OutcomeInbox exposes To-dos management (current, suggestions, history) without the inline composer", async () => {
  const { OutcomeInbox } = await import("../src/renderer/components/outcomego/outcomes/inbox/outcome-inbox");
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const listCalls: string[] = [];
  const items = [
    todo("Later this week", { dueAt: local(27) }),
    suggestion("s1", "Suggested work"),
    todo("Finished work", { status: "accepted" }),
  ];
  const todosClient = {
    list: async (query = "") => {
      listCalls.push(query);
      const params = new URLSearchParams(query);
      return { items: items.filter((item) => inView(item, params)).map(summaryOf), nextCursor: null };
    },
    get: async (id: string) => items.find((item) => item.id === id)!,
    create: async () => { throw new Error("unexpected create"); },
    update: async () => items[0]!,
    act: async () => items[0]!,
    convert: async () => ({ outcome: items[0]!, turn: null }),
  } as never;
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(I18nProvider, {
        children: createElement(OutcomeInbox, {
          client: { list: async () => ({ items: [], nextCursor: null }), decision: async () => null, resolve: async () => null },
          todos: todosClient,
          onSelect: () => undefined,
        }),
      })
    )
  );
  await click(button("To-dos"));
  expect(host.querySelector('input[aria-label="New to-do"]')).toBeNull();
  expect(host.textContent).toContain("Later this week");
  await click(button("To-do suggestions"));
  expect(host.textContent).toContain("Suggested work");
  await click(button("Show to-do history"));
  expect(host.textContent).toContain("Finished work");
  expect(listCalls).toEqual([
    "kinds=todo&statuses=open%2Cwaiting", "kinds=todo&view=suggestions", "kinds=todo&view=history",
  ]);
});
