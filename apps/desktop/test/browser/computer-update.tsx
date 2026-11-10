import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AITEAMOS_API_PROTOCOL_VERSION } from "@aiteamos/contracts/version-compatibility";
import { I18nProvider } from "../../src/renderer/lib/i18n";
import "../../src/renderer/styles.css";
if (window.aiteamos) throw new Error("Synthetic fixture requires an isolated window");
window.open = () => null;
localStorage.setItem("aiteamos:server-url", "https://aiteamos.example");
// Render the interface in the requested language; the provider reads navigator.language first.
const localeOverride = new URLSearchParams(location.search).get("locale");
if (localeOverride)
  Object.defineProperty(navigator, "language", { value: localeOverride, configurable: true });

type Bot = { botId: string; name: string; runIds: string[] };
type ServerStatus = Record<string, unknown> & { status: string; currentVersion: string | null };
declare global {
  interface Window {
    fixture: {
      ready?: boolean;
      busy: Bot[];
      busyChecks: number;
      stops: string[];
      stopDelayMs: number;
      stopClears: boolean;
      updates: Array<{ targetVersion: string | null }>;
      failUpdate: string | null;
      destinations: string[];
      payloads: unknown[];
      offline: boolean;
      versionOffline: boolean;
      statusOffline: boolean;
      links: string[];
      requests: string[];
      desktop: (next: Partial<AiTeamOSUpdateStatus>) => void;
      server: (next: Partial<ServerStatus>) => void;
    };
  }
}

let server: ServerStatus = {
  serverUrl: "https://aiteamos.example",
  currentVersion: "0.0.10",
  targetVersion: "0.0.11",
  apiProtocolVersion: AITEAMOS_API_PROTOCOL_VERSION,
  minimumClientVersion: null,
  maximumClientVersionExclusive: null,
  recommendedClientVersion: null,
  updaterAvailable: true,
  status: "ready",
  phase: null,
  message: null,
  manualCommand: "aiteamos update --version 0.0.11",
  jobId: null,
  safeToCloseDesktop: false,
};
let desktop: AiTeamOSUpdateStatus = {
  currentVersion: "0.0.11", latestVersion: null, status: "idle", progress: null,
  message: null, failureKind: null, track: "stable", downloadUrl: null,
};
const resume = new URLSearchParams(location.search).get("resume");
if (resume === "live") server = { ...server, status: "updating", phase: "verifying", message: "Checking all services…", jobId: "resumed-job", safeToCloseDesktop: true };
if (resume === "complete") server = { ...server, status: "updated", phase: "complete", currentVersion: "0.0.11" };
const desktopListeners = new Set<(status: AiTeamOSUpdateStatus) => void>();
if (new URLSearchParams(location.search).has("unknown")) server.currentVersion = null;

// All native update calls and API requests are synthetic. Nothing is updated or stopped.
const fixture = (window.fixture = {
  busy: [] as Bot[],
  busyChecks: 0,
  stops: [] as string[],
  stopDelayMs: 0,
  stopClears: true,
  updates: [] as Array<{ targetVersion: string | null }>,
  failUpdate: null as string | null,
  destinations: [] as string[],
  payloads: [] as unknown[],
  offline: resume === "offline",
  versionOffline: false,
  statusOffline: false,
  links: [] as string[],
  requests: [] as string[],
  desktop(next: Partial<AiTeamOSUpdateStatus>) {
    desktop = { ...desktop, ...next };
    for (const listener of desktopListeners) listener(desktop);
  },
  server(next: Partial<ServerStatus>) {
    server = { ...server, ...next };
    window.dispatchEvent(new Event("focus"));
  },
});
window.addEventListener("aiteamos:deep-link", (event) => {
  fixture.links.push((event as CustomEvent<{ url: string }>).detail.url);
});
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  fixture.requests.push(url.pathname);
  if (url.pathname === "/api/v0/server-settings/machines") return Response.json([]);
  if (url.pathname === "/api/v0/server-settings/computer-display") return Response.json({ width: 1280, height: 800 });
  if (url.pathname.endsWith("/local-mac/messages")) return Response.json({ sendWithoutAsking: false, allowedRecipients: [] });
  if (url.pathname === "/api/v0/system/activity") return Response.json({ cpuPercent: 5, memoryPercent: 20, diskPercent: 10 });
  if (url.pathname === "/api/v0/system/version") {
    if (fixture.offline || fixture.versionOffline) throw new Error("Server restarting");
    return Response.json({ releaseVersion: server.currentVersion,
      apiProtocolVersion: AITEAMOS_API_PROTOCOL_VERSION });
  }
  if (url.pathname === "/api/v0/system/update") {
    if (fixture.offline || fixture.statusOffline) throw new Error("Server restarting");
    if (init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      fixture.updates.push({ targetVersion: input.targetVersion });
      fixture.destinations.push(url.href);
      fixture.payloads.push(input);
      if (fixture.failUpdate) {
        fixture.server({ status: "error", message: fixture.failUpdate });
        return Response.json({ error: { code: "update_failed", message: fixture.failUpdate } }, { status: 503 });
      }
      fixture.server({ status: "updating", phase: "pulling", safeToCloseDesktop: true,
        message: "Pulling aiTeamOS 0.0.11 container images" });
    }
    return Response.json(server);
  }
  if (url.pathname === "/api/v0/system/busy-bots") {
    fixture.busyChecks++;
    return Response.json({ bots: fixture.busy });
  }
  const stop = url.pathname.match(/^\/api\/v0\/bots\/([^/]+)\/stop$/);
  if (stop && init?.method === "POST") {
    const botId = decodeURIComponent(stop[1]!);
    fixture.stops.push(botId);
    await new Promise((resolve) => setTimeout(resolve, fixture.stopDelayMs));
    if (fixture.stopClears) fixture.busy = fixture.busy.filter((bot) => bot.botId !== botId);
    return Response.json({ hadActiveRun: true });
  }
  throw new Error(`Network disabled in computer update fixture: ${url.pathname}`);
};
window.aiteamos = {
  versions: { app: "0.0.11" },
  auth: {
    machineStatus: async () => ({ machineId: "local-mac", connected: true, configured: true, error: null }),
  },
  computer: {
    get: async () => ({ version: 1, machine: { machineId: "local-mac", label: "This Mac" }, messagesSupported: true, messagesEnabled: false }),
    messagesPermissions: async () => null,
  },
  updates: {
    status: async () => desktop,
    check: async () => desktop,
    onClientProgress(listener: (status: AiTeamOSUpdateStatus) => void) {
      desktopListeners.add(listener);
      return () => desktopListeners.delete(listener);
    },
  },
} as unknown as NonNullable<Window["aiteamos"]>;

const [{ default: ComputerSettings }, { default: ServerSettings }, { default: UpdatesSettings }, { SidebarBotOrderContext }] = await Promise.all([
  import("../../src/renderer/components/aiteamos/settings/computer"),
  import("../../src/renderer/components/aiteamos/settings/server"),
  import("../../src/renderer/components/aiteamos/settings/updates"),
  import("../../src/renderer/lib/sidebar-bot-order"),
]);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      {/* Scout sits above Chief of Staff in the sidebar, although Chief of Staff started first. */}
      <SidebarBotOrderContext.Provider value={["b-scout", "b-chief"]}>
        <main className="mx-auto max-w-[720px] p-8">
          {new URLSearchParams(location.search).has("computer") ? <ComputerSettings /> : new URLSearchParams(location.search).has("server") ? <ServerSettings /> : <UpdatesSettings />}
        </main>
      </SidebarBotOrderContext.Provider>
    </I18nProvider>
  </StrictMode>
);
window.fixture.ready = true;
