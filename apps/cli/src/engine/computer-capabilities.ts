import type { EngineProvider } from "./types";

const capabilities = ["systempaths", "cgroup", "tun"] as const;
type ComputerCapability = (typeof capabilities)[number];

type ComputerCapabilityProbe =
  | { state: "passed" | "not-cached" | "failed" }
  | { state: "incompatible"; missing: ComputerCapability[] };

const probe = `
if awk '$5 == "/proc/kcore" { masked = 1 } END { exit masked }' /proc/self/mountinfo; then
  printf 'systempaths\n'
else
  printf 'no-systempaths\n'
fi
if test -r /sys/fs/cgroup/cgroup.controllers && mount -o remount,rw /sys &&
   mount -o remount,rw /sys/fs/cgroup && mkdir /sys/fs/cgroup/outcomego-probe &&
   rmdir /sys/fs/cgroup/outcomego-probe; then
  printf 'cgroup\n'
else
  printf 'no-cgroup\n'
fi
if test -c /dev/net/tun && ip tuntap add dev outcomego-probe mode tun; then
  printf 'tun\n'
else
  printf 'no-tun\n'
fi`;

export const probeComputerCapabilities = (
  engine: Pick<EngineProvider, "docker">,
  image: string
): ComputerCapabilityProbe => {
  if (!/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error("The computer capability probe requires a digest-pinned image.");
  }
  const inspected = engine.docker(["image", "inspect", "--format", "{{.Id}}", image], {
    timeoutMs: 10_000,
  });
  if (inspected.status !== 0) {
    return { state: /no such (?:image|object)/i.test(inspected.stderr) ? "not-cached" : "failed" };
  }
  const result = engine.docker([
    "run", "--rm", "--pull=never", "--network=none", "--cgroupns=private",
    "--cap-drop=ALL", "--cap-add=SYS_ADMIN", "--cap-add=NET_ADMIN",
    "--security-opt=seccomp:unconfined", "--security-opt=apparmor:unconfined",
    "--security-opt=label:disable", "--security-opt=systempaths=unconfined",
    "--device=/dev/net/tun:/dev/net/tun", "--entrypoint=/usr/bin/timeout",
    image, "--kill-after=1s", "10s", "/bin/sh", "-c", probe,
  ], { timeoutMs: 30_000 });
  if (result.status !== 0) {
    if (result.status === 125 && /(?:invalid|unsupported|unknown).*security.opt.*systempaths/i.test(result.stderr)) {
      return { state: "incompatible", missing: ["systempaths"] };
    }
    if (result.status === 125 && /(?:adding|gathering).*device.*\/dev\/net\/tun/i.test(result.stderr)) {
      return { state: "incompatible", missing: ["tun"] };
    }
    return { state: "failed" };
  }
  const lines = result.stdout.trim().split(/\r?\n/);
  if (lines.length !== capabilities.length) return { state: "failed" };
  const missing: ComputerCapability[] = [];
  for (const [index, capability] of capabilities.entries()) {
    if (lines[index] === `no-${capability}`) missing.push(capability);
    else if (lines[index] !== capability) return { state: "failed" };
  }
  return missing.length ? { state: "incompatible", missing } : { state: "passed" };
};
