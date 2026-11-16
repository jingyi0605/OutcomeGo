import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");
const fail = (message: string): never => {
  throw new Error(`Release workflow check failed: ${message}`);
};
const requireText = (text: string, expected: string, label: string): void => {
  if (!text.includes(expected)) fail(`${label} is missing: ${expected}`);
};

const [ci, release, constants, desktop, android, cliInstaller, imageVerification] = await Promise.all([
  read(".github/workflows/ci.yml"),
  read(".github/workflows/release.yml"),
  read("apps/cli/src/constants.ts"),
  read("apps/desktop/package.json"),
  read(".github/workflows/android.yml"),
  read(".github/workflows/cli-installer.yml"),
  read(".github/workflows/verify-images.yml"),
]);

for (const [workflow, name] of [
  [ci, "CI"],
  [android, "Android QA"],
  [cliInstaller, "CLI installer"],
] as const) {
  const triggers = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("\npermissions:"));
  requireText(triggers, '  push:\n    branches: ["**"]', `${name} branch-only push trigger`);
  if (/^\s+tags:/m.test(triggers)) {
    fail(`${name} must not run as a separate workflow on release tag pushes`);
  }
}

requireText(ci, "workflow_call:", "CI reusable workflow declaration");
requireText(ci, "run_docker:", "CI reusable workflow input");
requireText(
  ci,
  "if: ${{ toJSON(inputs.run_docker) != 'false' }}",
  "CI Docker job guard"
);
requireText(release, "uses: ./.github/workflows/ci.yml", "release CI call");
requireText(release, "run_docker: false", "release CI Docker suppression");

const dockerBuildsInCi = ci.match(/docker\/build-push-action@/g)?.length ?? 0;
const dockerBuildsInRelease = release.match(/docker\/build-push-action@/g)?.length ?? 0;
if (dockerBuildsInCi !== 1 || dockerBuildsInRelease !== 2) {
  fail(`expected one CI Docker build and two release Docker builds (base plus product), got CI=${dockerBuildsInCi}, release=${dockerBuildsInRelease}`);
}

requireText(constants, 'DEFAULT_REPOSITORY = "jingyi0605/OutcomeGo"', "OutcomeGo repository identity");
requireText(constants, 'DEFAULT_IMAGE_PREFIX = "ghcr.io/jingyi0605/ai-teamos"', "stable GHCR identity");
requireText(release, '/ai-teamos"', "release GHCR identity");
requireText(release, "apps/cli/release/*", "CLI intermediate artifact upload");
requireText(release, "outcomego-linux-x64.gz", "versionless CLI release asset");
requireText(
  release,
  "create-legacy-cli-aliases.ts dist/core",
  "legacy CLI updater asset aliases"
);
requireText(release, "OutcomeGo-$VERSION-android.apk", "versioned Android release asset");
requireText(release, "apps/desktop/release/aiTeamOS-*", "desktop release asset prefix retained for updater metadata");
requireText(desktop, '"artifactName": "aiTeamOS-${version}-${os}-${arch}.${ext}"', "desktop artifact prefix retained for updater metadata");

const releaseJobs = release.slice(release.indexOf("jobs:"));
const ciCall = releaseJobs.slice(releaseJobs.indexOf("  ci:"), releaseJobs.indexOf("  # ── Server images"));
requireText(ciCall, "run_docker: false", "release CI Docker suppression");
requireText(release, 'path: apps/cli/release/*', "versionless CLI build artifact upload");
requireText(android, 'run: bash scripts/android/qa.sh assemble', "Android QA debug build");
requireText(cliInstaller, "name: CLI installer", "CLI installer workflow");

requireText(
  release,
  "COMPUTER_BASE=${{ steps.base.outputs.digest",
  "immutable Computer base import"
);
requireText(release, "--prefer-index=false", "digest-preserving input tags");
requireText(release, "steps.inputs.outputs.digest == ''", "reuse skips a product build");
requireText(imageVerification, "workflow_dispatch:", "explicit native verification trigger");
requireText(imageVerification, "ubuntu-24.04-arm", "native ARM64 runner");
requireText(imageVerification, "ubuntu-latest", "native AMD64 runner");
requireText(imageVerification, "load: true", "native image loading without an OCI archive");
requireText(imageVerification, "scripts/release/smoke-image.sh", "native tool verification");
if (/setup-qemu|type=oci|push: true/.test(imageVerification)) {
  fail("native verification must not emulate, export OCI archives, or push images");
}

console.log("Release workflow checks passed.");
console.log("Release tags use native image builders or immutable digest reuse; Computer bases are built only on a recipe cache miss.");
console.log("Desktop keeps its historical artifact prefix until a beta.13 updater fixture proves the renamed prefix resolves.");
console.log("Versionless CLI binaries are stable download assets, not duplicate versioned application builds.");
