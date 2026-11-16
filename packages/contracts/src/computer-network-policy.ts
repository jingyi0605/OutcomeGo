export const COMPUTER_NETWORK_POLICY_MODES = ["lan", "allowlist"] as const;
export type ComputerNetworkPolicyMode = (typeof COMPUTER_NETWORK_POLICY_MODES)[number];

export interface ComputerNetworkPolicyRule {
  id: string;
  address: string;
  port: number | string;
  label: string | null;
}

type ParsedAddress = { address: string; version: 4 | 6; start: bigint; prefix: number };

const parseIPv4 = (value: string): bigint | null => {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith("0")))) return null;
  return parts.reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n);
};

const parseIPv6 = (value: string): bigint | null => {
  if (!value.includes(":") || value.includes("%")) return null;
  let normalized = value.toLowerCase();
  const embedded = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const ipv4 = parseIPv4(embedded[1]!);
    if (ipv4 === null) return null;
    const high = Number((ipv4 >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4 & 0xffffn).toString(16);
    normalized = normalized.slice(0, normalized.lastIndexOf(":")) + `:${high}:${low}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[\da-f]{1,4}$/.test(part))) return null;
  return groups.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
};

const formatIPv6 = (value: bigint): string => {
  const groups = Array.from({ length: 8 }, (_, index) =>
    Number((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16)
  );
  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== "0") { index++; continue; }
    let end = index;
    while (groups[end] === "0") end++;
    if (end - index > bestLength) { bestStart = index; bestLength = end - index; }
    index = end;
  }
  if (bestStart < 0) return groups.join(":");
  return `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLength).join(":")}`;
};

const parseAddress = (value: string): Omit<ParsedAddress, "address"> | null => {
  const sections = value.split("/");
  if (sections.length > 2) return null;
  const host = sections[0]!.trim();
  const version = host.includes(":") ? 6 : 4;
  const bits = version === 4 ? 32 : 128;
  const raw = version === 4 ? parseIPv4(host) : parseIPv6(host);
  if (raw === null) return null;
  let prefix = bits;
  if (sections.length === 2) {
    const mask = sections[1]!.trim();
    if (version === 4 && mask.includes(".")) {
      const value = parseIPv4(mask);
      if (value === null) return null;
      const inverse = (~value) & 0xffffffffn;
      if ((inverse & (inverse + 1n)) !== 0n) return null;
      prefix = 32 - inverse.toString(2).replaceAll("0", "").length;
    } else {
      if (!/^\d{1,3}$/.test(mask)) return null;
      prefix = Number(mask);
    }
  }
  if (prefix < 0 || prefix > bits) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  const start = raw & mask;
  return { version, start, prefix };
};

/** Normalize a private IPv4/IPv6 host or subnet. IPv4 accepts CIDR or a dotted mask. */
export function normalizeComputerNetworkAddress(value: string): string | null {
  const parsed = parseAddress(value.trim());
  if (!parsed) return null;
  const bits = parsed.version === 4 ? 32 : 128;
  const end = parsed.start + ((1n << BigInt(bits - parsed.prefix)) - 1n);
  const privateRanges: Array<[string, number]> = parsed.version === 4
    ? [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["169.254.0.0", 16]]
    : [["fc00::", 7], ["fe80::", 10]];
  const isPrivate = privateRanges.some(([base, prefix]) => {
    const range = parseAddress(`${base}/${prefix}`);
    if (!range) return false;
    const rangeEnd = range.start + ((1n << BigInt(bits - prefix)) - 1n);
    return parsed.start >= range.start && end <= rangeEnd;
  });
  if (!isPrivate) return null;
  const address = parsed.version === 4
    ? [24n, 16n, 8n, 0n].map((shift) => Number((parsed.start >> shift) & 255n)).join(".")
    : formatIPv6(parsed.start);
  return parsed.prefix === bits ? address : `${address}/${parsed.prefix}`;
}

/** Normalize one TCP port or an inclusive ascending port range. */
export function normalizeComputerNetworkPort(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 65535) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const single = /^(\d{1,5})$/.exec(normalized);
  if (single) {
    const port = Number(single[1]);
    if (port >= 1 && port <= 65535) return port;
  }
  const range = /^(\d{1,5})-(\d{1,5})$/.exec(normalized);
  if (range) {
    const first = Number(range[1]);
    const last = Number(range[2]);
    if (first >= 1 && first <= last && last <= 65535)
      return first === last ? first : `${first}-${last}`;
  }
  return null;
}

export type ComputerNetworkPolicyRuntimeState =
  | "unknown"
  | "pending"
  | "applying"
  | "applied"
  | "error";

export interface ComputerNetworkPolicyRuntime {
  state: ComputerNetworkPolicyRuntimeState;
  appliedRevision: number | null;
  modelEndpointCount: number;
  error: string | null;
}

export interface ComputerNetworkPolicyView {
  policy: {
    mode: ComputerNetworkPolicyMode;
    rules: ComputerNetworkPolicyRule[];
    revision: number;
    updatedAt: string;
  };
  runtime: ComputerNetworkPolicyRuntime;
}

export interface ComputerNetworkPolicyUpdate {
  expectedRevision: number;
  mode: ComputerNetworkPolicyMode;
  rules: ComputerNetworkPolicyRule[];
}

export interface ComputerNetworkPolicySnapshot {
  mode: ComputerNetworkPolicyMode;
  rules: ComputerNetworkPolicyRule[];
  revision: number;
}

export interface ComputerNetworkPolicyStatus {
  state: Exclude<ComputerNetworkPolicyRuntimeState, "unknown">;
  appliedRevision: number | null;
  modelEndpointCount: number;
  error: string | null;
}
