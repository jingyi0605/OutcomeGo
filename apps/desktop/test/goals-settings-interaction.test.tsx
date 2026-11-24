import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { TASK_POLICY_FIELDS } from "@outcomego/contracts/task-policy";

// Specs/004.10 task 2.9, requirement E3: each change is saved on its own, a refused one restores the old value, and an
// out-of-range one is stopped in the page. The settings call is replaced, so no request leaves the test.
mock.module("../src/renderer/client/outcomego-api", () => ({
  api: {
    bootstrap: async () => ({ bots: [] }),
    featureSettings: async () => ({}),
    updateFeatureSettings: async () => ({}),
    // The model pickers in the planning group ask for this when they mount; "offline" is a state they already handle.
    serverSettings: async () => {
      throw new Error("offline");
    },
  },
}));

const dom = parseHTML("<!doctype html><html><body></body></html>");
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | undefined;
let host: HTMLElement;
const field = TASK_POLICY_FIELDS.find((entry) => entry.key === "schedule.graceMinutes")!;
const KEY = field.key;

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
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
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

type Update = (input: { taskPolicy?: Record<string, unknown> }) => Promise<unknown>;
async function mount(update: Update, taskPolicy: Record<string, number> = {}, groupId: "goal-schedule" | "goal-todo" = "goal-schedule") {
  const { I18nProvider } = await import("../src/renderer/lib/i18n");
  const { PolicyFields } = await import("../src/renderer/components/outcomego/settings/goals-view");
  const { GOAL_SETTINGS_GROUPS } = await import("../src/renderer/components/outcomego/settings/goal-policy-fields");
  // Only the policy rows are mounted: the planning pickers need a browser's Select and are not what this tests.
  // The group is passed in directly, so a group the page does not show yet can still be covered.
  const scheduling = GOAL_SETTINGS_GROUPS.find((group) => group.id === groupId)!;
  host = dom.document.createElement("div");
  dom.document.body.append(host);
  root = createRoot(host);
  const features = {
    outcomesEnabled: true, streamBotReplies: false, plannerBotId: null, reviewerBotId: null, plannerModel: null, reviewerModel: null,
    environmentNote: null, taskPolicy, updatedAt: null, loaded: true, failed: false, update, retry: () => undefined,
  };
  await act(async () => root!.render(createElement(I18nProvider, { children: createElement(PolicyFields, { features: features as never, group: scheduling }) })));
}
const input = () => host.querySelector<HTMLInputElement>(`[data-policy-input="${KEY}"]`)!;
const restore = () => Array.from(host.querySelectorAll<HTMLButtonElement>(`[data-policy-key="${KEY}"] button`)).find((b) => b.textContent === "Restore initial value")!;
/** React tracks a controlled input's value through the element's own setter, so typing goes through it. */
const typeInto = async (box: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(box, value);
    box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    box.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
};
/**
 * The Save button commits the value. Enter and leaving the box commit as well, but this DOM stand-in has no
 * KeyboardEvent or FocusEvent, so those two paths are not exercised here (they are listed as not verified in tasks.md).
 */
const leave = (box: HTMLInputElement) =>
  act(async () => {
    const save = host.querySelector<HTMLButtonElement>(`[data-policy-save="${box.getAttribute("data-policy-input")}"]`)!;
    save.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
const type = (value: string) => typeInto(input(), value);
const commit = () => leave(input());

test("a valid value is saved on its own, as that one key only", async () => {
  const calls: unknown[] = [];
  await mount(async (patch) => void calls.push(patch));
  await type(String(field.max));
  await commit();
  expect(calls).toEqual([{ taskPolicy: { [KEY]: field.max } }]);
});

test("an out-of-range value is stopped in the page: nothing is saved and the allowed range is shown", async () => {
  const calls: unknown[] = [];
  await mount(async (patch) => void calls.push(patch));
  await type(String(field.max! + 1));
  await commit();
  expect(calls).toEqual([]);
  const alert = host.querySelector<HTMLElement>(`[data-policy-key="${KEY}"] [role="alert"]`);
  expect(alert?.textContent).toContain("not allowed");
  expect(alert?.textContent).toContain(`${field.min}`);
  expect(alert?.textContent).toContain(`${field.max}`);
});

test("text that is not a whole number is stopped too", async () => {
  const calls: unknown[] = [];
  await mount(async (patch) => void calls.push(patch));
  for (const text of ["abc", "1.5", ""]) {
    await type(text);
    await commit();
  }
  expect(calls).toEqual([]);
});

test("when the save fails the old value comes back and the reason is shown", async () => {
  await mount(async () => {
    throw new Error("server refused");
  }, { [KEY]: field.min! });
  expect(input().value).toBe(String(field.min));
  await type(String(field.max));
  await commit();
  expect(input().value).toBe(String(field.min));
  expect(host.querySelector(`[data-policy-key="${KEY}"] [role="alert"]`)?.textContent).toContain("Couldn't save");
});

test("restore sends null for that key, so the server returns it to its initial value", async () => {
  const calls: unknown[] = [];
  await mount(async (patch) => void calls.push(patch), { [KEY]: field.max! });
  await act(async () => void restore().dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  expect(calls).toEqual([{ taskPolicy: { [KEY]: null } }]);
});

test("restore is not offered while nothing is stored", async () => {
  const calls: unknown[] = [];
  await mount(async (patch) => void calls.push(patch));
  expect(restore().disabled).toBe(true);
  await act(async () => void restore().dispatchEvent(new dom.window.Event("click", { bubbles: true })));
  expect(calls).toEqual([]);
});

test("a field that starts unlimited shows 'No limit', and clearing a stored value restores it", async () => {
  const unlimited = TASK_POLICY_FIELDS.find((entry) => entry.unlimitedWhenUnset)!;
  const calls: unknown[] = [];
  // No unlimited-by-default field exists in the scheduling group, so the group that owns one is mounted for this case.
  await mount(async (patch) => void calls.push(patch), {}, "goal-todo");
  const box = host.querySelector<HTMLInputElement>(`[data-policy-input="${unlimited.key}"]`)!;
  expect(box.placeholder).toBe("No limit");
  expect(host.querySelector(`[data-policy-key="${unlimited.key}"]`)?.textContent).toContain("No limit");
  await typeInto(box, String(unlimited.min));
  await leave(box);
  expect(calls).toEqual([{ taskPolicy: { [unlimited.key]: unlimited.min } }]);
});

test("clearing a stored value on a field that starts unlimited sends null, not an error", async () => {
  const unlimited = TASK_POLICY_FIELDS.find((entry) => entry.unlimitedWhenUnset)!;
  const calls: unknown[] = [];
  await mount(async (patch) => void calls.push(patch), { [unlimited.key]: unlimited.max! }, "goal-todo");
  const box = host.querySelector<HTMLInputElement>(`[data-policy-input="${unlimited.key}"]`)!;
  expect(box.value).toBe(String(unlimited.max));
  await typeInto(box, "");
  await leave(box);
  expect(calls).toEqual([{ taskPolicy: { [unlimited.key]: null } }]);
  expect(host.querySelector(`[data-policy-key="${unlimited.key}"] [role="alert"]`)).toBeNull();
});
