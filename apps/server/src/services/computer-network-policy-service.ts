import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Prisma, type PrismaClient } from "@outcomego/db";
import {
  COMPUTER_NETWORK_POLICY_MODES,
  type ComputerNetworkPolicyMode,
  type ComputerNetworkPolicyRule,
  type ComputerNetworkPolicySnapshot,
  type ComputerNetworkPolicyStatus,
  type ComputerNetworkPolicyUpdate,
  type ComputerNetworkPolicyView,
} from "@outcomego/contracts";
import { ApiError } from "@outcomego/contracts";

const MAX_RULES = 128;
const MAX_LABEL_LENGTH = 120;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const ipv4 = (value: string): number[] | null => {
  if (isIP(value) !== 4) return null;
  const parts = value.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
};

const isPrivateAddress = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  const v4 = ipv4(normalized);
  if (v4) {
    const a = v4[0] ?? -1;
    const b = v4[1] ?? -1;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(normalized) !== 6 || normalized === "::1") return false;
  return normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
};

const mode = (value: unknown): ComputerNetworkPolicyMode => {
  if (typeof value === "string" && COMPUTER_NETWORK_POLICY_MODES.includes(value as ComputerNetworkPolicyMode))
    return value as ComputerNetworkPolicyMode;
  throw new ApiError(400, "computer_network_policy_mode_invalid", "Choose a valid computer network policy mode.");
};

const storedMode = (value: unknown): ComputerNetworkPolicyMode =>
  value === "managed" ? "allowlist" : mode(value);

const rule = (value: unknown, index: number): ComputerNetworkPolicyRule => {
  const input = record(value);
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const port = input.port;
  if (!address || !isPrivateAddress(address))
    throw new ApiError(400, "computer_network_policy_address_invalid", `Rule ${index + 1} must use a private IP address.`);
  if (!Number.isSafeInteger(port) || Number(port) < 1 || Number(port) > 65535)
    throw new ApiError(400, "computer_network_policy_port_invalid", `Rule ${index + 1} must use a TCP port from 1 to 65535.`);
  const label =
    input.label === undefined || input.label === null || input.label === ""
      ? null
      : typeof input.label === "string" && input.label.trim().length <= MAX_LABEL_LENGTH
        ? input.label.trim()
        : null;
  if (input.label !== undefined && input.label !== null && input.label !== "" && label === null)
    throw new ApiError(400, "computer_network_policy_label_invalid", `Rule ${index + 1} has an invalid label.`);
  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID(),
    address,
    port: Number(port),
    label,
  };
};

const rules = (value: unknown): ComputerNetworkPolicyRule[] => {
  if (!Array.isArray(value) || value.length > MAX_RULES)
    throw new ApiError(400, "computer_network_policy_rules_invalid", `Computer network policy supports at most ${MAX_RULES} rules.`);
  const parsed = value.map(rule);
  const seen = new Set<string>();
  for (const item of parsed) {
    const key = `${item.address}/${item.port}`;
    if (seen.has(key))
      throw new ApiError(400, "computer_network_policy_rule_duplicate", `Rule ${key} appears more than once.`);
    seen.add(key);
  }
  return parsed;
};

const normalizeRules = (value: unknown): ComputerNetworkPolicyRule[] => {
  try {
    return rules(value);
  } catch {
    return [];
  }
};

export class ComputerNetworkPolicyService {
  constructor(
    private readonly db: PrismaClient,
    private readonly runtime: () => Promise<ComputerNetworkPolicyStatus | undefined> = async () => undefined
  ) {}

  private async row() {
    return this.db.computerNetworkPolicy.upsert({
      where: { id: "global" },
      create: { id: "global", mode: "lan", rules: [], revision: 1 },
      update: {},
    });
  }

  async snapshot(): Promise<ComputerNetworkPolicySnapshot> {
    const row = await this.row();
    return {
      mode: storedMode(row.mode),
      rules: normalizeRules(row.rules),
      revision: row.revision,
    };
  }

  async view(): Promise<ComputerNetworkPolicyView> {
    const row = await this.row();
    const runtime = await this.runtime();
    return {
      policy: {
        mode: storedMode(row.mode),
        rules: normalizeRules(row.rules),
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
      },
      runtime: runtime ?? {
        state: "unknown",
        appliedRevision: null,
        modelEndpointCount: 0,
        error: null,
      },
    };
  }

  async update(input: unknown): Promise<ComputerNetworkPolicyView> {
    const value = record(input);
    const expectedRevision = value.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1)
      throw new ApiError(400, "computer_network_policy_revision_invalid", "expectedRevision must be a positive integer.");
    const nextMode = mode(value.mode);
    const nextRules = rules(value.rules);
    const result = await this.db.computerNetworkPolicy.updateMany({
      where: { id: "global", revision: Number(expectedRevision) },
      data: { mode: nextMode, rules: nextRules as unknown as Prisma.InputJsonValue, revision: { increment: 1 } },
    });
    if (!result.count)
      throw new ApiError(409, "computer_network_policy_revision_conflict", "The computer network policy changed. Reload it and try again.");
    return this.view();
  }
}
