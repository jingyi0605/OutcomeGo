import { afterAll, beforeAll, expect, test } from "bun:test";
import type { ChannelView } from "@outcomego/contracts";
import { parseHTML } from "linkedom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/renderer/lib/i18n";
import { ChatBranchNavigation, WorkThreadNavigation } from "../src/renderer/lib/work-thread-navigation";

let WorkThreadAvatarTrigger: typeof import("../src/renderer/components/outcomego/work-thread-navigation").WorkThreadAvatarTrigger;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  const dom = parseHTML("<!doctype html><html><body></body></html>");
  Object.defineProperty(dom.window, "location", {
    configurable: true,
    value: { href: "http://127.0.0.1:5173/" },
  });
  Object.defineProperty(dom.window, "navigator", {
    configurable: true,
    value: { language: "en" },
  });
  const storage = new Map<string, string>();
  const localStorageStub = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  for (const [key, value] of [
    ["window", dom.window],
    ["document", dom.document],
    ["navigator", dom.window.navigator],
    ["localStorage", localStorageStub],
  ] as const) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ WorkThreadAvatarTrigger } = await import(
    "../src/renderer/components/outcomego/work-thread-navigation"
  ));
});

afterAll(() => {
  for (const [key, previous] of descriptors) {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const botDmChannel: ChannelView = {
  id: "channel-1",
  kind: "bot_dm",
  name: "Worker Bot",
  description: "",
  hasAvatar: false,
  directKey: "bot:bot-1",
  workingDirectory: null,
  members: [{ botId: "bot-1", ordinal: 0 }],
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
};

const renderTrigger = (props: Partial<Parameters<typeof WorkThreadAvatarTrigger>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(
        ChatBranchNavigation.Provider,
        { value: () => {} },
        createElement(
          WorkThreadNavigation.Provider,
          { value: () => {} },
          createElement(WorkThreadAvatarTrigger, {
            channel: botDmChannel,
            className: "left-2 top-[9px] size-9",
            ...props,
          })
        )
      )
    )
  );

test("WorkThreadAvatarTrigger stays hidden when no thread is running", () => {
  expect(renderTrigger({ active: false })).toBe("");
  expect(renderTrigger()).toBe("");
});

test("WorkThreadAvatarTrigger renders a bottom-left dot without right-corner icons when active", () => {
  const mdHtml = renderTrigger({ active: true, ringColor: "var(--selected)" });
  expect(mdHtml).toContain("data-work-thread-trigger");
  expect(mdHtml).toContain("data-work-thread-dot");
  expect(mdHtml).toContain("bottom-0.5 left-0.5");
  expect(mdHtml).toContain("bg-[#ff9f0a]");
  expect(mdHtml).toContain("size-2 ");
  expect(mdHtml).toContain("--thread-dot-ring:var(--selected)");
  expect(mdHtml).not.toContain("lucide-chevron-right");
  expect(mdHtml).not.toContain("-right-1");

  const pinHtml = renderTrigger({ active: true, size: "pin" });
  expect(pinHtml).toContain("size-2.5 ");
});
