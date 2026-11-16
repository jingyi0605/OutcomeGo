import { ApiError, type DingTalkActionInput, type DingTalkStatus } from "@outcomego/contracts";
import type { PrismaClient } from "@outcomego/db";
import type { ComputerFetch } from "./service-utils";
import { definitionFromManifest } from "./plugin/values";

/** Management only: credentials and DWS execution remain on the configured Bot Computer. */
export class DingTalkService {
  constructor(private readonly prisma: PrismaClient, private readonly computerFetch: ComputerFetch) {}

  async call(input?: DingTalkActionInput): Promise<DingTalkStatus> {
    const installation = await this.prisma.pluginInstallation.findUnique({ where: { pluginKey: "dingtalk-workspace" } });
    if (!installation || installation.status !== "installed")
      throw new ApiError(409, "dingtalk_not_enabled", "Enable the DingTalk plugin first.");
    const definition = definitionFromManifest(installation.manifest);
    if (!definition?.files?.["skills/dingtalk-setup/scripts/dws.sh"])
      throw new ApiError(409, "dingtalk_package_missing", "Update the DingTalk plugin to configure DWS.");
    const response = await this.computerFetch("/v1/dingtalk", {
      method: "POST",
      body: JSON.stringify({ ...(input ? { input } : {}), packageFiles: definition.files }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => { throw new ApiError(503, "dingtalk_computer_unavailable", "Could not reach the Bot Computer. Check its connection and try again."); });
    const result = await response.json().catch(() => ({})) as DingTalkStatus & { error?: string };
    if (!response.ok) throw new ApiError(response.status === 404 ? 409 : 503, "dingtalk_runtime_error",
      response.status === 404 ? "Update the Bot Computer to manage DingTalk from Marketplace." : result.error ?? "The Bot Computer could not complete the DWS request.");
    return result;
  }
}

export function parseDingTalkAction(value: unknown): DingTalkActionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "dingtalk_action_invalid", "Invalid DingTalk action.");
  const input = value as Record<string, unknown>;
  if (!Object.keys(input).every((key) => ["action", "operationId", "promptId", "values"].includes(key)) ||
    !["install", "upgrade", "authenticate", "cancel", "respond"].includes(String(input.action)) ||
    [input.operationId, input.promptId].some((id) => id !== undefined && (typeof id !== "string" || id.length > 100)) ||
    (input.values !== undefined && (!Array.isArray(input.values) || input.values.length > 50 || input.values.some((item) => typeof item !== "string" || !/^\d{1,3}$/.test(item)))))
    throw new ApiError(400, "dingtalk_action_invalid", "Invalid DingTalk action.");
  return input as unknown as DingTalkActionInput;
}
