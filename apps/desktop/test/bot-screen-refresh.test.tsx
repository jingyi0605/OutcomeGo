import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { BotView } from "@outcomego/contracts";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";

let BotScreen: typeof import("../src/renderer/components/outcomego/bot-screen").BotScreen;
let api: typeof import("../src/renderer/client/outcomego-api").api;
let clearAuthToken: typeof import("../src/renderer/client/auth").clearAuthToken;
let useAuthenticatedResource: typeof import("../src/renderer/hooks/use-authenticated-resource").useAuthenticatedResource;
let I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider;
let createRoot: typeof import("react-dom/client").createRoot;
let visibilityEvent: string;
const dom = parseHTML("<!doctype html><html><body></body></html>");
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const originalFetch = globalThis.fetch;
const imagePrototype = dom.window.HTMLImageElement.prototype;
const originalDecode = Object.getOwnPropertyDescriptor(imagePrototype, "decode");
let originalStatus: typeof api.screenStatus;
let root: Root | undefined;
let host: HTMLElement;
let sequence = 0;
let requests: Array<{
  url: string;
  respond: (response: Response) => void;
  reject: (error: Error) => void;
}>;
let decodes: Array<{ url: string; accept: () => void; reject: (error: Error) => void }>;

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperties(dom.window, {
    location: { configurable: true, value: { href: "http://127.0.0.1:5173/" } },
    localStorage: {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
    navigator: { configurable: true, value: { language: "en" } },
  });
  // Linkedom has no layout/media engine; keep unrelated button motion static.
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  dom.document.hasFocus = () => true;
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ BotScreen } = await import("../src/renderer/components/outcomego/bot-screen"));
  ({ api } = await import("../src/renderer/client/outcomego-api"));
  ({ clearAuthToken } = await import("../src/renderer/client/auth"));
  ({ useAuthenticatedResource } = await import("../src/renderer/hooks/use-authenticated-resource"));
  ({ I18nProvider } = await import("../src/renderer/lib/i18n"));
  ({ WINDOW_VISIBILITY_EVENT: visibilityEvent } = await import(
    "../src/renderer/lib/window-visibility"
  ));
  originalStatus = api.screenStatus;
  api.screenStatus = async () => ({ state: "ready" }) as never;
  Object.defineProperty(imagePrototype, "decode", {
    configurable: true,
    value(this: HTMLImageElement) {
      return new Promise<void>((accept, reject) => {
        decodes.push({ url: this.src, accept, reject });
      });
    },
  });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  globalThis.fetch = originalFetch;
});
afterAll(() => {
  api.screenStatus = originalStatus;
  if (originalDecode) Object.defineProperty(imagePrototype, "decode", originalDecode);
  else Reflect.deleteProperty(imagePrototype, "decode");
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function fixture() {
  requests = [];
  decodes = [];
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) =>
      new Promise<Response>((respond, reject) => {
        requests.push({ url: String(input), respond, reject });
      }),
    { preconnect: originalFetch.preconnect }
  );
  return { id: `screen-refresh-${++sequence}`, name: "Preview", status: "active" } as BotView;
}
async function render(node: ReactNode) {
  if (!root) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(<I18nProvider>{node}</I18nProvider>));
}
async function respond(index: number, status = 200) {
  await act(async () => requests[index]!.respond(new Response("frame fixture", { status })));
}
async function decode(index: number) {
  await act(async () => decodes[index]?.accept());
  const image = host.querySelector("img");
  if (image) await act(async () => image.dispatchEvent(new dom.window.Event("load")));
}
async function refresh() {
  // Wake the existing visibility listener rather than waiting for the five-second interval.
  await act(async () => {
    await new Promise((done) => setTimeout(done, 2));
    window.dispatchEvent(new dom.window.Event(visibilityEvent));
  });
}
async function firstFrame(bot: BotView) {
  await render(<BotScreen bot={bot} active enabled onEnable={() => {}} />);
  await respond(0);
  await decode(0);
  const image = host.querySelector("img");
  expect(image).not.toBeNull();
  return image!;
}

test("preview retains its image node until the replacement frame has decoded", async () => {
  const bot = fixture();
  const image = await firstFrame(bot);
  const oldSource = image.getAttribute("src");
  await refresh();
  expect(requests).toHaveLength(2);
  expect(host.querySelector("img")).toBe(image);
  expect(image.getAttribute("src")).toBe(oldSource);
  await respond(1);
  expect(image.getAttribute("src")).toBe(oldSource);
  expect(decodes).toHaveLength(2);
  await decode(1);
  expect(host.querySelector("img")).toBe(image);
  expect(image.getAttribute("src")).toBe(decodes[1]!.url);
  await render(
    <BotScreen
      bot={{ ...bot, updatedAt: "2026-11-18T02:00:03Z" }}
      active
      enabled
      onEnable={() => {}}
    />
  );
  expect(host.querySelector("img")).toBe(image);
  expect(requests).toHaveLength(2);
});

test("failed frame refresh keeps the last screen and a later refresh recovers", async () => {
  const bot = fixture();
  const image = await firstFrame(bot);
  const oldSource = image.getAttribute("src");
  await refresh();
  await respond(1, 503);
  expect(host.querySelector("img")).toBe(image);
  expect(image.getAttribute("src")).toBe(oldSource);
  expect(host.textContent).toContain("Screen preview is reconnecting");
  await refresh();
  await respond(2);
  await decode(1);
  expect(host.querySelector("img")).toBe(image);
  expect(image.getAttribute("src")).not.toBe(oldSource);
  expect(host.textContent).not.toContain("Screen preview is reconnecting");
});

test("invalid image decode and network errors keep the last successfully decoded screen", async () => {
  const bot = fixture();
  const image = await firstFrame(bot);
  const oldSource = image.getAttribute("src");
  await refresh();
  await respond(1);
  expect(decodes).toHaveLength(2);
  await act(async () => decodes[1]!.reject(new Error("Invalid frame")));
  expect(image.getAttribute("src")).toBe(oldSource);
  expect(host.querySelector("img")).toBe(image);
  await refresh();
  await act(async () => requests[2]!.reject(new TypeError("Network unavailable")));
  expect(host.querySelector("img")).toBe(image);
  expect(image.getAttribute("src")).toBe(oldSource);
});

test("initial failure stays a reconnecting placeholder and a valid retry displays the screen", async () => {
  const bot = fixture();
  await render(<BotScreen bot={bot} active enabled onEnable={() => {}} />);
  await respond(0, 503);
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("Screen preview is reconnecting");
  await refresh();
  await respond(1);
  expect(host.querySelector("img")).toBeNull();
  await decode(0);
  expect(host.querySelector("img")).not.toBeNull();
});

test("switching Bots hides the old screen and ignores its late decoded replacement", async () => {
  const bot = fixture();
  await firstFrame(bot);
  await refresh();
  await respond(1);
  expect(decodes).toHaveLength(2);
  await render(
    <BotScreen bot={{ ...bot, id: `${bot.id}-other` }} active enabled onEnable={() => {}} />
  );
  expect(host.querySelector("img")).toBeNull();
  await decode(1);
  expect(host.querySelector("img")).toBeNull();
  await respond(2);
  await decode(2);
  expect(host.querySelector("img")?.getAttribute("src")).toBe(decodes[2]!.url);
});

test("an unauthorized replacement clears the old screen despite same-Bot retention", async () => {
  const bot = fixture();
  await firstFrame(bot);
  await refresh();
  await respond(1, 401);
  expect(host.querySelector("img")).toBeNull();
});

test("signing out while decoding prevents the old account's frame from reappearing", async () => {
  const bot = fixture();
  await firstFrame(bot);
  await refresh();
  await respond(1);
  expect(decodes).toHaveLength(2);
  await act(async () => clearAuthToken());
  expect(host.querySelector("img")).toBeNull();
  await decode(1);
  expect(host.querySelector("img")).toBeNull();
});

function Resource({ source }: { source: string }) {
  const url = useAuthenticatedResource(source);
  return <output>{url}</output>;
}
test("resources without retention still clear while their source changes or fails", async () => {
  fixture();
  const path = `/api/v0/bots/default-resource-${sequence}/avatar`;
  await render(<Resource source={`${path}?revision=1`} />);
  await respond(0);
  expect(host.querySelector("output")!.textContent).toStartWith("blob:");
  expect(decodes).toHaveLength(0);
  await render(<Resource source={`${path}?revision=2`} />);
  expect(host.querySelector("output")!.textContent).toBe("");
  await respond(1, 503);
  expect(host.querySelector("output")!.textContent).toBe("");
});
