import { Prisma, type PrismaClient } from "@outcomego/db";
import type { PluginMessaging } from "@outcomego/plugin-sdk";
import { definitionFromManifest } from "../plugin/values";

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The database clock as a UTC timestamp. Prisma stores `timestamp(3)` columns as UTC, so
 * comparing them with a bare `now()` would depend on the session time zone. Lease and expiry
 * decisions use this so that two Servers with different clocks still agree.
 */
export const DB_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** The `messaging` declaration of a connection's connector, or undefined when it has none. */
export const messagingOf = (
  connection: { connectorKey: string; installation: { manifest: unknown } }
): PluginMessaging | undefined =>
  definitionFromManifest(connection.installation.manifest)?.connections.find(
    (connector) => connector.key === connection.connectorKey
  )?.messaging;

/** Bounded, single-line text for logs and diagnostics. */
export const shortCode = (value: unknown, max = 100): string =>
  String(value).replace(/[^\w.:-]/g, "_").slice(0, max);

export const isUniqueViolation = (error: unknown): boolean => {
  const text = String((error as { code?: unknown; message?: unknown })?.code ?? "") + String((error as Error)?.message ?? "");
  return /P2002|23505|Unique constraint/i.test(text);
};

/** A thrown marker inside a transaction that rolls it back and carries a reason out. */
export class Rollback extends Error {
  constructor(
    readonly reason: "retry" | "target_unavailable" | "channel_unavailable" | "conflict" | "duplicate"
  ) {
    super(reason);
    this.name = "Rollback";
  }
}

/**
 * The payload of a connector tool call: `structuredContent` when present, otherwise the JSON text
 * of the single text item. An `isError` result throws a short, body-free error.
 */
export const toolResultValue = (raw: unknown): unknown => {
  const result = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const text = Array.isArray(result.content)
    ? result.content
        .filter((part): part is { type: "text"; text: string } => !!part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string")
        .map((part) => part.text)
        .join("\n")
    : "";
  if (result.isError === true) throw new ToolResultError(shortCode(text.split(/[:\s]/)[0] ?? "", 60) || "tool_error");
  if (result.structuredContent !== undefined) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolResultError("unreadable_result");
  }
};

/** A connector tool failed or returned something unreadable. Carries only a code. */
export class ToolResultError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ToolResultError";
  }
}
