import { expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act } from "react";

let calls = 0;
mock.module("../src/renderer/client/outcomego-api", () => ({
  api: {
    featureSettings: async () => {
      calls++;
      if (calls === 1) throw new Error("server not ready");
      return { outcomesEnabled: true, streamBotReplies: false, updatedAt: null };
    },
  },
}));

test("a failed first read is retried on its own, so goal entries appear without opening settings", async () => {
  const dom = parseHTML("<html><body></body></html>");
  Object.assign(dom.document, { oninput: null });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: dom.window.navigator,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(dom.window, "location", { configurable: true, value: { href: "http://127.0.0.1:5173/" } });
  const { useFeatureSettings } = await import("../src/renderer/hooks/use-feature-settings");
  const { createRoot } = await import("react-dom/client");
  const seen: Array<[boolean, boolean, boolean]> = [];
  function Probe() {
    const { outcomesEnabled, loaded, failed } = useFeatureSettings();
    seen.push([outcomesEnabled, loaded, failed]);
    return null;
  }
  const { createElement } = await import("react");
  const root = createRoot(dom.document.body);
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toEqual([false, false, true]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(calls).toBe(2);
    expect(seen.at(-1)).toEqual([true, true, false]);
  } finally {
    await act(async () => root.unmount());
  }
});
