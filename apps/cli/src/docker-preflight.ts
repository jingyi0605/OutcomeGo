import { ExternalEngine } from "./engine/external";
import type { CommandRunner } from "./process";

export { dockerDesktopApplication, dockerMissing, renderDockerRequired } from "./engine/external-preflight";

export const startDockerDesktop = (
  runner: CommandRunner,
  options?: Parameters<ExternalEngine["startDockerDesktop"]>[0]
) => new ExternalEngine(runner).startDockerDesktop(options);
