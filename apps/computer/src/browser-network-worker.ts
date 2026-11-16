import { BrowserNetworkClient } from "@outcomego/plugin-sdk/browser-network/client";
import { createBrowserProxy } from "@outcomego/plugin-sdk/browser-network/socks";
import { createQualityProbe } from "./browser-network-quality";
import { createEgressProbe } from "./browser-network-egress";
import { createInterface } from "node:readline";
import { isIP } from "node:net";
import {
  startComputerDns,
  createDnsExchange,
  globalIpv6Address,
  probeIpv6Route,
} from "./computer-network-dns";
import {
  ComputerProbeError,
  parseComputerProbeRequest,
  probeComputerNetwork,
  runOrdinaryProbe,
} from "./computer-network-probe";
import { startManagementDiscovery } from "./computer-network-management";
import { startHostBridgeDiscovery } from "./computer-network-host-bridge";
import { startComputerNetworkPolicy } from "./computer-network-policy";
import {
  startNetworkConnectivity,
  probeNetworkFamily,
  applyNetworkFamilies,
} from "./network-connectivity";
import type {
  NetworkDnsDiagnostic,
  NetworkFamilyHealth,
} from "@outcomego/plugin-sdk/browser-network/protocol";

const lines = createInterface({ input: process.stdin });
let shutdown: (() => void) | undefined,
  parentClosed = false;
lines.once("close", () => {
  parentClosed = true;
  shutdown?.();
});
const input = await new Promise<string>((resolve, reject) => {
  lines.once("line", resolve);
  lines.once("close", () => reject(new Error("Browser network parent disconnected")));
});
if (input.length > 8192) throw new Error("Invalid browser network configuration");
if (process.argv.includes("--computer-network-probe")) {
  try {
    const probe = parseComputerProbeRequest(input);
    console.log(JSON.stringify(await runOrdinaryProbe(probe.kind, probe.route)));
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
const config = JSON.parse(input) as {
  serverUrl: string;
  token: string;
  port: number;
  computerNetwork?: boolean;
};
const diagnostics = new Set<AbortController>();
let diagnosticEpoch: string | undefined;
let dnsExchange: ReturnType<typeof createDnsExchange> | undefined;
let connectivity: ReturnType<typeof startNetworkConnectivity> | undefined;
let policy: ReturnType<typeof startComputerNetworkPolicy> | undefined;
let managementReady = !config.computerNetwork;
let policyReady = !config.computerNetwork;
let clientStarted = false;
const startClient = () => {
  if (clientStarted || !managementReady || !policyReady) return;
  clientStarted = true;
  client.start();
};
const statusView = () => ({
  ...client.status(),
  routeEpoch: client.route?.epoch,
  connectivity: connectivity?.status(),
  policy: policy?.status(),
});
// The computer can only serve the IPv6 destinations its own exit can route.
// Device exits resolve and dial on the device, so they keep their own AAAA results.
let ipv6Usable = false,
  ipv6Probing: Promise<void> | undefined;
const suppressIpv6 = () => !ipv6Usable && client.route?.mode !== "device";
const refreshIpv6 = () => {
  if (!globalIpv6Address()) {
    ipv6Usable = false;
    return Promise.resolve();
  }
  ipv6Probing ??= probeIpv6Route()
    .then((usable) => {
      ipv6Usable = usable;
    })
    .finally(() => {
      ipv6Probing = undefined;
    });
  return ipv6Probing;
};
const url = new URL(
  `${config.serverUrl.replace(/\/$/, "")}/api/v0/internal/browser-network/channel`
);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
const client: BrowserNetworkClient = new BrowserNetworkClient({
  role: "computer",
  url: url.href,
  headers: { authorization: `Bearer ${config.token}` },
  resolver: (route) => (route.mode === "server" ? "docker" : "device-exit"),
  diagnostic: (diagnostic: NetworkDnsDiagnostic) =>
    console.log(JSON.stringify({ dns: diagnostic })),
  changed: () => {
    dnsExchange?.syncRoute();
    void refreshIpv6();
    const epoch = client.available() ? client.route?.epoch : undefined;
    if (epoch !== diagnosticEpoch) {
      diagnosticEpoch = epoch;
      for (const diagnostic of diagnostics) diagnostic.abort();
    }
    connectivity?.sync();
    console.log(JSON.stringify(statusView()));
  },
});
connectivity = startNetworkConnectivity({
  route: () =>
    client.available() && client.route
      ? {
          epoch: client.route.epoch,
          sourceId: client.route.mode === "server" ? "server" : client.route.machineId!,
        }
      : null,
  probe: (family, signal) =>
    probeNetworkFamily((host, port, life) => client.open(host, port, life), family, signal),
  verify: config.computerNetwork
    ? async (family, signal) => {
        const route = client.route;
        if (!route || !client.available()) throw new Error("Route unavailable");
        try {
          return (await probeComputerNetwork(family, route, signal)) as NetworkFamilyHealth;
        } catch (error) {
          // A failed verification silently removes the exit route. Report a fixed
          // reason code so the cause is visible without forwarding child output.
          if (error instanceof ComputerProbeError)
            console.log(JSON.stringify({ verifyFailed: { family, reason: error.reason } }));
          throw error;
        }
      }
    : undefined,
  apply: config.computerNetwork ? applyNetworkFamilies : async () => {},
  changed: () => {
    dnsExchange?.syncRoute();
    console.log(JSON.stringify(statusView()));
  },
  failed: () => process.exit(1),
});
const proxy = createBrowserProxy((host, port) =>
  // Fail a literal IPv6 destination at once instead of accepting then closing mid-TLS.
  isIP(host) === 6 && suppressIpv6()
    ? Promise.reject(new Error("ipv6_unavailable"))
    : client.open(host, port)
);
const port = await proxy.listen(config.port);
await refreshIpv6();
dnsExchange = config.computerNetwork
  ? createDnsExchange(client, {
      routeKey: () => (client.available() ? (client.route?.epoch ?? null) : null),
      ipv6: () =>
        connectivity?.status()?.ipv6.state === "working" &&
        connectivity?.status()?.ipv4.state !== "working",
      resolver: () => (client.route?.mode === "server" ? "docker" : "doh"),
    })
  : undefined;
const dns = dnsExchange ? await startComputerDns(dnsExchange) : undefined;
const management = config.computerNetwork
  ? startManagementDiscovery(config.serverUrl, () => {
      managementReady = true;
      startClient();
    })
  : undefined;
const hostBridge = config.computerNetwork ? startHostBridgeDiscovery(config.serverUrl) : undefined;
policy = config.computerNetwork
  ? startComputerNetworkPolicy({
      serverUrl: config.serverUrl,
      token: config.token,
      applied: () => {
        const wasReady = policyReady;
        policyReady = true;
        if (clientStarted && wasReady) client.reconnect("route_invalidated");
        else startClient();
      },
    })
  : undefined;
if (!config.computerNetwork) startClient();
const egress = createEgressProbe(client);
const quality = createQualityProbe(client);
const checking = new Set<string>();
const ordinaryCache = new Map<string, { epoch: string; until: number; result?: unknown }>();
const ordinaryProbe = async (
  kind: "quality" | "egress",
  route: NonNullable<typeof client.route>,
  signal: AbortSignal
) => {
  const cached = ordinaryCache.get(kind);
  if (cached?.epoch === route.epoch && performance.now() < cached.until) {
    if (cached.result) return cached.result;
    throw new Error("Computer network unavailable");
  }
  try {
    const result = await probeComputerNetwork(kind, route, signal);
    if (!client.available() || client.route?.epoch !== route.epoch) throw new Error();
    ordinaryCache.set(kind, {
      epoch: route.epoch,
      until: performance.now() + (kind === "egress" ? 120_000 : 60_000),
      result,
    });
    return result;
  } catch (error) {
    ordinaryCache.set(kind, {
      epoch: route.epoch,
      until: performance.now() + (kind === "egress" ? 120_000 : 60_000),
    });
    throw error;
  }
};
lines.on("line", (line) => {
  if (line.length > 256) return;
  try {
    const command = JSON.parse(line);
    if (
      !["egress", "quality"].includes(command.op) ||
      typeof command.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(command.id)
    )
      return;
    const id = command.id;
    if (checking.has(command.op)) {
      console.log(JSON.stringify({ id, error: true }));
      return;
    }
    checking.add(command.op);
    const route = client.route;
    const controller = new AbortController();
    diagnostics.add(controller);
    void (
      config.computerNetwork
        ? route && client.available()
          ? ordinaryProbe(command.op, route, controller.signal)
          : Promise.reject(new Error("Computer network unavailable"))
        : command.op === "quality"
          ? quality()
          : egress()
    )
      .then((result) => console.log(JSON.stringify({ id, result })))
      .catch(() => console.log(JSON.stringify({ id, error: true })))
      .finally(() => {
        checking.delete(command.op);
        diagnostics.delete(controller);
      });
  } catch {
    /* Private bounded command channel. */
  }
});
console.log(JSON.stringify({ started: true, port }));
const status = setInterval(() => {
  console.log(JSON.stringify(statusView()));
  console.log(JSON.stringify({ gateway: proxy.stats() }));
}, 1000);
shutdown = () => {
  clearInterval(status);
  management?.stop();
  hostBridge?.stop();
  policy?.stop();
  for (const diagnostic of diagnostics) diagnostic.abort();
  dns?.close();
  dnsExchange?.close();
  client.stop();
  void Promise.all([connectivity?.close(), proxy.close()]).then(
    () => process.exit(0),
    () => process.exit(1)
  );
};
if (parentClosed) shutdown();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, shutdown);
