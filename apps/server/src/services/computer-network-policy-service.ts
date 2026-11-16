import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@outcomego/db";
import {
  COMPUTER_NETWORK_POLICY_MODES,
  normalizeComputerNetworkAddress,
  normalizeComputerNetworkPort,
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

const mode = (value: unknown): ComputerNetworkPolicyMode => {
  if (typeof value === "string" && COMPUTER_NETWORK_POLICY_MODES.includes(value as ComputerNetworkPolicyMode))
    return value as ComputerNetworkPolicyMode;
  throw new ApiError(400, "computer_network_policy_mode_invalid", "Choose a valid computer network policy mode.");
};

const storedMode = (value: unknown): ComputerNetworkPolicyMode =>
  value === "managed" ? "allowlist" : mode(value);

const rule = (value: unknown, index: number): ComputerNetworkPolicyRule => {
  const input = record(value);
  const address = typeof input.address === "string" ? normalizeComputerNetworkAddress(input.address) : null;
  if (!address)
    throw new ApiError(400, "computer_network_policy_address_invalid", `Rule ${index + 1} must use a private IP address or a subnet fully inside private address space.`);
  const port = normalizeComputerNetworkPort(input.port);
  if (port === null)
    throw new ApiError(400, "computer_network_policy_port_invalid", `Rule ${index + 1} must use a TCP port or an ascending port range from 1 to 65535.`);
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
    port,
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

const storedRules = (value: unknown): ComputerNetworkPolicyRule[] => {
  try {
    return rules(value);
  } catch {
    throw new ApiError(500, "computer_network_policy_corrupt", "The stored computer network policy is invalid and was not changed.");
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
      rules: storedRules(row.rules),
      revision: row.revision,
    };
  }

  async view(): Promise<ComputerNetworkPolicyView> {
    const row = await this.row();
    const runtime = await this.runtime();
    return {
      policy: {
        mode: storedMode(row.mode),
        rules: storedRules(row.rules),
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

  async prepareBotRequest(input: unknown): Promise<ComputerNetworkPolicyUpdate> {
    const value = record(input);
    const nextMode = mode(value.mode);
    const current = await this.row();
    if (nextMode !== storedMode(current.mode))
      throw new ApiError(409, "computer_network_policy_mode_change_requires_owner", "Bot firewall requests can add rules only in the current mode. Change the active mode in Settings first.");
    const requestedRules = rules(value.rules);
    if (nextMode === "allowlist" && requestedRules.length === 0)
      throw new ApiError(400, "computer_network_policy_rules_required", "An allowlist request must add at least one TCP rule.");
    const mergedRules = new Map<string, ComputerNetworkPolicyRule>(
      rules(current.rules).map((item) => [`${item.address}/${item.port}`, item])
    );
    for (const item of requestedRules) {
      const key = `${item.address}/${item.port}`;
      if (!mergedRules.has(key)) mergedRules.set(key, item);
    }
    return {
      expectedRevision: current.revision,
      mode: nextMode,
      rules: rules([...mergedRules.values()]),
    };
  }

  async applyApproved(
    approvalId: string,
    botId: string,
    channelId: string
  ): Promise<ComputerNetworkPolicyView> {
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      const approval = await tx.computerNetworkPolicyApproval.findFirst({
        where: {
          id: approvalId,
          botId,
          channelId,
          status: "approved",
          consumedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (!approval)
        throw new ApiError(403, "computer_network_policy_approval_invalid", "The firewall approval is missing, expired, or already used.");

      const current = await tx.computerNetworkPolicy.findUnique({ where: { id: "global" } });
      if (!current || current.revision !== approval.expectedRevision)
        throw new ApiError(409, "computer_network_policy_revision_conflict", "The computer network policy changed. Request a new approval.");
      const approvedRules = rules(approval.rules);
      const approvedByDestination = new Map(approvedRules.map((item) => [`${item.address}/${item.port}`, item]));
      if (storedMode(current.mode) !== approval.mode || rules(current.rules).some((item) => {
        const approved = approvedByDestination.get(`${item.address}/${item.port}`);
        return !approved || approved.id !== item.id || approved.label !== item.label;
      }))
        throw new ApiError(409, "computer_network_policy_request_not_additive", "This firewall request would replace existing settings. Request a new approval to add rules.");

      const result = await tx.computerNetworkPolicy.updateMany({
        where: { id: "global", revision: approval.expectedRevision },
        data: {
          mode: approval.mode,
          rules: approval.rules as Prisma.InputJsonValue,
          revision: { increment: 1 },
        },
      });
      if (!result.count)
        throw new ApiError(409, "computer_network_policy_revision_conflict", "The computer network policy changed. Request a new approval.");

      await tx.computerNetworkPolicyApproval.update({
        where: { id: approval.id },
        data: { consumedAt: now },
      });
    });
    return this.view();
  }
}
