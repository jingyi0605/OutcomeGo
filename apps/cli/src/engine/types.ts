import type { InstallationPaths } from "../config";
import type { RunOptions, RunResult } from "../process";
import { deployErrorExitCodes, deployErrorText, type DeployErrorCode } from "../deploy-events";
import { CliError } from "../errors";

export type EngineKind = "external" | "managed-wsl" | "managed-lima";

export interface EngineInfo {
  kind: EngineKind;
  name: string;
  version?: string;
  assetVersion?: string;
  location?: string;
}

export interface EngineDetection {
  state: "ready" | "stopped" | "needs-setup" | "unsupported";
  reasons: string[];
  engineVersion?: string;
  composeVersion?: string;
  cgroupVersion?: string;
  memoryBytes?: number;
  code?: DeployErrorCode;
}

export class EngineError extends CliError {
  constructor(readonly code: DeployErrorCode, readonly detail?: string) {
    super(`${code}: ${detail || deployErrorText(code)}`, deployErrorExitCodes[code]);
  }
}

export interface ComposeCommand {
  executable: string;
  prefix: readonly string[];
  version: string;
  supported: boolean;
}

export interface ComposeTarget {
  paths: InstallationPaths;
  projectName: string;
  command: ComposeCommand;
  composeFile: string;
  useImageSources?: boolean;
  localComposeFile?: string;
}

export interface EngineProvider {
  kind: EngineKind;
  detect(): Promise<EngineDetection>;
  ensureReady(onEvent?: (message: string) => void, options?: { apiPort?: number; signal?: AbortSignal }): Promise<void>;
  docker(args: readonly string[], options?: RunOptions): RunResult;
  composeInvocation(project: ComposeTarget, args: readonly string[]): {
    command: string;
    args: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  };
  memoryBytes(): number | null;
  describe(): EngineInfo;
  stop?(): Promise<void>;
  remove?(options: { purgeData: boolean }): Promise<void>;
}
