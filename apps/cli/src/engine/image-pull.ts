import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
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
  onRetry?: (attempt: number, total: number) => void;
  /** Throws when the whole operation was cancelled. */
  cancelled?: () => void;
  /** Throws for a pull that was interrupted (exit status 130) rather than one that failed. */
  interrupted: () => never;
}

const IMAGE_PULL_RETRY_DELAYS_MS = [1_000, 2_000];
const IMAGE_PULL_TIMEOUT_MS = 30 * 60_000;

/**
 * Pulls a release image with bounded retries. For a managed engine, each round tries the available
 * sources in speed order. Returns the reference to run, which may be a mirror of the original digest.
 */
export const pullFastestImage = async (
  image: string,
  service: string,
  target: { engine?: ManagedEngine; project: ComposeProject; composeFile?: string },
  hooks: ImagePullHooks
): Promise<string | undefined> => {
  const { engine, project, composeFile } = target;
  const official = engine && registrySources(image)[0]?.registry;
  const pull = async (reference: string) => {
    hooks.signal?.throwIfAborted();
    const mirrored = reference !== image;
    const registry = mirrored ? reference.split("/", 1)[0]! : official;
    hooks.record(registry
      ? cliTranslate("Pulling {service} from {registry}.", { service, registry })
      : cliTranslate("Pulling {service}.", { service }));
    const invocation = mirrored && engine ? engine.pullInvocation(reference) : project.invocation(["pull", service], composeFile, false);
    const deadline = AbortSignal.timeout(IMAGE_PULL_TIMEOUT_MS);
    const signal = hooks.signal ? AbortSignal.any([hooks.signal, deadline]) : deadline;
    const result = await (hooks.stream ?? runStreaming)(invocation.command, invocation.args, {
      cwd: invocation.cwd, env: invocation.env, signal,
      onStdoutLine: hooks.record, onStderrLine: hooks.record,
    });
    hooks.cancelled?.();
    hooks.signal?.throwIfAborted();
    if (result.status === 130 && !deadline.aborted) hooks.interrupted();
    if (result.status === 0 && !deadline.aborted) return true;
    if (deadline.aborted) hooks.record(cliTranslate("Image pull timed out for {service}.", { service }));
    else if (registry) hooks.record(cliTranslate("Image pull failed from {registry}.", { registry }));
    return false;
  };
  const pullOnce = async () => {
    if (!engine) return (await pull(image)) ? image : undefined;
    return pullDeploymentImage(image, {
      signal: hooks.signal,
      rank: hooks.rank ?? rankImageSources,
      cached: reference => engine.docker(["image", "inspect", "--format", "{{.Id}}", reference], { timeoutMs: 10_000 }).status === 0,
      pull,
    });
  };

  for (const [index, delay] of IMAGE_PULL_RETRY_DELAYS_MS.entries()) {
    const selected = await pullOnce();
    if (selected) return selected;
    hooks.record(cliTranslate("Retrying image download for {service} in {seconds}s ({attempt}/{total}).", {
      service, seconds: delay / 1_000, attempt: index + 1, total: IMAGE_PULL_RETRY_DELAYS_MS.length,
    }));
    hooks.onRetry?.(index + 1, IMAGE_PULL_RETRY_DELAYS_MS.length);
    await sleep(delay, undefined, { signal: hooks.signal });
  }
  return pullOnce();
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
