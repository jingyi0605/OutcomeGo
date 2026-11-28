import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { safeErrorMessage } from "@outcomego/product-core/redaction";
import type { EngineKind } from "./engine/types";
import { cliTranslate } from "./localization";

export const deployErrorExitCodes = {
  INVALID_INPUT: 2, VIRTUALIZATION_DISABLED: 2, WSL_NOT_ENABLED: 2, REBOOT_REQUIRED: 2,
  ELEVATION_DENIED: 2, WINDOWS_UNSUPPORTED: 2, MACOS_UNSUPPORTED: 2, ENGINE_UNAVAILABLE: 2,
  ENGINE_START_FAILED: 3, ENGINE_INCOMPATIBLE: 2, ASSET_DOWNLOAD_FAILED: 3,
  ASSET_VERIFICATION_FAILED: 1, PORT_IN_USE: 2, DISK_SPACE_LOW: 2, MEMORY_LOW: 2,
  IMAGE_PULL_FAILED: 3, STACK_START_FAILED: 3, HEALTH_TIMEOUT: 3, OWNER_CREATE_FAILED: 3,
  BUSY: 3, CLI_VERSION_MISMATCH: 3, CANCELLED: 130, UNKNOWN: 1,
} as const;

export type DeployErrorCode = keyof typeof deployErrorExitCodes;
export const deployErrorTexts: Record<DeployErrorCode, string> = {
  INVALID_INPUT: "The deployment input is invalid.",
  VIRTUALIZATION_DISABLED: "Enable virtualization in your firmware, then retry.",
  WSL_NOT_ENABLED: "Enable WSL before deploying the managed engine.",
  REBOOT_REQUIRED: "Restart your computer, then reopen OutcomeGo to continue deployment.",
  ELEVATION_DENIED: "Allow the system change or use an existing engine.",
  WINDOWS_UNSUPPORTED: "Managed deployment requires Windows x64 (Windows 10 22H2 or Windows 11 23H2 or later). Connect to an existing server on unsupported hardware.",
  MACOS_UNSUPPORTED: "Managed deployment requires macOS 13.5 or later on Apple Silicon or Intel. Use an existing container engine or server instead.",
  ENGINE_UNAVAILABLE: "Start a local Docker-compatible engine and retry.",
  ENGINE_START_FAILED: "The engine did not start. Check diagnostics and retry.",
  ENGINE_INCOMPATIBLE: "This engine lacks capabilities required by OutcomeGo.",
  ASSET_DOWNLOAD_FAILED: "Download failed. Check your connection or proxy and retry.",
  ASSET_VERIFICATION_FAILED: "The release could not be verified. Retry the download.",
  PORT_IN_USE: "Free the occupied port or choose another API port.",
  DISK_SPACE_LOW: "Free disk space before retrying deployment.",
  MEMORY_LOW: "Available memory is low. Add memory or confirm you want to continue.",
  IMAGE_PULL_FAILED: "Image download failed. Check your connection and retry.",
  STACK_START_FAILED: "Local services could not start. Check diagnostics and retry.",
  HEALTH_TIMEOUT: "Local services did not become healthy. Check diagnostics and retry.",
  OWNER_CREATE_FAILED: "The owner account could not be created. Check your credentials and retry.",
  BUSY: "A local service operation is already running.",
  CLI_VERSION_MISMATCH: "Update the desktop app to use a compatible command-line tool.",
  CANCELLED: "Deployment cancelled.",
  UNKNOWN: "Deployment did not finish. Copy diagnostics and retry.",
};
export const deployErrorText = (code: DeployErrorCode) => cliTranslate(deployErrorTexts[code]);
export type DeployStage = "detect" | "engine" | "release" | "configure" | "pull" | "start" | "health" | "owner";

export interface DeployAction {
  kind: "elevate" | "reboot" | "install-engine" | "free-disk" | "free-port" | "confirm-low-memory";
  detail?: string;
}

type DeployEventBody =
  | { type: "stage"; stage: DeployStage; status: "started" | "progress" | "completed" | "skipped" | "failed"; current?: number; total?: number }
  | { type: "pull-retry"; stage: "pull"; attempt: number; total: number }
  | { type: "log"; stage?: DeployStage }
  | { type: "action-required"; action: DeployAction }
  | { type: "error"; stage: DeployStage; code: DeployErrorCode; retryable: boolean; field?: "username" | "password" | "apiPort" | "stdin"; action?: DeployAction }
  | { type: "result"; result: { url: string; username: string; directory: string; engine: EngineKind; version: string } };

export type DeployEventInput = DeployEventBody & { message?: string };
export type DeployProgressEvent = DeployEventInput & { schemaVersion: 1; ts: string };

export const redactDeployText = (text: string, secretValues: readonly string[] = []): string => {
  let redacted = text;
  for (const secret of secretValues) {
    if (!secret) continue;
    redacted = redacted.replaceAll(secret, "[REDACTED]");
    const encoded = JSON.stringify(secret).slice(1, -1);
    if (encoded !== secret) redacted = redacted.replaceAll(encoded, "[REDACTED]");
  }
  return safeErrorMessage(redacted).replace(
    /\b((?:export[ \t]+)?(?:DATABASE_URL|[A-Z][A-Z0-9_]*(?:_PASSWORD|_TOKEN|_SECRET|_KEY))[ \t]*=[ \t]*).*/gm,
    "$1[REDACTED]"
  );
};

export const emitDeployEvent = (
  event: DeployEventInput,
  options: { write?: (line: string) => unknown; secretValues?: readonly string[] } = {}
): void => {
  const payload: DeployProgressEvent = { ...event, schemaVersion: 1, ts: new Date().toISOString() };
  const encoded = JSON.stringify(payload, (key, value) =>
    typeof value === "string" && ["message", "detail", "url", "directory", "username", "version"].includes(key)
      ? redactDeployText(value, options.secretValues)
      : value
  );
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  write(`${encoded}\n`);
};

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const LOG_NAME = /^bootstrap-[0-9T.Z-]+-[a-f0-9-]{36}\.log$/;

export const createDeployLog = (
  directory: string,
  now = new Date(),
  secretValues: readonly string[] = []
) => {
  const logs = join(directory, "logs");
  mkdirSync(logs, { mode: 0o700, recursive: true });
  if (!lstatSync(logs).isDirectory()) throw new Error("Deployment log path is not a directory.");
  const name = `bootstrap-${now.toISOString().replaceAll(":", "-")}-${randomUUID()}.log`;
  const path = join(logs, name);
  const descriptor = openSync(path, "wx", 0o600);
  try {
    const previous = readdirSync(logs, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== name && LOG_NAME.test(entry.name))
      .map((entry) => entry.name)
      .sort().reverse();
    for (const expired of previous.slice(4)) unlinkSync(join(logs, expired));
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  let bytes = 0;
  let closed = false;
  return {
    path,
    write(text: string) {
      if (closed || bytes >= MAX_LOG_BYTES) return;
      const line = Buffer.from(`${redactDeployText(text, secretValues)}\n`);
      if (line.byteLength > MAX_LOG_BYTES - bytes) return;
      writeFileSync(descriptor, line);
      bytes += line.byteLength;
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(descriptor);
    },
  };
};
