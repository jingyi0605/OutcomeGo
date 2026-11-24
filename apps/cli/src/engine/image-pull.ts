import { readFileSync } from "node:fs";
import { parseEnvironment } from "../config";
import type { ComposeProject } from "../docker";
import { CliError } from "../errors";
import { cliTranslate } from "../localization";
import { runStreaming } from "../process";
import { pullDeploymentImage, rankImageSources, registrySources } from "./image-sources";
import type { ManagedEngine } from "./managed";

/** The images a Compose file runs, by image reference, with the services that share each one. */
export const releaseImages = (
  project: ComposeProject,
  composeFile?: string
): { computer: string | undefined; images: Map<string, string[]> } => {
  const result = project.run(["config", "--format", "json"], { composeFile, timeoutMs: 10_000, useImageSources: false });
  if (result.status !== 0) throw new Error("Compose could not resolve the release images");
  const services = JSON.parse(result.stdout).services as Record<string, { image?: unknown; profiles?: string[] }>;
  const computer = services.computer?.image;
  if (computer !== undefined && (typeof computer !== "string" || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(computer))) {
    throw new Error("The computer image is not pinned by digest");
  }
  const enabled = new Set((parseEnvironment(readFileSync(project.paths.environment, "utf8")).get("COMPOSE_PROFILES") || "").split(","));
  const images = new Map<string, string[]>();
  for (const [service, configuration] of Object.entries(services)) {
    if (configuration.profiles?.length && !configuration.profiles.some((profile) => enabled.has(profile))) continue;
    if (typeof configuration.image !== "string" || !configuration.image || !/^[a-z0-9][a-z0-9._-]*$/i.test(service)) {
      throw new Error("A service has no valid image");
    }
    const names = images.get(configuration.image) ?? [];
    names.push(service);
    images.set(configuration.image, names);
  }
  return { computer, images };
};

export interface ImagePullHooks {
  signal?: AbortSignal;
  rank?: typeof rankImageSources;
  stream?: typeof runStreaming;
  /** Every line the engine prints while pulling, and which registry is being tried. */
  record: (line: string) => void;
  /** Throws when the whole operation was cancelled. */
  cancelled?: () => void;
  /** Throws for a pull that was interrupted (exit status 130) rather than one that failed. */
  interrupted: () => never;
}

/**
 * Pulls one release image from whichever registry answers fastest from this computer, falling back to
 * the official one. The OutcomeGo engine has no registry mirror setting of its own, so this is how
 * its images get downloaded at a usable speed. Resolves to the reference that was pulled: the image
 * itself, or a mirror's reference that must then be run in its place (see `imageSourcesPath`).
 * Resolves to nothing when every source failed.
 */
export const pullFastestImage = (
  image: string,
  service: string,
  target: { engine: ManagedEngine; project: ComposeProject; composeFile?: string },
  hooks: ImagePullHooks
): Promise<string | undefined> => {
  const { engine, project, composeFile } = target;
  const official = registrySources(image)[0]?.registry ?? image.split("/", 1)[0]!;
  return pullDeploymentImage(image, {
    signal: hooks.signal,
    rank: hooks.rank ?? rankImageSources,
    cached: reference => engine.docker(["image", "inspect", "--format", "{{.Id}}", reference], { timeoutMs: 10_000 }).status === 0,
    pull: async reference => {
      const mirrored = reference !== image;
      const registry = mirrored ? reference.split("/", 1)[0]! : official;
      hooks.record(cliTranslate("Pulling {service} from {registry}.", { service, registry }));
      const invocation = mirrored ? engine.pullInvocation(reference) : project.invocation(["pull", service], composeFile, false);
      const deadline = mirrored ? AbortSignal.timeout(30 * 60_000) : undefined;
      const signal = hooks.signal && deadline ? AbortSignal.any([hooks.signal, deadline]) : hooks.signal ?? deadline;
      const result = await (hooks.stream ?? runStreaming)(invocation.command, invocation.args, {
        cwd: invocation.cwd, env: invocation.env, signal,
        onStdoutLine: hooks.record, onStderrLine: hooks.record,
      });
      hooks.cancelled?.();
      if (result.status === 130 && !deadline?.aborted) hooks.interrupted();
      if (result.status === 0) return true;
      hooks.record(cliTranslate("Image pull failed from {registry}.", { registry }));
      return false;
    },
  });
};

/**
 * Pulls every image of a release on the OutcomeGo engine, each from its fastest registry. Resolves to
 * the services that must run a mirror's copy instead of the Compose file's reference, ready to be
 * saved beside the Compose file that goes live. Throws when an image could not be pulled anywhere.
 */
export const pullReleaseImages = async (
  project: ComposeProject,
  engine: ManagedEngine,
  composeFile: string,
  hooks: ImagePullHooks
): Promise<Record<string, { image: string }>> => {
  const { images } = releaseImages(project, composeFile);
  const overrides: Record<string, { image: string }> = Object.create(null);
  for (const [image, services] of images) {
    hooks.cancelled?.();
    const selected = await pullFastestImage(image, services[0]!, { engine, project, composeFile }, hooks);
    if (!selected) throw new CliError(cliTranslate("Image download failed. Check your connection and retry."));
    if (selected !== image) for (const service of services) overrides[service] = { image: selected };
  }
  return overrides;
};
