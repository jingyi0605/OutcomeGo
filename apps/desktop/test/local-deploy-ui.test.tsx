import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { Code, DeployProgress, EngineProbe, EngineProbes, LocalDeployRequest, LocalServerStatus } from "../src/renderer/lib/local-deploy-contract";

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

const fixture = async (options: { awaiting?: boolean; delayStart?: boolean; platform?: "win32" | "darwin"; elevationCode?: Code; probes?: EngineProbes } = {}) => {
  const ack = Promise.withResolvers<{ deployId: string }>();
  if (!options.delayStart) ack.resolve({ deployId: envelope.deployId });
  const start = mock((_request: LocalDeployRequest) => ack.promise);
  const cancel = mock(async (_id: string) => undefined);
  const enable = mock(async (_confirmed: true) => ({ code: options.elevationCode ?? null }));
  const connect = mock(async (_result: typeof result, _password: string) => undefined);
  const engines = mock(async () => options.probes!);
  let listener: ((event: DeployProgress) => void) | undefined;
  const status: LocalServerStatus = { stack: { state: "not-installed", services: [] }, apiPort: null, engine: null,
    version: null, ownerUsername: options.awaiting ? "local-owner" : null, awaiting: options.awaiting ? "reboot" : null };
  Object.defineProperty(window, "outcomego", { configurable: true, value: {
    platform: options.platform,
    localServer: { status: async () => status },
    localDeploy: { start, cancel, enableWsl: enable, ...(options.probes ? { engines: engines } : {}), onProgress: (receive: typeof listener) => { listener = receive; return () => { listener = undefined; }; } },
  } });
  root = createRoot(document.body);
  await act(async () => root!.render(<I18nProvider><LocalDeployFlow onBack={() => undefined} onConnect={connect} /></I18nProvider>));
  return { start, cancel, connect, enable, engines, ack, publish: (event: DeployProgress) => act(async () => listener?.(event)) };
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

const probe = (state: EngineProbe["state"], extra: Partial<EngineProbe> = {}): EngineProbe => ({ state, reasons: [], ...extra });
const radio = (kind: "external" | "managed") => document.querySelector<HTMLInputElement>(`input[name="deploy-engine"][value="${kind}"]`)!;
const card = (kind: "external" | "managed") => radio(kind).closest("label")!;
const pick = (kind: "external" | "managed") => act(async () => {
  const control = radio(kind);
  // A real click checks the box first. The test DOM has no `checked` accessor to track, so
  // setting the attribute is enough for React to see a change.
  control.setAttribute("checked", "");
  control.dispatchEvent(new Event("click", { bubbles: true }));
});

test("macOS shows what was found for each engine, suggests one, and deploys with it", async () => {
  const entry = await fixture({ platform: "darwin", probes: { external: probe("ready", { name: "Docker Engine", version: "27.3.1" }), managed: probe("needs-setup") } });
  expect(entry.engines).toHaveBeenCalledTimes(1);
  expect(card("external").textContent).toContain("Ready to use");
  expect(card("external").textContent).toContain("Docker Engine 27.3.1");
  expect(card("external").textContent).toContain("Recommended");
  expect(card("managed").textContent).toContain("Installs automatically");
  expect(card("managed").textContent).toContain("virtual machine");
  expect(card("managed").textContent).not.toContain("Recommended");
  expect([radio("external").checked, radio("managed").checked]).toEqual([true, false]);
  await credentials();
  await submit();
  expect(entry.start.mock.calls[0]![0]).toMatchObject({ engine: "external" });
});

test("picking the other engine deploys with it", async () => {
  const entry = await fixture({ platform: "darwin", probes: { external: probe("ready"), managed: probe("needs-setup") } });
  await pick("managed");
  expect([radio("external").checked, radio("managed").checked]).toEqual([false, true]);
  await credentials();
  await submit();
  expect(entry.start.mock.calls[0]![0]).toMatchObject({ engine: "managed" });
});

test("an engine that is installed but stopped says so, and checking again looks once more", async () => {
  const entry = await fixture({ platform: "darwin", probes: { external: probe("stopped"), managed: probe("needs-setup") } });
  expect(card("external").textContent).toContain("Installed, not running");
  expect(card("external").textContent).toContain("Start your container engine");
  expect(card("managed").textContent).toContain("Recommended");
  await click("Check again");
  expect(entry.engines).toHaveBeenCalledTimes(2);
});

test("an incompatible engine cannot be picked, and with nothing usable the person is told", async () => {
  const entry = await fixture({ platform: "darwin", probes: {
    external: probe("unsupported", { reasons: ["Compose is too old."] }), managed: probe("unsupported", { code: "MACOS_UNSUPPORTED" }) } });
  expect(radio("external").disabled).toBe(true);
  expect(radio("managed").disabled).toBe(true);
  expect(card("external").textContent).toContain("Compose is too old.");
  expect(card("managed").textContent).toContain("macOS 13.5 or later");
  expect(document.querySelector("[role=alert]")?.textContent).toContain("Neither engine can run here");
  expect(document.querySelector('input[name="deploy-engine"]:checked')).toBeNull();
  await credentials();
  await submit();
  expect(entry.start.mock.calls[0]![0]).toMatchObject({ engine: "auto" });
});

test("a deployment waiting on a restart stays on the OutcomeGo engine", async () => {
  const entry = await fixture({ platform: "win32", awaiting: true, probes: { external: probe("ready"), managed: probe("needs-setup", { code: "REBOOT_REQUIRED" }) } });
  expect(radio("external").disabled).toBe(true);
  expect(radio("managed").checked).toBe(true);
  expect(card("managed").textContent).toContain("Restart needed");
  expect(entry.start).not.toHaveBeenCalled();
});

test("progress shows the stage introduction, one weighted bar, and the whole list of steps", async () => {
  const entry = await fixture({ platform: "darwin", probes: { external: probe("needs-setup"), managed: probe("needs-setup") } });
  await credentials();
  await submit();
  await entry.publish({ ...envelope, type: "stage", stage: "detect", status: "completed" });
  await entry.publish({ ...envelope, type: "stage", stage: "engine", status: "started" });
  const status = document.querySelector("[role=status]")!.textContent!;
  expect(status).toContain("Step 2 of 8");
  expect(status).toContain("Preparing the virtual machine");
  expect(status).toContain("small virtual machine to host your bots");
  const before = Number(document.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow"));
  expect(before).toBeGreaterThan(0);
  // The bar's fill and its accessible value say the same thing.
  const fill = Number(/--fill:\s*([\d.]+)/.exec(document.querySelector(".deploy-meter")!.getAttribute("style") ?? "")?.[1]);
  expect(Math.round(fill * 100)).toBe(before);
  expect(Array.from(document.querySelectorAll(".deploy-steps li")).map(item => item.getAttribute("data-state")))
    .toEqual(["done", "active", "pending", "pending", "pending", "pending", "pending", "pending"]);
  await entry.publish({ ...envelope, type: "stage", stage: "engine", status: "completed" });
  await entry.publish({ ...envelope, type: "stage", stage: "release", status: "skipped" });
  await entry.publish({ ...envelope, type: "stage", stage: "pull", status: "progress", current: 3, total: 7 });
  expect(Number(document.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  expect(document.body.textContent).toContain("3 of 7 images downloaded");
  expect(document.querySelector(".deploy-steps li:nth-child(3)")!.textContent).toContain("Already done");
});

test("the image step shows the source being tested, then the one in use", async () => {
  const entry = await fixture({ platform: "darwin", probes: { external: probe("needs-setup"), managed: probe("needs-setup") } });
  await credentials();
  await submit();
  await entry.publish({ ...envelope, type: "stage", stage: "pull", status: "started" });
  expect(document.querySelector(".deploy-sources")!.textContent).toContain("Testing which source is fastest");
  expect(Array.from(document.querySelectorAll(".deploy-sources li")).map(item => item.getAttribute("data-state"))).toEqual(["testing", "testing", "testing"]);
  await entry.publish({ ...envelope, type: "log", stage: "pull", message: "Pulling server from ghcr.nju.edu.cn." });
  expect(document.querySelector(".deploy-sources")!.textContent).toContain("Downloading from Nanjing University");
  expect(Array.from(document.querySelectorAll(".deploy-sources li")).map(item => item.getAttribute("data-state"))).toEqual(["idle", "active", "idle"]);
  await entry.publish({ ...envelope, type: "log", stage: "pull", message: "Pulling worker from m.daocloud.io." });
  expect(Array.from(document.querySelectorAll(".deploy-sources li")).map(item => item.getAttribute("data-state"))).toEqual(["idle", "used", "active"]);
});

test("with an engine of your own the images follow its settings and no mirror list is shown", async () => {
  const entry = await fixture({ platform: "darwin", probes: { external: probe("ready"), managed: probe("needs-setup") } });
  await credentials();
  await submit();
  await entry.publish({ ...envelope, type: "stage", stage: "pull", status: "started" });
  expect(document.querySelector(".deploy-sources")).toBeNull();
  expect(document.querySelector(".deploy-sources-note")!.textContent).toContain("OutcomeGo changes nothing in Docker");
});
