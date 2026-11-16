import type { ExternalMessagingBindingView } from "@outcomego/contracts";
import type { ExternalMessagingBinding } from "@outcomego/db";

export type { ExternalMessagingBindingView, ExternalMessagingView } from "@outcomego/contracts";

const counts = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])
    )
  );
};

/** Diagnostics only: no cursor, lease owner or retry bookkeeping leaves the Server. */
export const bindingView = (binding: ExternalMessagingBinding): ExternalMessagingBindingView => ({
  enabled: binding.enabled,
  botId: binding.botId,
  inboundPolicy: binding.inboundPolicy,
  status: binding.status,
  lastPolledAt: binding.lastPolledAt?.toISOString() ?? null,
  lastAcceptedAt: binding.lastAcceptedAt?.toISOString() ?? null,
  lastErrorCode: binding.lastErrorCode,
  lastErrorAt: binding.lastErrorAt?.toISOString() ?? null,
  consecutiveFailures: binding.consecutiveFailures,
  rejectedCounts: counts(binding.rejectedCounts),
});
