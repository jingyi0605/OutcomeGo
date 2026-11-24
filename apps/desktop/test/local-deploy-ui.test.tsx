import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Code, DeployProgress, LocalDeployRequest, LocalServerStatus } from "../src/renderer/lib/local-deploy-contract";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const globals = new Map<string, PropertyDescriptor | undefined>();
const password = "FixturePassword-972!";
const envelope = { schemaVersion: 1, deployId: "deploy-fixture", ts: "2026-11-24T00:00:00Z" } as const;
const result = { url: "http://127.0.0.1:8787", directory: "/isolated", username: "local-owner", version: "1.2.3", engine: "external" } as const;
let createRoot: typeof import("react-dom/client").createRoot;
let LocalDeployFlow: typeof import("../src/renderer/components/outcomego/local-deploy-flow").default;
let I18nProvider: typeof import("../src/renderer/lib/i18n").I18nProvider;
let root: Root | undefined;

beforeAll(async () => {
  Object.defineProperties(dom.window, {
    localStorage: { configurable: true, value: { getItem: () => null } },
    navigator: { configurable: true, value: { language: "en-US" } },
  });
  Object.assign(dom.document, { oninput: null, hasFocus: () => true });
  const inputType = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "type")!;
  Object.defineProperty(dom.window.HTMLInputElement.prototype, "type", {
    ...inputType, get(this: HTMLInputElement) { return inputType.get!.call(this) ?? "text"; },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", { configurable: true, value: () => [] });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ default: LocalDeployFlow } = await import("../src/renderer/components/outcomego/local-deploy-flow"));
  ({ I18nProvider } = await import("../src/renderer/lib/i18n"));
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

afterAll(() => {
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const fixture = async (options: { awaiting?: boolean; delayStart?: boolean; platform?: "win32" | "darwin"; elevationCode?: Code } = {}) => {
  const ack = Promise.withResolvers<{ deployId: string }>();
  if (!options.delayStart) ack.resolve({ deployId: envelope.deployId });
  const start = mock((_request: LocalDeployRequest) => ack.promise);
  const cancel = mock(async (_id: string) => undefined);
  const enable = mock(async (_confirmed: true) => ({ code: options.elevationCode ?? null }));
  const connect = mock(async (_result: typeof result, _password: string) => undefined);
  let listener: ((event: DeployProgress) => void) | undefined;
  const status: LocalServerStatus = { stack: { state: "not-installed", services: [] }, apiPort: null, engine: null,
    version: null, ownerUsername: options.awaiting ? "local-owner" : null, awaiting: options.awaiting ? "reboot" : null };
  Object.defineProperty(window, "outcomego", { configurable: true, value: {
    platform: options.platform,
    localServer: { status: async () => status },
    localDeploy: { start, cancel, enableWsl: enable, onProgress: (receive: typeof listener) => { listener = receive; return () => { listener = undefined; }; } },
  } });
  root = createRoot(document.body);
  await act(async () => root!.render(<I18nProvider><LocalDeployFlow onBack={() => undefined} onConnect={connect} /></I18nProvider>));
  return { start, cancel, connect, enable, ack, publish: (event: DeployProgress) => act(async () => listener?.(event)) };
};

const input = (name: string) => document.getElementById(`deploy-${name}`) as HTMLInputElement;
const button = (name: string) => Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === name)!;
const click = (name: string) => act(async () => {
  button(name).dispatchEvent(Object.assign(new Event("click", { bubbles: true }), { detail: 1 }));
});
const fill = async (name: string, value: string) => act(async () => {
  const control = input(name);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
});
const submit = () => act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const credentials = async () => {
  await fill("username", "local-owner");
  await fill("password", password);
  await fill("confirmation", password);
};

test("renders first progress within two seconds and clears both passwords after login", async () => {
  const entry = await fixture();
  await credentials();
  const started = performance.now();
  await submit();
  expect(entry.start).toHaveBeenCalledTimes(1);
  await entry.publish({ ...envelope, type: "stage", stage: "pull", status: "progress", current: 1, total: 3 });
  expect(document.querySelector("[role=status]")?.textContent).toContain("Downloading container images");
  expect(performance.now() - started).toBeLessThan(2_000);
  await entry.publish({ ...envelope, type: "result", result });
  expect(entry.connect.mock.calls).toEqual([[result, password]]);
  expect(input("password")?.value).toBe("");
  expect(input("confirmation")?.value).toBe("");
});

test("prefills a pending deployment without restoring any credential", async () => {
  const entry = await fixture({ awaiting: true });
  expect(document.body.textContent).toContain("Continue deployment by entering your password again.");
  expect(input("username").value).toBe("local-owner");
  expect(input("password").value).toBe("");
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(entry.start).not.toHaveBeenCalled();
});

test("remembers a cancellation while waiting for the deployment ID", async () => {
  const entry = await fixture({ delayStart: true });
  await credentials();
  await submit();
  await click("Cancel");
  expect(entry.cancel).not.toHaveBeenCalled();
  await act(async () => entry.ack.resolve({ deployId: envelope.deployId }));
  expect(entry.cancel.mock.calls).toEqual([[envelope.deployId]]);
  await entry.publish({ ...envelope, type: "error", stage: "detect", code: "CANCELLED", retryable: true });
  expect(input("password").value).toBe("");
});

test("low memory confirmation retries with the explicit override", async () => {
  const entry = await fixture();
  await credentials();
  await submit();
  await entry.publish({ ...envelope, type: "action-required", action: { kind: "confirm-low-memory" } });
  await entry.publish({ ...envelope, type: "error", stage: "detect", code: "MEMORY_LOW", retryable: true });
  await click("Continue anyway");
  expect(entry.start.mock.calls.map(([request]) => request.acceptLowMemory)).toEqual([false, true]);
});

test("Windows WSL setup prompts before elevation and reports denial without sending credentials", async () => {
  const entry = await fixture({ platform: "win32", elevationCode: "ELEVATION_DENIED" });
  await credentials();
  await submit();
  await entry.publish({ ...envelope, type: "error", stage: "detect", code: "WSL_NOT_ENABLED", retryable: false, action: { kind: "elevate" } });
  expect(document.body.textContent).toContain("Administrator approval is required");
  expect(entry.enable).not.toHaveBeenCalled();
  expect(input("password").value).toBe("");
  await click("Authorize WSL setup");
  expect(entry.enable.mock.calls).toEqual([[true]]);
  expect(document.querySelector("[role=alert]")?.textContent).toContain("Allow the system change");
  expect(button("Authorize WSL setup")).toBeDefined();
});

test.each([
  ["VIRTUALIZATION_DISABLED", "Enable virtualization in your firmware"],
  ["WINDOWS_UNSUPPORTED", "Windows 11 23H2"],
  ["REBOOT_REQUIRED", "reopen OutcomeGo"],
  ["MEMORY_LOW", "edit .wslconfig manually"],
] as const)("Windows shows instructions for %s without requesting elevation", async (code, guidance) => {
  const entry = await fixture({ platform: "win32" });
  await credentials();
  await submit();
  await entry.publish({ ...envelope, type: "error", stage: "detect", code, retryable: true });
  expect(document.body.textContent).toContain(guidance);
  expect(entry.enable).not.toHaveBeenCalled();
});

test("macOS shows virtual machine preparation and the 13.5 fallback guidance", async () => {
  const entry = await fixture({ platform: "darwin" });
  await credentials();
  await submit();
  await entry.publish({ ...envelope, type: "stage", stage: "engine", status: "started" });
  expect(document.querySelector("[role=status]")?.textContent).toContain("Preparing the virtual machine");
  await entry.publish({ ...envelope, type: "error", stage: "detect", code: "MACOS_UNSUPPORTED", retryable: false });
  expect(document.querySelector("[role=alert]")?.textContent).toContain("macOS 13.5 or later");
  expect(document.querySelector("[role=alert]")?.textContent).toContain("existing container engine or server");
});
