import { describe, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act, useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { badgeText, BotDockApp, DockBots, MAX_VISIBLE_BOTS } from "../src/renderer/botdock/botdock-app";
import { DockComposerApp } from "../src/renderer/botdock/dock-composer-app";
import { DockComposer, useDockComposer } from "../src/renderer/botdock/dock-composer";
import type { BotDockBridge } from "../src/renderer/botdock/types";
import type { BotDockBotView, BotDockStateView } from "../src/renderer/lib/bot-dock-state";

const labels = { messages: "Unread messages", goals: "Pending action", open: "Open OutcomeGo" };
const bot = (id: string, messages: number, goals: number): BotDockBotView => ({
  id,
  name: `Bot ${id}`,
  color: "#22a99d",
  icon: "round",
  channelId: `dm-${id}`,
  messages,
  goals,
});
const render = (bots: BotDockBotView[]) =>
  renderToStaticMarkup(<DockBots state={{ bots, labels } satisfies BotDockStateView} />);

describe("Bot dock capsule", () => {
  test("shows nothing on the right when no Bot has anything waiting", () => {
    expect(render([])).toBe("");
  });

  test("marks unread messages red and goals waiting yellow, each only when there is something", () => {
    const html = render([bot("a", 3, 0), bot("b", 0, 2), bot("c", 5, 1)]);
    const buttons = html.split("<button").slice(1);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toContain('data-dock-badge="messages"');
    expect(buttons[0]).not.toContain('data-dock-badge="goals"');
    expect(buttons[1]).toContain('data-dock-badge="goals"');
    expect(buttons[1]).not.toContain('data-dock-badge="messages"');
    expect(buttons[2]).toContain('data-dock-badge="messages"');
    expect(buttons[2]).toContain('data-dock-badge="goals"');
    expect(html).toContain("dock-badge-messages");
    expect(html).toContain("dock-badge-goals");
  });

  test("stacks avatars with the earliest on top so every badge stays visible", () => {
    const html = render([bot("a", 1, 0), bot("b", 1, 0), bot("c", 1, 0)]);
    expect([...html.matchAll(/z-index:(\d+)/g)].map((match) => Number(match[1]))).toEqual([
      3, 2, 1,
    ]);
  });

  test("collapses Bots beyond the limit into a +N chip", () => {
    const bots = Array.from({ length: MAX_VISIBLE_BOTS + 3 }, (_, index) =>
      bot(String(index), 1, 0)
    );
    const html = render(bots);
    expect(html.match(/data-dock-bot=/g)).toHaveLength(MAX_VISIBLE_BOTS);
    expect(html).toContain("+3");
  });

  test("labels each Bot with its name and counts for assistive tech", () => {
    const html = render([bot("a", 4, 2)]);
    expect(html).toContain('aria-label="Bot a, Unread messages: 4, Pending action: 2"');
  });

  test("caps large counts", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });

  test("draws a custom avatar when one is given, otherwise the robot glyph", () => {
    const withAvatar = render([{ ...bot("a", 1, 0), avatarDataUrl: "data:image/png;base64,AAAA" }]);
    expect(withAvatar).toContain('<img alt=""');
    expect(withAvatar).toContain("data:image/png;base64,AAAA");
    expect(render([bot("a", 1, 0)])).not.toContain("<img");
  });

  test("keeps capsule layouts fixed during drag and animates only the visible composer", async () => {
    const dom = parseHTML("<html><body></body></html>");
    Object.assign(dom.document, { oninput: null });
    const layouts: string[] = [];
    const fileHover = mock((_active: boolean) => {});
    let dockSide: Parameters<BotDockBridge["onDockSide"]>[0] = () => {};
    let composerAnchor: Parameters<BotDockBridge["onComposerAnchor"]>[0] = () => {};
    let surfaceVisible: (visible: boolean) => void = () => {};
    let arrive: () => void = () => {};
    let receiveFiles: Parameters<BotDockBridge["onDroppedFiles"]>[0] = () => {};
    let publishState: Parameters<BotDockBridge["onState"]>[0] = () => {};
    const idleState = {
      bots: [],
      roster: [bot("a", 0, 0)],
      labels: {
        ...labels,
        running: "Bot activity in progress",
        placeholder: "Message the main Bot",
        send: "Send",
        to: "To",
        failed: "Could not send",
        empty: "No Bot is available",
        attachmentInvalid: "Invalid file",
        removeAttachment: "Remove attachment",
      },
    };
    const bridge: Partial<BotDockBridge> = {
      getState: async () => idleState,
      onState(listener) {
        publishState = listener;
        return () => {};
      },
      onMessageArrival(listener) {
        arrive = listener;
        return () => {};
      },
      onDockSide(listener) {
        dockSide = listener;
        return () => {};
      },
      onSurfaceVisible(listener) {
        surfaceVisible = listener;
        return () => {};
      },
      setFileHover: fileHover,
      onComposerAnchor(listener) {
        composerAnchor = listener;
        return () => {};
      },
      onDroppedFiles(listener) {
        receiveFiles = listener;
        return () => {};
      },
      resize(_width, _height, layout) {
        layouts.push(layout);
      },
    };
    Object.defineProperty(dom.window, "botdock", { value: bridge });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.document,
      IS_REACT_ACT_ENVIRONMENT: true,
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    })) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(dom.document.body);
    const hover = (clientX: number, clientY: number) => {
      const event = new dom.window.Event("dragover", { cancelable: true });
      Object.assign(event, { clientX, clientY, dataTransfer: { types: ["Files"] } });
      return act(async () => dom.window.dispatchEvent(event));
    };
    try {
      await act(async () => root.render(<BotDockApp />));
      const target = dom.document.querySelector(".dock-drop-target");
      if (!target) throw new Error("Missing dock drop target");
      Object.defineProperty(target, "getBoundingClientRect", {
        value: () => ({ left: 10, top: 10, right: 80, bottom: 80 }),
      });
      const frame = dom.document.querySelector(".dock-frame");
      const capsule = frame?.querySelector(".dock-capsule");
      const home = frame?.querySelector(".dock-home");
      expect(frame?.getAttribute("data-standby")).toBe("true");
      expect(home?.getAttribute("aria-label")).toBe(labels.open);
      expect(capsule?.hasAttribute("data-running")).toBe(false);
      await act(async () => publishState({ ...idleState, running: true }));
      expect(capsule?.getAttribute("data-running")).toBe("true");
      expect(home?.getAttribute("aria-label")).toContain(idleState.labels.running);
      await act(async () => publishState(idleState));
      expect(capsule?.hasAttribute("data-running")).toBe(false);
      expect(frame?.getAttribute("data-dock-side")).toBe("left");
      await act(async () => dockSide("right"));
      expect(frame?.getAttribute("data-dock-side")).toBe("right");
      await act(async () => composerAnchor({ right: true, bottom: false }));
      expect(target.getAttribute("data-composer-open")).toBe("true");
      expect(target.getAttribute("data-composer-x")).toBe("right");
      expect(target.getAttribute("data-composer-y")).toBe("bottom");
      expect(layouts).toEqual(["compact"]);
      await hover(40, 40);
      expect(fileHover).toHaveBeenLastCalledWith(true);
      expect(frame?.hasAttribute("data-dropping")).toBe(false);
      expect(frame?.hasAttribute("data-standby")).toBe(true);
      await act(async () => composerAnchor(null));
      expect(target.hasAttribute("data-composer-open")).toBe(false);
      expect(target.getAttribute("data-composer-x")).toBe("right");

      await act(async () => root.render(<BotDockApp invitation />));
      expect(frame?.hasAttribute("data-dropping")).toBe(true);
      expect(frame?.hasAttribute("data-invitation-visible")).toBe(false);
      expect(frame?.querySelector(".dock-home")?.getAttribute("aria-label")).toBe(labels.open);
      await act(async () => dockSide("left"));
      expect(frame?.getAttribute("data-dock-side")).toBe("left");
      await act(async () => surfaceVisible(true));
      expect(frame?.getAttribute("data-invitation-visible")).toBe("true");
      expect(frame?.hasAttribute("data-standby")).toBe(false);

      await hover(40, 40);
      expect(frame?.hasAttribute("data-drop-target")).toBe(true);
      await hover(5, 40);
      expect(frame?.hasAttribute("data-drop-target")).toBe(false);
      expect(frame?.hasAttribute("data-dropping")).toBe(true);
      expect(layouts).toEqual(["compact", "invitation"]);

      await act(async () => {
        const leave = new dom.window.Event("dragleave");
        Object.assign(leave, { clientX: 0, clientY: 0 });
        dom.window.dispatchEvent(leave);
      });
      expect(fileHover).toHaveBeenLastCalledWith(false);
      expect(frame?.hasAttribute("data-dropping")).toBe(true);
      expect(layouts).toEqual(["compact", "invitation"]);

      expect(frame?.hasAttribute("data-message-shake")).toBe(false);
      await act(async () => arrive());
      expect(frame?.getAttribute("data-message-shake")).toBe("true");
      const motion = dom.document.querySelector(".dock-message-motion");
      if (!motion) throw new Error("Missing dock shake element");
      const animationEnd = new dom.window.Event("animationend", { bubbles: true });
      Object.assign(animationEnd, { animationName: "dock-shake" });
      await act(async () => motion.dispatchEvent(animationEnd));
      expect(frame?.hasAttribute("data-message-shake")).toBe(false);
      await act(async () => arrive());
      expect(frame?.getAttribute("data-message-shake")).toBe("true");
      expect(layouts).toEqual(["compact", "invitation"]);

      expect(dom.document.querySelector("textarea")).toBeNull();
      await act(async () => root.render(<DockComposerApp />));
      expect(dom.document.querySelector(".dock-capsule")).toBeNull();
      expect(dom.document.querySelector("textarea")).not.toBeNull();
      expect(layouts.at(-1)).toBe("composer");
      const composerFrame = dom.document.querySelector(".dock-composer-frame");
      expect(composerFrame?.hasAttribute("data-visible")).toBe(false);
      await act(async () => surfaceVisible(true));
      expect(composerFrame?.getAttribute("data-visible")).toBe("true");
      await act(async () => surfaceVisible(false));
      expect(composerFrame?.hasAttribute("data-visible")).toBe(false);
      await act(async () => receiveFiles({
        files: [{ bytes: new Uint8Array([65]), fileName: "notes.txt", mimeType: "text/plain" }],
        rejected: false,
      }));
      expect(dom.document.querySelector(".dock-file-name")?.textContent).toBe("notes.txt");
    } finally {
      await act(async () => root.unmount());
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  test("Enter selects an @ suggestion before sending, and only a successful send closes", async () => {
    const dom = parseHTML("<html><body></body></html>");
    Object.assign(dom.document, { oninput: null });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.document,
      IS_REACT_ACT_ENVIRONMENT: true,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    })) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(dom.document.body);
    let finishSend: (result: { ok: boolean }) => void = () => {};
    const send = mock(
      (_message: Parameters<BotDockBridge["send"]>[0]) =>
        new Promise<{ ok: boolean }>((resolve) => { finishSend = resolve; })
    );
    const closeComposer = mock(() => {});
    const focusApp = mock(() => {});
    const bridge = { send, closeComposer, focusApp } as unknown as BotDockBridge;
    const state: BotDockStateView = {
      bots: [],
      roster: [
        { ...bot("a", 0, 0), name: "Alpha", avatarDataUrl: "data:image/png;base64,AAAA" },
        { ...bot("b", 0, 0), name: "Beta", avatarDataUrl: "data:image/png;base64,AAAA" },
      ],
      labels: {
        ...labels,
        placeholder: "Message",
        to: "To",
        send: "Send",
        failed: "Send failed",
        empty: "No Bot",
        attachmentInvalid: "Invalid attachment",
        removeAttachment: "Remove attachment",
      },
    };
    const message = "First line\nSecond line";
    const draft = `${message}\n@`;
    function Fixture() {
      const model = useDockComposer(bridge, state.roster);
      const { change } = model;
      const [ready, setReady] = useState(false);
      useEffect(() => {
        change(draft);
        setReady(true);
      }, [change]);
      return ready ? <DockComposer bridge={bridge} model={model} state={state} /> : null;
    }
    try {
      await act(async () => root.render(<Fixture />));
      const input = dom.document.querySelector("textarea");
      const picker = dom.document.querySelector<HTMLButtonElement>(".dock-target");
      if (!input || !picker) throw new Error("Missing dock textarea or recipient picker");
      Object.defineProperty(input, "setSelectionRange", { value: () => {} });
      expect(picker.getAttribute("aria-expanded")).toBe("true");
      const press = async (
        key: string,
        options: { shiftKey?: boolean; isComposing?: boolean; repeat?: boolean } = {}
      ) => {
        const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(event, { key, ...options });
        await act(async () => input.dispatchEvent(event));
        return event.defaultPrevented;
      };
      expect(await press("Enter", { shiftKey: true })).toBe(false);
      expect(await press("Enter", { isComposing: true })).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(await press("ArrowDown")).toBe(true);
      expect(dom.document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe(
        "Beta"
      );
      expect(await press("Enter")).toBe(true);
      expect(picker.textContent).toBe("To Beta");
      expect(picker.getAttribute("aria-expanded")).toBe("false");
      expect(input.value).toBe(`${message}\n`);
      expect(closeComposer).not.toHaveBeenCalled();
      expect(await press("Enter", { repeat: true })).toBe(true);
      expect(send).not.toHaveBeenCalled();

      expect(await press("Enter")).toBe(true);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        botId: "b",
        content: message,
      }));
      expect(closeComposer).not.toHaveBeenCalled();
      await act(async () => finishSend({ ok: false }));
      expect(closeComposer).not.toHaveBeenCalled();
      expect(input.value).toBe(`${message}\n`);
      expect(await press("Enter")).toBe(true);
      await act(async () => finishSend({ ok: true }));
      expect(closeComposer).toHaveBeenCalledTimes(1);
      expect(focusApp).not.toHaveBeenCalled();
      expect(input.value).toBe("");
    } finally {
      await act(async () => root.unmount());
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  test("defaults to chat mode and toggles goal mode with Tab", async () => {
    const dom = parseHTML("<html><body></body></html>");
    Object.assign(dom.document, { oninput: null });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.document,
      IS_REACT_ACT_ENVIRONMENT: true,
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    })) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(dom.document.body);
    const send = mock(async (_message: Parameters<BotDockBridge["send"]>[0]) => ({ ok: true }));
    const closeComposer = mock(() => {});
    const bridge = { send, closeComposer, focusApp: () => {} } as unknown as BotDockBridge;
    const state: BotDockStateView = {
      bots: [],
      roster: [{ ...bot("a", 0, 0), name: "Alpha" }],
      outcomesEnabled: true,
      labels: {
        ...labels,
        placeholder: "Chat placeholder",
        goalPlaceholder: "Goal placeholder",
        chatMode: "对话",
        goalMode: "目标",
        to: "To",
        send: "Send",
        failed: "Send failed",
        empty: "No Bot",
        attachmentInvalid: "Invalid attachment",
        removeAttachment: "Remove attachment",
      },
    };
    let setDraft!: (next: string) => void;
    function Fixture() {
      const model = useDockComposer(bridge, state.roster, state.outcomesEnabled !== false);
      setDraft = model.change;
      return <DockComposer bridge={bridge} model={model} state={state} />;
    }
    try {
      await act(async () => root.render(<Fixture />));
      const input = dom.document.querySelector("textarea")!;
      const modePill = () => dom.document.querySelector<HTMLButtonElement>(".dock-mode-pill")!;
      expect(modePill().getAttribute("data-mode")).toBe("chat");
      expect(modePill().textContent).toBe("Tab对话");
      const kbd = modePill().querySelector(".dock-mode-kbd");
      expect(kbd?.textContent).toBe("Tab");
      expect(kbd?.querySelector("svg")).toBeNull();
      expect(kbd?.nextElementSibling?.textContent).toBe("对话");
      expect(dom.document.querySelector(".dock-composer-bar")?.contains(modePill())).toBe(true);
      expect(modePill().nextElementSibling?.classList.contains("dock-send")).toBe(true);
      expect(input.getAttribute("placeholder")).toBe("Chat placeholder");

      const press = async (key: string, options: { shiftKey?: boolean; repeat?: boolean } = {}) => {
        const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(event, { key, ...options });
        await act(async () => input.dispatchEvent(event));
        return event.defaultPrevented;
      };

      // Tab toggles from chat mode to goal mode.
      expect(await press("Tab")).toBe(true);
      expect(modePill().getAttribute("data-mode")).toBe("goal");
      expect(modePill().textContent).toContain("目标");
      expect(input.getAttribute("placeholder")).toBe("Goal placeholder");
      expect(dom.document.querySelector(".dock-composer")?.getAttribute("data-goal-mode")).toBe("true");

      // Repeated Tab keydown does not flicker; another single Tab toggles back to chat mode.
      expect(await press("Tab", { repeat: true })).toBe(true);
      expect(modePill().getAttribute("data-mode")).toBe("goal");
      expect(await press("Tab")).toBe(true);
      expect(modePill().getAttribute("data-mode")).toBe("chat");

      // Switch back to goal mode, enter text, and send -> sends goalMode: true and resets to chat mode.
      await press("Tab");
      expect(modePill().getAttribute("data-mode")).toBe("goal");
      await act(async () => setDraft("整理今天的日志"));
      await press("Enter");
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ botId: "a", content: "整理今天的日志", goalMode: true })
      );
      expect(modePill().getAttribute("data-mode")).toBe("chat");
    } finally {
      await act(async () => root.unmount());
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
});
