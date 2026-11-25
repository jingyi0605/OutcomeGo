import { cliTranslate } from "../localization";

export const externalEngineInstallAdvice = (platform: NodeJS.Platform): string =>
  platform === "linux"
    ? cliTranslate("Install Docker Engine and the Compose plugin: https://docs.docker.com/engine/install/")
    : cliTranslate("Install a Docker-compatible engine with Compose. Docker Desktop is one option: https://www.docker.com/products/docker-desktop/");

export const externalComposeAdvice = (version: string): string =>
  cliTranslate(
    "Install or update Compose to {version} or newer for your container engine. Verify with docker compose version (or docker-compose version).",
    { version }
  );

export const externalEngineStartAdvice = (diagnostic: string): string | undefined => {
  if (/\/\.colima\//i.test(diagnostic)) {
    return cliTranslate("Start your Docker runtime with colima start (using the selected profile), then run docker info.");
  }
  if (/\/\.orbstack\//i.test(diagnostic)) {
    return cliTranslate("Start your Docker runtime by opening OrbStack, then run docker info.");
  }
  if (/\/\.rd\//i.test(diagnostic)) {
    return cliTranslate("Start your Docker runtime by opening Rancher Desktop, then run docker info.");
  }
  if (/\bpodman(?:-machine|-rootless|\.sock|\/podman\.sock)\b/i.test(diagnostic)) {
    return cliTranslate("Start your Docker runtime with podman machine start or start your Podman API service, then run docker info.");
  }
  return undefined;
};
