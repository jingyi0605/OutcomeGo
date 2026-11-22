import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, createRef, useState, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import type { BotView, ChannelView } from "@outcomego/contracts";
import { CLIENT_CAPABILITIES } from "@outcomego/contracts/capabilities";
import type { OutcomeListPage } from "@outcomego/contracts/outcomes";
import { GOAL_MODE_OPTION_ID, type MentionOption } from "../src/renderer/lib/mentions";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let api: typeof import("../src/renderer/client/outcomego-api").api;
let I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider;
let ChatGoals: typeof import("../src/renderer/components/outcomego/outcomes/chat-goals").default;
let ChatPane: typeof import("../src/renderer/components/outcomego/chat-pane").ChatPane;
let TooltipProvider: typeof import("../src/renderer/components/ui/tooltip").TooltipProvider;
let PromptInput: typeof import("../src/renderer/components/ai-elements/prompt-input").PromptInput;
let MentionEditor: typeof import("../src/renderer/components/outcomego/mention-editor").MentionEditor;
let createRoot: typeof import("react-dom/client").createRoot;

beforeAll(async () => {
  Object.assign(dom.window.document, {
    hasFocus: () => true,
    fonts: { status: "loaded", ready: Promise.resolve() },
  });
  Object.defineProperty(dom.window, "location", {
    configurable: true,
    value: { href: "http://127.0.0.1:5173/" },
  });
  Object.defineProperty(dom.window, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(dom.window, "navigator", {
    configurable: true,
    value: { platform: "MacIntel", language: "en-US", onLine: true },
  });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  if (!Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "checked")) {
    Object.defineProperty(dom.window.HTMLInputElement.prototype, "checked", {
      configurable: true,
      get(this: HTMLInputElement) {
        return this.hasAttribute("checked");
      },
      set(this: HTMLInputElement, value: boolean) {
        if (value) this.setAttribute("checked", "");
        else this.removeAttribute("checked");
      },
    });
  }
  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
  }
  const createFakeRange = () => {
    const range = {
      startContainer: null as Node | null,
      startOffset: 0,
      endContainer: null as Node | null,
      endOffset: 0,
      setStart(node: Node, offset: number) {
        range.startContainer = node;
        range.startOffset = offset;
      },
      setEnd(node: Node, offset: number) {
        range.endContainer = node;
        range.endOffset = offset;
      },
      collapse(toStart?: boolean) {
        if (toStart) {
          range.endContainer = range.startContainer;
          range.endOffset = range.startOffset;
        } else {
          range.startContainer = range.endContainer;
          range.startOffset = range.endOffset;
        }
      },
      cloneRange() {
        const clone = createFakeRange();
        clone.startContainer = range.startContainer;
        clone.startOffset = range.startOffset;
        clone.endContainer = range.endContainer;
        clone.endOffset = range.endOffset;
        return clone;
      },
      deleteContents() {
        if (
          range.startContainer &&
          range.startContainer === range.endContainer &&
          range.startContainer.nodeType === dom.window.Node.TEXT_NODE
        ) {
          const text = range.startContainer.textContent ?? "";
          range.startContainer.textContent =
            text.slice(0, range.startOffset) + text.slice(range.endOffset);
          range.endOffset = range.startOffset;
        }
      },
      selectNodeContents(node: Node) {
        range.startContainer = node;
        range.startOffset = 0;
        range.endContainer = node;
        range.endOffset = node.childNodes.length;
      },
      getBoundingClientRect() {
        return { left: 16, top: 400, right: 24, bottom: 420, width: 8, height: 20 };
      },
    };
    return range;
  };
  let activeSelectionRange: ReturnType<typeof createFakeRange> | null = null;
  Object.defineProperty(dom.window.document, "createRange", {
    configurable: true,
    value: createFakeRange,
  });
  Object.defineProperty(dom.window, "getSelection", {
    configurable: true,
    value: () => ({
      rangeCount: activeSelectionRange ? 1 : 0,
      isCollapsed:
        !activeSelectionRange ||
        (activeSelectionRange.startContainer === activeSelectionRange.endContainer &&
          activeSelectionRange.startOffset === activeSelectionRange.endOffset),
      getRangeAt: () => activeSelectionRange,
      removeAllRanges: () => {
        activeSelectionRange = null;
      },
      addRange: (next: ReturnType<typeof createFakeRange>) => {
        activeSelectionRange = next;
      },
    }),
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    navigator: dom.window.navigator,
    localStorage: storage,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    NodeFilter: { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_SKIP: 3 },
    Range: dom.window.Range,
    Text: dom.window.Text,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    KeyboardEvent: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: () => ({
      borderTopWidth: "0",
      borderBottomWidth: "0",
      display: "block",
      visibility: "visible",
      position: "static",
      overflow: "visible",
      direction: "ltr",
      animationName: "none",
      getPropertyValue: () => "",
    }),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ api } = await import("../src/renderer/client/outcomego-api"));
  ({ I18nProvider } = await import("../src/renderer/lib/i18n"));
  ({ default: ChatGoals } = await import("../src/renderer/components/outcomego/outcomes/chat-goals"));
  ({ ChatPane } = await import("../src/renderer/components/outcomego/chat-pane"));
  ({ TooltipProvider } = await import("../src/renderer/components/ui/tooltip"));
  ({ PromptInput } = await import("../src/renderer/components/ai-elements/prompt-input"));
  ({ MentionEditor } = await import("../src/renderer/components/outcomego/mention-editor"));
});

afterAll(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  dom.window.document.body.innerHTML = "";
});

const mount = async (node: ReactNode) => {
  await act(async () => {
    root.render(<I18nProvider>{node}</I18nProvider>);
  });
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const botFixture: BotView = {
  id: "bot-1",
  name: "哆哆",
  description: "",
  title: "",
  color: "#555555",
  icon: "helmet",
  hasAvatar: false,
  status: "active",
  hiddenFromSidebar: false,
  notificationsEnabled: true,
  defaultDirectory: "/workspace",
  conversationId: "conv-1",
  onboardingStatus: "completed",
  onboardingVersion: 1,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
};

const allGoals: OutcomeListPage = {
  items: [
    {
      id: "goal-running",
      title: "清理 Unraid 存储空间（进行中）",
      status: "running",
      botId: "bot-1",
      currentRevision: 2,
      updatedAt: "2026-11-22T10:30:00.000Z",
    },
    {
      id: "goal-accepted",
      title: "清理 Unraid 存储空间（已验收）",
      status: "accepted",
      botId: "bot-1",
      currentRevision: 1,
      updatedAt: "2026-11-21T08:00:00.000Z",
    },
    {
      id: "goal-cancelled",
      title: "Unraid 清理后容量复查",
      status: "cancelled",
      botId: "bot-1",
      currentRevision: 1,
      updatedAt: "2026-11-20T08:00:00.000Z",
    },
  ],
  nextCursor: null,
};

test("ChatGoals hides accepted and cancelled goals by default, shows timestamps and badges, and toggles completed goals", async () => {
  const queries: string[] = [];
  const originalList = api.outcomes.list;
  api.outcomes.list = async (query = "") => {
    queries.push(query);
    const params = new URLSearchParams(query);
    const statusParam = params.get("status");
    const allowed = statusParam ? new Set(statusParam.split(",")) : null;
    return {
      items: allowed ? allGoals.items.filter((item) => allowed.has(item.status)) : allGoals.items,
      nextCursor: null,
    };
  };

  try {
    let closed = false;
    let movedToNewGoal = false;
    await mount(
      <ChatGoals
        bot={botFixture}
        bots={[botFixture]}
        onClose={() => {
          closed = true;
        }}
        onNewGoal={() => {
          movedToNewGoal = true;
        }}
      />
    );
    await settle();

    const dialog = dom.window.document.body.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    // Default list hides accepted & cancelled goals, and displays running goal with timestamp, revision, and badge.
    expect(dialog.textContent).toContain("清理 Unraid 存储空间（进行中）");
    expect(dialog.textContent).not.toContain("清理 Unraid 存储空间（已验收）");
    expect(dialog.textContent).not.toContain("Unraid 清理后容量复查");
    expect(dialog.textContent).toContain("Revision 2");
    expect(dialog.textContent).toContain(new Date("2026-11-22T10:30:00.000Z").toLocaleString());
    expect(dialog.querySelector(".chat-goal-status-badge")?.getAttribute("data-outcome-status")).toBe("running");

    // Switch sits to the left of New Outcome.
    const toggle = dialog.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(dialog.textContent).toContain("Show completed goals");
    expect(queries[0]).toContain("status=");
    expect(queries[0]).not.toContain("accepted");
    expect(queries[0]).not.toContain("cancelled");

    // Toggle switch ON -> reveals accepted and cancelled goals.
    await act(async () => {
      toggle.click();
    });
    await settle();

    expect(queries.at(-1)).not.toContain("status=");
    expect(dialog.textContent).toContain("清理 Unraid 存储空间（已验收）");
    expect(dialog.textContent).toContain("Unraid 清理后容量复查");

    // Clicking New Outcome closes the modal and invokes onNewGoal.
    const newBtn = [...dialog.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("New Outcome")
    )!;
    await act(async () => {
      newBtn.click();
    });
    expect(movedToNewGoal).toBe(true);
    expect(closed).toBe(true);
  } finally {
    api.outcomes.list = originalList;
  }
});

test("PromptInput shows Goal mode tag and allows exiting goal mode", async () => {
  let exited = false;
  await mount(
    <PromptInput
      goalMode
      onCancelGoalMode={() => {
        exited = true;
      }}
      onStage={async () => {
        throw new Error("unused");
      }}
      onSubmit={async () => {}}
    />
  );

  const tag = host.querySelector("[data-goal-mode-tag]");
  expect(tag).not.toBeNull();
  expect(tag?.textContent).toContain("Goal mode");

  const closeBtn = tag?.querySelector("button") as HTMLButtonElement;
  expect(closeBtn).not.toBeNull();
  await act(async () => {
    closeBtn.click();
  });
  expect(exited).toBe(true);
});

test("MentionEditor pins Goal mode at the top of / picker and activates mode without inserting text", async () => {
  const editorRef = createRef<HTMLDivElement>();
  let latestValue = "";
  let selectedModeOption: MentionOption | null = null;
  const options: MentionOption[] = [
    {
      id: GOAL_MODE_OPTION_ID,
      label: "Goal mode",
      handle: "goal-mode",
      trigger: "/",
      kind: "mode",
    },
    {
      id: "skill-1",
      label: "daily-digest",
      handle: "daily-digest",
      trigger: "/",
      kind: "skill",
      status: "ready",
    },
  ];

  await mount(
    <MentionEditor
      editorRef={editorRef}
      options={options}
      value=""
      onChange={(plainText) => {
        latestValue = plainText;
      }}
      onSelectMode={(option) => {
        selectedModeOption = option;
      }}
      onSubmit={() => {}}
    />
  );

  const editor = editorRef.current!;
  const textNode = dom.window.document.createTextNode("/");
  editor.appendChild(textNode);
  const range = dom.window.document.createRange();
  range.setStart(textNode, 1);
  range.collapse(true);
  const selection = dom.window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);

  await act(async () => {
    editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });

  const listbox = dom.window.document.body.querySelector('[role="listbox"]');
  expect(listbox).not.toBeNull();
  const renderedOptions = [...listbox!.querySelectorAll('[role="option"]')];
  expect(renderedOptions.length).toBe(2);
  expect(renderedOptions[0]!.textContent).toContain("Goal mode");
  expect(renderedOptions[1]!.textContent).toContain("daily-digest");

  await act(async () => {
    const keyEvent = Object.assign(new dom.window.Event("keydown", { bubbles: true }), {
      key: "Enter",
    });
    editor.dispatchEvent(keyEvent);
  });

  expect(selectedModeOption?.id).toBe(GOAL_MODE_OPTION_ID);
  expect(latestValue).toBe("");
  expect(editor.textContent).toBe("");
});

test("ChatPane consumes goalModeRequest so cancelling and returning from another thread never re-enables Goal mode", async () => {
  const originalPluginComposer = api.pluginComposer;
  api.pluginComposer = async () => ({ items: [] });
  const channel: ChannelView = {
    id: "dm-1",
    kind: "bot_dm",
    name: "哆哆",
    description: "",
    directKey: "bot:bot-1",
    workingDirectory: "/workspace",
    archivedAt: null,
    hiddenFromSidebar: false,
    notificationsMuted: false,
    unreadCount: 0,
    members: [{ botId: "bot-1", ordinal: 0, joinedAt: "2026-11-22T00:00:00.000Z" }],
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
  };
  const botById = new Map([[botFixture.id, botFixture]]);
  const emptyMap = new Map();

  function Host() {
    const [inSubThread, setInSubThread] = useState(false);
    const [goalModeRequest, setGoalModeRequest] = useState<number | undefined>(undefined);
    return (
      <TooltipProvider>
        <div>
          <button
            type="button"
            data-trigger-goal=""
            onClick={() => setGoalModeRequest((n) => (n ?? 0) + 1)}
          >
            Trigger Goal
          </button>
          <button
            type="button"
            data-toggle-subthread=""
            onClick={() => setInSubThread((current) => !current)}
          >
            Toggle Subthread
          </button>
          {inSubThread ? (
            <div data-subthread-view="">Subthread</div>
          ) : (
            <ChatPane
              active
              goalsEnabled
              channel={channel}
              selectedBot={botFixture}
              botById={botById}
              agentNameById={emptyMap}
              itemsByRun={emptyMap}
              capabilities={CLIENT_CAPABILITIES}
              messages={[]}
              runs={[]}
              subagents={[]}
              runtime={{
                server: "ready",
                database: "ready",
                queue: "ready",
                computer: "ready",
                inference: "ready",
              }}
              mutate={async (operation) => operation()}
              focusMessage={null}
              goalModeRequest={goalModeRequest}
              onGoalModeRequestApplied={() => setGoalModeRequest(undefined)}
            />
          )}
        </div>
      </TooltipProvider>
    );
  }

  try {
    await mount(<Host />);
    await settle();

    expect(host.querySelector("[data-goal-mode-tag]")).toBeNull();

    // Activate goal mode via goalModeRequest (as when clicking New Outcome).
    await act(async () => {
      (host.querySelector("[data-trigger-goal]") as HTMLButtonElement).click();
    });
    await settle();

    const tag = host.querySelector("[data-goal-mode-tag]");
    expect(tag).not.toBeNull();

    // Dismiss goal mode with the close button.
    await act(async () => {
      (tag!.querySelector("button") as HTMLButtonElement).click();
    });
    await settle();
    expect(host.querySelector("[data-goal-mode-tag]")).toBeNull();

    // Unmount ChatPane (simulating opening a goal sub-thread) and remount when switching back.
    await act(async () => {
      (host.querySelector("[data-toggle-subthread]") as HTMLButtonElement).click();
    });
    await settle();
    expect(host.querySelector("[data-subthread-view]")).not.toBeNull();

    await act(async () => {
      (host.querySelector("[data-toggle-subthread]") as HTMLButtonElement).click();
    });
    await settle();

    // Returning must NOT re-attach Goal mode.
    expect(host.querySelector("[data-goal-mode-tag]")).toBeNull();
  } finally {
    api.pluginComposer = originalPluginComposer;
  }
});
