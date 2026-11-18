import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import type { OutcomeDetail, OutcomeListPage } from "@outcomego/contracts/outcomes";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { TooltipProvider } from "../src/renderer/components/ui/tooltip";
import { OutcomeNavigation } from "../src/renderer/components/outcomego/outcomes/outcome-navigation";
import { OutcomeList } from "../src/renderer/components/outcomego/outcomes/outcome-list";
import { outcomeFixture, planFixture } from "./outcome-fixture";
import { decisionFixture, exploreFixture, inboxFixture } from "./outcome-client-fixtures";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
const bots = [
  { id: planFixture.botId, name: "Research Bot" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Delivery Bot" },
];
let current: OutcomeDetail;
let list: (query: string) => Promise<OutcomeListPage>;
const outcomes = createOutcomeApi(async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ path, body });
  if (path.startsWith("/api/outcomes?") || (path === "/api/outcomes" && !body))
    return (await list(path.split("?")[1] ?? "")) as T;
  if (path === "/api/outcomes/plans") return { ...planFixture, botId: body.context.botId } as T;
  if (path === "/api/outcomes" && body) {
    current = { ...current, title: body.title, status: "pending_approval" };
    current.currentRevisionView = {
      ...current.currentRevisionView!,
      status: "pending_approval",
      approvedAt: null,
    };
    return current as T;
  }
  if (path.endsWith("/approve")) {
    current = {
      ...current,
      status: "approved",
      currentRevisionView: {
        ...current.currentRevisionView!,
        status: "approved",
        approvedAt: planFixture.generatedAt,
      },
    };
  }
  if (path.endsWith("/runs"))
    current = {
      ...current,
      status: "running",
      workItems: structuredClone(outcomeFixture.workItems),
    };
  return current as T;
});
const api = {
  outcomes,
  outcomeInbox: {
    list: async () => ({ items: [inboxFixture], nextCursor: null }),
    decision: async () => decisionFixture,
    humanItems: async () => [],
    forOutcome: async () => ({ items: [], nextCursor: null }),
  },
  explore: {
    list: async () => ({ items: [exploreFixture], nextCursor: null }),
    get: async () => exploreFixture,
  },
  outcomeRecovery: async () => ({ items: [], notificationFailures: [] }),
  outcomeAttention: async () => ({ recorded: true }),
  markChannelRead: async (...args: unknown[]) => {
    readCalls.push(args);
  },
};
const readCalls: unknown[][] = [];
mock.module("../src/renderer/client/outcomego-api", () => ({ api }));
let Workspace: typeof import("../src/renderer/components/outcomego/outcomes/inbox/outcome-workspace").default;
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | undefined;
let host: HTMLElement;
const textareaDefault = Object.getOwnPropertyDescriptor(
  dom.window.HTMLTextAreaElement.prototype,
  "defaultValue"
);
beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(dom.window, "navigator", { configurable: true, value: { language: "en" } });
  Object.assign(dom.document, { oninput: null, hasFocus: () => true });
  // Linkedom has no layout or media queries; use the browser's no-layout/reduced-motion path.
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return this.textContent ?? "";
    },
    set(this: HTMLTextAreaElement, value: string) {
      this.textContent = value;
    },
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  Workspace = (
    await import("../src/renderer/components/outcomego/outcomes/inbox/outcome-workspace")
  ).default;
});
beforeEach(() => {
  calls.length = 0;
  readCalls.length = 0;
  current = {
    ...structuredClone(outcomeFixture),
    workItems: [],
    outputs: [],
    evidence: [],
    reviews: [],
  };
  list = async () => ({
    items: [
      { ...outcomeFixture, status: "running" },
      {
        ...outcomeFixture,
        id: "outcome-2",
        title: "Prepare the delivery",
        status: "decision_pending",
        botId: bots[1]!.id,
      },
    ],
    nextCursor: null,
  });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
});
afterAll(() => {
  if (textareaDefault)
    Object.defineProperty(
      dom.window.HTMLTextAreaElement.prototype,
      "defaultValue",
      textareaDefault
    );
  else Reflect.deleteProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue");
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await render(node);
}
async function render(node: ReactNode) {
  await act(async () => {
    root!.render(
      <I18nProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </I18nProvider>
    );
  });
}
async function click(text: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll("button")].find(
    (element) => element.textContent === text
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
}
async function input(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) {
  if (element.localName === "input" && !element.getAttribute("type"))
    element.setAttribute("type", "text");
  if (element.localName === "select") {
    for (const option of element.querySelectorAll("option"))
      (option as HTMLOptionElement).selected = option.getAttribute("value") === value;
    // Linkedom does not reflect select.value consistently while options change.
    Object.defineProperty(element, "value", { configurable: true, value });
  } else
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(
      element,
      value
    );
  await act(async () => {
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
const page = () => <Workspace target={{}} bots={bots} onClose={() => {}} />;

test("sidebar navigation exposes a selected page and stays usable when compact", async () => {
  let opened = 0;
  await mount(<OutcomeNavigation active onOpen={() => opened++} />);
  expect(host.querySelector('button[aria-current="page"]')?.getAttribute("aria-label")).toBe(
    "Outcomes"
  );
  await click("Outcomes");
  expect(opened).toBe(1);
  await render(<OutcomeNavigation compact active={false} onOpen={() => opened++} />);
  const compact = host.querySelector('button[aria-label="Outcomes"]')!;
  expect(compact.hasAttribute("aria-current")).toBe(false);
  await act(async () => {
    compact.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(opened).toBe(2);
});

test("workspace opens a full page with all goals, Bot names and execution statuses", async () => {
  await mount(page());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("Outcomes");
  expect(host.textContent).toContain("Backup comparison");
  expect(host.textContent).toContain("Research Bot");
  expect(host.textContent).toContain("Delivery Bot");
  expect(host.querySelector('[data-outcome-status="running"]')?.textContent).toBe("Running");
  expect(host.querySelector('[data-outcome-status="decision_pending"]')?.textContent).toBe(
    "Awaiting decision"
  );
  expect(
    host.querySelector('nav[aria-label="Outcome sections"] button[aria-current="page"]')
      ?.textContent
  ).toBe("All goals");
});

test("all-goals status filtering queries the server and discards an obsolete response", async () => {
  let resolve!: (value: OutcomeListPage) => void;
  list = async (query) =>
    query
      ? {
          items: [{ ...outcomeFixture, title: "Only paused goal", status: "paused" }],
          nextCursor: null,
        }
      : new Promise((value) => {
          resolve = value;
        });
  await mount(
    <OutcomeList client={outcomes} bots={bots} onSelect={() => {}} onCreate={() => {}} />
  );
  await input(host.querySelector("select")!, "paused");
  expect(calls.some((call) => call.path === "/api/outcomes?status=paused")).toBe(true);
  expect(host.textContent).toContain("Only paused goal");
  await act(async () => {
    resolve({ items: [{ ...outcomeFixture, title: "Obsolete goal" }], nextCursor: null });
  });
  expect(host.textContent).not.toContain("Obsolete goal");
  expect(host.textContent).toContain("Only paused goal");
});

test("goal pagination retains existing goals, deduplicates overlap and passes the cursor", async () => {
  list = async (query) =>
    query
      ? {
          items: [
            { ...outcomeFixture },
            { ...outcomeFixture, id: "next", title: "Next page goal" },
          ],
          nextCursor: null,
        }
      : { items: [outcomeFixture], nextCursor: "cursor+one" };
  let selected = "";
  await mount(
    <OutcomeList
      client={outcomes}
      bots={bots}
      onSelect={(id) => {
        selected = id;
      }}
      onCreate={() => {}}
    />
  );
  await click("Load more");
  expect(calls.at(-1)!.path).toBe("/api/outcomes?cursor=cursor%2Bone");
  expect(host.querySelectorAll("ul > li")).toHaveLength(2);
  await act(async () => {
    host
      .querySelectorAll("ul > li button")[1]!
      .dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(selected).toBe("next");
});

test("goal list errors offer a working retry and empty goals offer creation", async () => {
  list = async () => {
    throw new Error("offline");
  };
  let created = false;
  await mount(
    <OutcomeList
      client={outcomes}
      bots={bots}
      onSelect={() => {}}
      onCreate={() => {
        created = true;
      }}
    />
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load goals");
  list = async () => ({ items: [], nextCursor: null });
  await click("Retry");
  expect(host.textContent).toContain("No goals yet.");
  await click("New Outcome");
  expect(created).toBe(true);
});

test("attention and Explore are separate full-page sections and can return to all goals", async () => {
  await mount(page());
  await click("Needs attention", host.querySelector('nav[aria-label="Outcome sections"]')!);
  expect(host.textContent).toContain(inboxFixture.title);
  expect(host.textContent).toContain(inboxFixture.next);
  await click("Explore ideas", host.querySelector('nav[aria-label="Outcome sections"]')!);
  expect(host.textContent).toContain(exploreFixture.title);
  await click("New idea");
  expect(host.textContent).toContain("Capture a new idea");
  await click("All goals", host.querySelector('nav[aria-label="Outcome sections"]')!);
  expect(host.textContent).toContain("Backup comparison");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

test("new Outcome uses the chosen Bot and requires approval before an explicit start", async () => {
  await mount(page());
  await click("New Outcome");
  await input(host.querySelector('select[aria-label="Execution Bot"]')!, bots[1]!.id);
  await input(host.querySelector("textarea")!, "Compare backup plans for this goal");
  await click("Generate planning options");
  expect(calls.find((call) => call.path === "/api/outcomes/plans")?.body).toMatchObject({
    context: { botId: bots[1]!.id },
  });
  for (let step = 0; step < 3; step++) {
    await act(async () => {
      host
        .querySelector('input[type="checkbox"]')!
        .dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    });
    await click("Next");
  }
  await click("Create contract for confirmation");
  expect(host.textContent).toContain("Approve contract");
  expect(calls.some((call) => call.path.endsWith("/runs"))).toBe(false);
  await input(
    host.querySelector('input[aria-label="Approval confirmation"]')!,
    "I approve the goals and boundaries."
  );
  await click("Approve contract");
  expect(host.textContent).toContain("Start approved Outcome");
  expect(calls.some((call) => call.path.endsWith("/runs"))).toBe(false);
  await click("Start approved Outcome");
  expect(calls.filter((call) => call.path.endsWith("/runs"))).toHaveLength(1);
  expect(host.textContent).toContain("Research backups");
});

test("new Outcome with no Bots provides a way back to chat", async () => {
  let closed = false;
  await mount(
    <Workspace
      target={{}}
      bots={[]}
      onClose={() => {
        closed = true;
      }}
    />
  );
  await click("New Outcome");
  expect(host.textContent).toContain("Create a Bot in chat before planning an Outcome.");
  expect(host.querySelector('select[aria-label="Execution Bot"]')?.hasAttribute("disabled")).toBe(
    true
  );
  await click("Back to chats");
  expect(closed).toBe(true);
});

test("notification targets open the corresponding detail on the page and mark only that notification read", async () => {
  await mount(
    <Workspace
      target={{
        decisionId: decisionFixture.id,
        channelId: "notification-channel",
        notificationSequence: "42",
      }}
      bots={bots}
      onClose={() => {}}
    />
  );
  expect(host.textContent).toContain("Choose the next step");
  expect(readCalls).toEqual([["notification-channel", "0", "42"]]);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
