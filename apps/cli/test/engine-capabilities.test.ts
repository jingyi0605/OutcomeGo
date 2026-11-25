import { expect, test } from "bun:test";
import { probeComputerCapabilities } from "../src/engine/computer-capabilities";
import type { EngineProvider } from "../src/engine/types";
import type { RunResult } from "../src/process";

const image = `ghcr.io/example/outcomego-computer@sha256:${"a".repeat(64)}`;
const success = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
const failure = (stderr: string, status = 1): RunResult => ({ status, stdout: "", stderr });

class FakeEngine implements Pick<EngineProvider, "docker"> {
  readonly calls: string[][] = [];

  constructor(private readonly results: RunResult[]) {}

  docker(args: readonly string[]): RunResult {
    this.calls.push([...args]);
    const result = this.results.shift();
    if (!result) throw new Error(`Unexpected invocation: ${args.join(" ")}`);
    return result;
  }
}

test("probes the cached image in a short-lived container without network or mounts", () => {
  const engine = new FakeEngine([success(), success("systempaths\ncgroup\ntun\n")]);
  expect(probeComputerCapabilities(engine, image)).toEqual({ state: "passed" });
  expect(engine.calls[0]).toEqual(["image", "inspect", "--format", "{{.Id}}", image]);
  expect(engine.calls[1]).toEqual([
    "run", "--rm", "--pull=never", "--network=none", "--cgroupns=private",
    "--cap-drop=ALL", "--cap-add=SYS_ADMIN", "--cap-add=NET_ADMIN",
    "--security-opt=seccomp:unconfined", "--security-opt=apparmor:unconfined",
    "--security-opt=label:disable", "--security-opt=systempaths=unconfined",
    "--device=/dev/net/tun:/dev/net/tun", "--entrypoint=/usr/bin/timeout",
    image, "--kill-after=1s", "10s", "/bin/sh", "-c", expect.any(String),
  ]);
});

test("a missing image defers the probe without trying to download it", () => {
  const engine = new FakeEngine([failure("Error response from daemon: No such image")]);
  expect(probeComputerCapabilities(engine, image)).toEqual({ state: "not-cached" });
  expect(engine.calls).toHaveLength(1);
});

test("reports confirmed capability failures by name", () => {
  const engine = new FakeEngine([success(), success("systempaths\nno-cgroup\nno-tun\n")]);
  const result = probeComputerCapabilities(engine, image);
  expect(result).toMatchObject({ state: "incompatible", missing: ["cgroup", "tun"] });
});

test.each([
  ["invalid --security-opt: systempaths=unconfined", "systempaths"],
  ["error gathering device information while adding custom device /dev/net/tun: no such file", "tun"],
])("reports a recognized container creation error: %s", (error, capability) => {
  const engine = new FakeEngine([success(), failure(error, 125)]);
  expect(probeComputerCapabilities(engine, image)).toMatchObject({
    state: "incompatible", missing: [capability],
  });
});

test("does not confuse timeouts, daemon errors, or partial output with missing capabilities", () => {
  const interrupted = { ...failure("test-secret-do-not-print", 124), stdout: "systempaths\n" };
  const failed = { state: "failed" } as const;
  expect(probeComputerCapabilities(new FakeEngine([success(), interrupted]), image)).toEqual(failed);
  expect(probeComputerCapabilities(new FakeEngine([failure("Cannot connect to the Docker daemon")]), image)).toEqual(failed);
  expect(probeComputerCapabilities(new FakeEngine([success(), success("tun\n")]), image)).toEqual(failed);
});

test("rejects mutable image references before Docker executes anything", () => {
  const engine = new FakeEngine([]);
  expect(() => probeComputerCapabilities(engine, "outcomego-computer:latest")).toThrow();
  expect(engine.calls).toEqual([]);
});
