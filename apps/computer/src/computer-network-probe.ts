import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import type { Duplex } from "node:stream";
import type { NetworkRoute } from "@outcomego/plugin-sdk/browser-network/protocol";
import { createEgressProbe } from "./browser-network-egress";
import { createQualityProbe } from "./browser-network-quality";
import { probeNetworkFamily } from "./network-connectivity";

/** The single list of probes the ordinary-path child may run. The parent
 * (`probeComputerNetwork`) and the child entry (`parseComputerProbeRequest`) both
 * derive from it, so a kind the parent can send is always one the child accepts. */
export const computerProbeKinds = ["egress", "quality", "ipv4", "ipv6"] as const;
export type ComputerProbeKind = (typeof computerProbeKinds)[number];

export function parseComputerProbeRequest(input: string): { kind: ComputerProbeKind; route: NetworkRoute } {
  const value = JSON.parse(input) as { kind?: unknown; route?: NetworkRoute };
  if (!computerProbeKinds.includes(value.kind as ComputerProbeKind) || !value.route?.epoch)
    throw new Error("Invalid computer network probe request");
  return { kind: value.kind as ComputerProbeKind, route: value.route };
}

/** Fixed, non-sensitive failure reasons. Child output is never forwarded. */
export type ComputerProbeFailure = "timeout" | "aborted" | `exit_${number}` | "bad_output" | "spawn_failed";
export class ComputerProbeError extends Error {
  constructor(readonly reason: ComputerProbeFailure) {
    super("Computer network unavailable");
  }
}

/** This child deliberately has no transport mark. Its ordinary sockets/DNS
 * must traverse the kernel policy, just like a dock app or sudo curl. */
export async function runOrdinaryProbe(kind: ComputerProbeKind, route: NetworkRoute) {
  const client = {
    route,
    available: () => true,
    open: (host: string, port: number, signal?: AbortSignal) =>
      new Promise<Duplex>((resolve, reject) => {
        const socket = createConnection({ host, port, signal });
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
        socket.setTimeout(6000, () => socket.destroy(new Error("Computer probe timeout")));
      }),
  };
  if (kind === "ipv4" || kind === "ipv6")
    return probeNetworkFamily(client.open, kind, AbortSignal.timeout(5000));
  return kind === "egress" ? createEgressProbe(client)() : createQualityProbe(client)();
}

export function probeComputerNetwork(kind: ComputerProbeKind, route: NetworkRoute, signal: AbortSignal) {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1]!, "--computer-network-probe"], {
      env: { PATH: process.env.PATH },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const abort = () => child.kill();
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, kind === "quality" ? 21_000 : 8500);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdin!.on("error", () => {});
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      if (output.length > 8192) child.kill();
    });
    child.stderr!.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new ComputerProbeError("spawn_failed"));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (timedOut) return reject(new ComputerProbeError("timeout"));
      if (signal.aborted) return reject(new ComputerProbeError("aborted"));
      if (code !== 0) return reject(new ComputerProbeError(`exit_${code ?? 0}`));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new ComputerProbeError("bad_output"));
      }
    });
    child.stdin!.end(JSON.stringify({ kind, route }) + "\n");
  });
}
