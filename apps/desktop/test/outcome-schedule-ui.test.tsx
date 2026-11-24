import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "react-dom/client";
import type { WorkItemView } from "@outcomego/contracts/outcomes";
import { PLAN_ESTIMATE_MINUTES } from "@outcomego/contracts/outcomes";

// Specs/004.10 task 3.2 (requirements C7 and C8): changing a task's schedule and the goal's due date in the interface.
// The save call is replaced, so no request leaves the test. Fixtures are scenario-neutral placeholders.
const dom = parseHTML("<!doctype html><html><body></body></html>");
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | undefined;
let host: HTMLElement;

beforeAll(async () => {
  for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "Event", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT", "localStorage", "navigator"])
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const storage = new Map<string, string>();
  Object.defineProperty(dom.window, "localStorage", { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } });
  Object.defineProperty(dom.window, "navigator", { configurable: true, value: { language: "en" } });
  Object.defineProperty(dom.window, "location", { configurable: true, value: { href: "http://127.0.0.1:5173/" } });
  Object.assign(dom.document, { oninput: null });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: value });
  ({ createRoot } = await import("react-dom/client"));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
});
afterAll(() => {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const NOW = new Date("2026-11-24T12:00:00.000Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
let counter = 0;
const task = (overrides: Partial<WorkItemView> = {}): WorkItemView => {
  counter += 1;
  return {
    id: `task-${counter}`, contractRevision: 1, executorType: "agent", kind: "initial", title: `Task ${counter}`, status: "queued",
    statusReason: null, ordinal: counter, dependsOn: [], rootRunId: null, runIds: [], reworkOfWorkItemId: null,
    startedAt: null, completedAt: null, runSegments: [], createdAt: at(-100), updatedAt: at(-100), ...overrides,
  };
};
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);

async function mount(build: (providers: { I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider }) => ReturnType<typeof createElement>) {
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(I18nProvider, { children: build({ I18nProvider }) })));
}
const typeInto = (box: Element, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(box, value);
    box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    box.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
const click = (el: Element) => act(async () => void el.dispatchEvent(new dom.window.Event("click", { bubbles: true })));
const submit = (form: Element) => act(async () => void form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
const field = (label: string) =>
  Array.from(host.querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))!.querySelector("input")!;
const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
const buttonNamed = (text: string) => buttons().find((b) => b.textContent === text || b.getAttribute("aria-label")?.startsWith(text))!;

const staticRender = async (element: (providers: { I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider }) => ReturnType<typeof createElement>) => {
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  return renderToStaticMarkup(createElement(I18nProvider, { children: element({ I18nProvider }) }));
};

describe("the timeline offers rescheduling only for a task that has not started", () => {
  test("a queued bot task and an unfinished person's task have a button; a started or finished one says why not", async () => {
    const { OutcomeTimeline } = await import("../src/renderer/components/outcomego/outcomes/timeline/outcome-timeline");
    const items = [
      task({ title: "Waiting task", scheduledAt: at(5) }),
      task({ title: "Booked task", executorType: "human", kind: "human_action", status: "ready", scheduledAt: at(8) }),
      task({ title: "Running task", status: "running", startedAt: at(-1), runSegments: [{ id: "r", status: "running", startedAt: at(-1), completedAt: null }] }),
      task({ title: "Done task", status: "completed", startedAt: at(-5), completedAt: at(-4), runSegments: [{ id: "r2", status: "completed", startedAt: at(-5), completedAt: at(-4) }] }),
      task({ title: "Handed in", executorType: "human", kind: "human_action", status: "submitted" }),
    ];
    const html = await staticRender(() => createElement(OutcomeTimeline, { workItems: items, currentRevision: 1, now: NOW, onChangeSchedule: async () => undefined }));
    for (const name of ["Waiting task", "Booked task"]) expect(html).toContain(`aria-label="Change schedule: ${name}"`);
    for (const name of ["Running task", "Done task", "Handed in"]) expect(html).not.toContain(`aria-label="Change schedule: ${name}"`);
    expect(html.match(/Already started or finished/g)).toHaveLength(3);
  });

  test("without a way to save, the timeline is read-only: no column and no buttons", async () => {
    const { OutcomeTimeline } = await import("../src/renderer/components/outcomego/outcomes/timeline/outcome-timeline");
    const html = await staticRender(() => createElement(OutcomeTimeline, { workItems: [task({ scheduledAt: at(5) })], currentRevision: 1, now: NOW }));
    expect(html).not.toContain("Change schedule");
    expect(html).not.toContain("Already started or finished");
    expect(html).not.toContain(">Schedule</th>");
  });
});

describe("the schedule form", () => {
  const open = async (initial: Partial<WorkItemView>, onSave: (change: unknown) => Promise<void>, onCancel = () => undefined) => {
    const { ScheduleEditor } = await import("../src/renderer/components/outcomego/outcomes/timeline/schedule-editor");
    await mount(() => createElement(ScheduleEditor, { title: "A task", initial, onSave, onCancel }));
  };

  test("it starts from the task's own times and sends only what was changed", async () => {
    const calls: unknown[] = [];
    await open({ scheduledAt: local(2026, 11, 25, 9, 0).toISOString(), dueAt: null, estimateMinutes: 60 }, async (change) => void calls.push(change));
    expect(field("Planned for").value).toBe("2026-11-25T09:00");
    expect(field("Due").value).toBe("");
    expect(field("Estimate").value).toBe("60");
    await typeInto(field("Due"), "2026-11-30T17:00");
    await submit(host.querySelector("form")!);
    expect(calls).toEqual([{ dueAt: local(2026, 11, 30, 17, 0).toISOString() }]);
  });

  test("emptying a box clears it, and saving with nothing changed just closes", async () => {
    const calls: unknown[] = [];
    let closed = 0;
    await open({ scheduledAt: local(2026, 11, 25, 9, 0).toISOString(), estimateMinutes: 60 }, async (change) => void calls.push(change), () => closed++);
    await submit(host.querySelector("form")!);
    expect([calls, closed]).toEqual([[], 1]);
    await typeInto(field("Estimate"), "");
    await submit(host.querySelector("form")!);
    expect(calls).toEqual([{ estimateMinutes: null }]);
  });

  test("a value that is not allowed is stopped in the form, marked, and nothing is sent", async () => {
    const calls: unknown[] = [];
    await open({}, async (change) => void calls.push(change));
    await typeInto(field("Estimate"), String(PLAN_ESTIMATE_MINUTES.max + 1));
    await submit(host.querySelector("form")!);
    expect(calls).toEqual([]);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("not valid");
    expect(field("Estimate").getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain(`${PLAN_ESTIMATE_MINUTES.min} to ${PLAN_ESTIMATE_MINUTES.max}`);
  });

  test("when the server refuses, its reason is shown in place and what was typed stays", async () => {
    const refusal = Object.assign(new Error("server words"), { code: "schedule_not_editable", status: 409 });
    await open({}, async () => {
      throw refusal;
    });
    await typeInto(field("Planned for"), "2026-12-01T09:00");
    await submit(host.querySelector("form")!);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("already started or finished");
    expect(field("Planned for").value).toBe("2026-12-01T09:00");
    expect(buttonNamed("Save").disabled).toBe(false);
  });

  test("a refusal in words the interface does not know shows what the server said", async () => {
    await open({}, async () => {
      throw Object.assign(new Error("The server's own words"), { code: "something_else", status: 500 });
    });
    await typeInto(field("Planned for"), "2026-12-01T09:00");
    await submit(host.querySelector("form")!);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("The server's own words");
  });

  test("Cancel closes without sending", async () => {
    const calls: unknown[] = [];
    let closed = 0;
    await open({}, async (change) => void calls.push(change), () => closed++);
    await typeInto(field("Planned for"), "2026-12-01T09:00");
    await click(buttonNamed("Cancel"));
    expect([calls, closed]).toEqual([[], 1]);
  });
});

describe("the timeline row's form", () => {
  test("Change schedule opens the form under that task, and a saved change closes it", async () => {
    const { OutcomeTimeline } = await import("../src/renderer/components/outcomego/outcomes/timeline/outcome-timeline");
    const calls: Array<[string, unknown]> = [];
    const first = task({ title: "First task", scheduledAt: at(5) });
    const second = task({ title: "Second task", scheduledAt: at(9) });
    await mount(() => createElement(OutcomeTimeline, {
      workItems: [first, second], currentRevision: 1, now: NOW,
      onChangeSchedule: async (id: string, change: unknown) => void calls.push([id, change]),
    }));
    expect(host.querySelector("form")).toBeNull();
    await click(buttonNamed("Change schedule: Second task"));
    expect(host.querySelectorAll("form")).toHaveLength(1);
    await typeInto(field("Estimate"), "30");
    await submit(host.querySelector("form")!);
    expect(calls).toEqual([[second.id, { estimateMinutes: 30 }]]);
    expect(host.querySelector("form")).toBeNull();
  });

  test("a refused change keeps the form open with the reason", async () => {
    const { OutcomeTimeline } = await import("../src/renderer/components/outcomego/outcomes/timeline/outcome-timeline");
    await mount(() => createElement(OutcomeTimeline, {
      workItems: [task({ title: "Only task", scheduledAt: at(5) })], currentRevision: 1, now: NOW,
      onChangeSchedule: async () => {
        throw Object.assign(new Error("x"), { code: "invalid_schedule", status: 400 });
      },
    }));
    await click(buttonNamed("Change schedule: Only task"));
    await typeInto(field("Estimate"), "30");
    await submit(host.querySelector("form")!);
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("not valid");
  });
});

describe("the goal's due date", () => {
  const mountDue = async (props: { dueAt: string | null; editable: boolean; onSave?: (change: unknown) => Promise<void> }) => {
    const { GoalDue } = await import("../src/renderer/components/outcomego/outcomes/detail/goal-due");
    await mount(() => createElement(GoalDue, { title: "A goal", dueAt: props.dueAt, editable: props.editable, onSave: props.onSave ?? (async () => undefined) }));
  };

  test("an open goal with no due date offers to set one; with one, to change it", async () => {
    await mountDue({ dueAt: null, editable: true });
    expect(host.textContent).toContain("Not set");
    expect(buttonNamed("Set due date")).toBeTruthy();
    await act(async () => root!.unmount());
    host.remove();
    await mountDue({ dueAt: at(48), editable: true });
    expect(host.textContent).toContain(new Date(at(48)).toLocaleString());
    expect(buttonNamed("Change due date")).toBeTruthy();
  });

  test("a finished goal shows its date and no control, and shows nothing at all without a date", async () => {
    await mountDue({ dueAt: at(-48), editable: false });
    expect(host.textContent).toContain(new Date(at(-48)).toLocaleString());
    expect(buttons()).toHaveLength(0);
    await act(async () => root!.unmount());
    host.remove();
    await mountDue({ dueAt: null, editable: false });
    expect(host.querySelector("[data-goal-due]")).toBeNull();
  });

  test("setting a due date sends it alone, and clearing sends null", async () => {
    const calls: unknown[] = [];
    await mountDue({ dueAt: null, editable: true, onSave: async (change) => void calls.push(change) });
    await click(buttonNamed("Set due date"));
    expect(host.querySelectorAll("form input")).toHaveLength(1);
    await typeInto(field("Due"), "2026-12-24T18:00");
    await submit(host.querySelector("form")!);
    expect(calls).toEqual([{ dueAt: local(2026, 12, 24, 18, 0).toISOString() }]);
  });

  test("a refusal (a goal that finished meanwhile) is shown in the form", async () => {
    await mountDue({
      dueAt: at(48), editable: true,
      onSave: async () => {
        throw Object.assign(new Error("x"), { code: "outcome_not_open", status: 409 });
      },
    });
    await click(buttonNamed("Change due date"));
    await typeInto(field("Due"), "");
    await submit(host.querySelector("form")!);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("goal is finished");
  });
});
