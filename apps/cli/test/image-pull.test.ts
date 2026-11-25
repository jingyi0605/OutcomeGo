import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installationPaths } from "../src/config";
import { DEFAULT_IMAGE_PREFIX } from "../src/constants";
import type { ComposeProject } from "../src/docker";
import { CliError } from "../src/errors";
import { pullFastestImage, pullReleaseImages, releaseImages, type ImagePullHooks } from "../src/engine/image-pull";
import { registrySources } from "../src/engine/image-sources";
import type { ManagedEngine } from "../src/engine/managed";

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const server = `${DEFAULT_IMAGE_PREFIX}-server@${digest("server")}`;
const worker = `${DEFAULT_IMAGE_PREFIX}-worker@${digest("worker")}`;
const computer = `${DEFAULT_IMAGE_PREFIX}-computer@${digest("computer")}`;
const NANJING = "ghcr.nju.edu.cn";
const OFFICIAL = "ghcr.io";
/** An image's reference at one of the registries that carry it. */
const at = (image: string, registry: string) => registrySources(image).find(source => source.registry === registry)!.reference;

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type Services = Record<string, { image: string; profiles?: string[] }>;

/**
 * An engine whose images can be "already there", a project that answers `config` and builds the pull
 * commands, and a stream that records what each command pulled: a mirror's reference, or
 * `service:<name>` when Compose pulled the Compose file's own reference.
 */
const fixture = (
  services: Services = { server: { image: server }, worker: { image: worker }, migrate: { image: server } },
  options: { profiles?: string; prefer?: string[]; exit?: number } = {}
) => {
  const directory = mkdtempSync(join(tmpdir(), "outcomego-image-pull-"));
  directories.push(directory);
  const paths = installationPaths(directory);
  writeFileSync(paths.environment, `COMPOSE_PROFILES=${options.profiles ?? ""}\n`);
  const cached = new Set<string>();
  const failing = new Set<string>();
  const pulled: string[] = [];
  const lines: string[] = [];
  const invocations: Array<{ args: readonly string[]; composeFile?: string; useImageSources?: boolean }> = [];
  const configured: Array<{ composeFile?: string; useImageSources?: boolean }> = [];
  const engine = {
    docker: (args: readonly string[]) => ({ status: cached.has(args.at(-1)!) ? 0 : 1, stdout: "", stderr: "" }),
    pullInvocation: (reference: string) => ({ command: "mirror", args: [reference], cwd: directory, env: {} }),
  } as unknown as ManagedEngine;
  const project = {
    paths,
    run: (_args: readonly string[], run: { composeFile?: string; useImageSources?: boolean }) => {
      configured.push({ composeFile: run.composeFile, useImageSources: run.useImageSources });
      return { status: 0, stdout: JSON.stringify({ services }), stderr: "" };
    },
    invocation: (args: readonly string[], composeFile?: string, useImageSources?: boolean) => {
      invocations.push({ args, composeFile, useImageSources });
      return { command: "compose", args, cwd: directory, env: {} };
    },
  } as unknown as ComposeProject;
  const hooks: ImagePullHooks = {
    record: line => void lines.push(line),
    interrupted: () => { throw new CliError("interrupted", 130); },
    // Registries that are not preferred are the ones that could not be reached.
    rank: async sources => (options.prefer ?? sources.map(source => source.registry)).flatMap(registry =>
      sources.filter(source => source.registry === registry).map(source => source.reference)),
    stream: async (command, args) => {
      const target = command === "mirror" ? args[0]! : `service:${args.at(-1)}`;
      pulled.push(target);
      return { status: failing.has(target) ? (options.exit ?? 1) : 0 };
    },
  };
  return { engine, project, hooks, cached, failing, pulled, lines, invocations, configured };
};

test("pulls an image from the fastest registry and says which one was used", async () => {
  const { engine, project, hooks, pulled, lines } = fixture(undefined, { prefer: [NANJING, OFFICIAL, "m.daocloud.io"] });
  expect(await pullFastestImage(server, "server", { engine, project }, hooks)).toBe(at(server, NANJING));
  expect(pulled).toEqual([at(server, NANJING)]);
  expect(lines).toContain("Pulling server from ghcr.nju.edu.cn.");
});

test("falls back to the official registry through Compose, for the Compose file being pulled", async () => {
  const { engine, project, hooks, pulled, invocations, failing, lines } = fixture(undefined, { prefer: [NANJING, OFFICIAL] });
  failing.add(at(server, NANJING));
  expect(await pullFastestImage(server, "server", { engine, project, composeFile: "/next/compose.yaml" }, hooks)).toBe(server);
  expect(pulled).toEqual([at(server, NANJING), "service:server"]);
  expect(lines).toContain("Image pull failed from ghcr.nju.edu.cn.");
  expect(lines).toContain("Pulling server from ghcr.io.");
  // The official copy keeps the Compose file's own reference, so no mirror overrides apply to it.
  expect(invocations).toEqual([{ args: ["pull", "server"], composeFile: "/next/compose.yaml", useImageSources: false }]);
});

test("pulls nothing that is already on the engine, and gives up when every registry fails", async () => {
  const there = fixture();
  there.cached.add(at(server, "m.daocloud.io"));
  expect(await pullFastestImage(server, "server", there, there.hooks)).toBe(at(server, "m.daocloud.io"));
  expect(there.pulled).toEqual([]);

  const failed = fixture(undefined, { prefer: [NANJING, OFFICIAL] });
  failed.failing.add(at(server, NANJING)).add("service:server");
  expect(await pullFastestImage(server, "server", failed, failed.hooks)).toBeUndefined();
  expect(failed.pulled).toEqual([at(server, NANJING), "service:server"]);
});

test("an interrupted pull stops the update instead of trying the next registry", async () => {
  const interrupted = fixture(undefined, { prefer: [NANJING, OFFICIAL], exit: 130 });
  interrupted.failing.add(at(server, NANJING));
  await expect(pullFastestImage(server, "server", interrupted, interrupted.hooks)).rejects.toThrow("interrupted");
  expect(interrupted.pulled).toEqual([at(server, NANJING)]);
});

test("pulls each release image once, reading the Compose file that is about to go live", async () => {
  const { engine, project, hooks, pulled, configured } = fixture(undefined, { prefer: [NANJING, OFFICIAL] });
  const overrides = await pullReleaseImages(project, engine, "/next/compose.yaml", hooks);
  expect(configured).toEqual([{ composeFile: "/next/compose.yaml", useImageSources: false }]);
  expect(pulled).toEqual([at(server, NANJING), at(worker, NANJING)]);
  // Services sharing an image share the mirror's copy of it.
  expect(overrides).toEqual({
    server: { image: at(server, NANJING) },
    migrate: { image: at(server, NANJING) },
    worker: { image: at(worker, NANJING) },
  });
});

test("an image only the official registry served needs no override", async () => {
  const { engine, project, hooks, pulled } = fixture({ server: { image: server } }, { prefer: [OFFICIAL] });
  expect(await pullReleaseImages(project, engine, "/next/compose.yaml", hooks)).toEqual({});
  expect(pulled).toEqual(["service:server"]);
});

test("an image that cannot be pulled anywhere fails the update with a plain message", async () => {
  const { engine, project, hooks, failing } = fixture({ server: { image: server } }, { prefer: [NANJING, OFFICIAL] });
  failing.add(at(server, NANJING)).add("service:server");
  const error = await pullReleaseImages(project, engine, "/next/compose.yaml", hooks).catch(reason => reason);
  expect(error).toBeInstanceOf(CliError);
  expect(error.message).toContain("Image download failed");
});

test("lists the enabled services' images and skips services of profiles that are off", () => {
  const services: Services = { server: { image: server }, worker: { image: server }, voice: { image: worker, profiles: ["voice"] } };
  expect(releaseImages(fixture(services).project).images).toEqual(new Map([[server, ["server", "worker"]]]));
  expect([...releaseImages(fixture(services, { profiles: "voice" }).project).images.keys()]).toEqual([server, worker]);
});

test("the computer image must be pinned by digest when there is one, and is optional for an update", () => {
  expect(releaseImages(fixture({ server: { image: server }, computer: { image: computer } }).project).computer).toBe(computer);
  expect(releaseImages(fixture({ server: { image: server } }).project).computer).toBeUndefined();
  expect(() => releaseImages(fixture({ computer: { image: `${DEFAULT_IMAGE_PREFIX}-computer:latest` } }).project)).toThrow();
  expect(() => releaseImages(fixture({ server: { image: "" } }).project)).toThrow();
});
