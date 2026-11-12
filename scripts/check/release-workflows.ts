import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");
const fail = (message: string): never => {
  throw new Error(`Release workflow check failed: ${message}`);
};
const requireText = (text: string, expected: string, label: string): void => {
  if (!text.includes(expected)) fail(`${label} is missing: ${expected}`);
};

const [ci, release, constants, desktop, android, cliInstaller] = await Promise.all([
  read(".github/workflows/ci.yml"),
  read(".github/workflows/release.yml"),
  read("apps/cli/src/constants.ts"),
  read("apps/desktop/package.json"),
  read(".github/workflows/android.yml"),
  read(".github/workflows/cli-installer.yml"),
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
  "if: ${{ github.event_name != 'workflow_call' || inputs.run_docker }}",
  "CI Docker job guard"
);
requireText(release, "uses: ./.github/workflows/ci.yml", "release CI call");
requireText(release, "run_docker: false", "release CI Docker suppression");

const dockerBuildsInCi = ci.match(/docker\/build-push-action@/g)?.length ?? 0;
const dockerBuildsInRelease = release.match(/docker\/build-push-action@/g)?.length ?? 0;
if (dockerBuildsInCi !== 1 || dockerBuildsInRelease !== 1) {
  fail(`expected one Docker build definition per workflow, got CI=${dockerBuildsInCi}, release=${dockerBuildsInRelease}`);
}

requireText(constants, 'DEFAULT_REPOSITORY = "jingyi0605/OutcomeGo"', "OutcomeGo repository identity");
requireText(constants, 'DEFAULT_IMAGE_PREFIX = "ghcr.io/jingyi0605/ai-teamos"', "stable GHCR identity");
requireText(release, '/ai-teamos"', "release GHCR identity");
requireText(release, "apps/cli/release/*", "CLI intermediate artifact upload");
requireText(release, "outcomego-linux-x64.gz", "versionless CLI release asset");
requireText(release, "OutcomeGo-$VERSION-android.apk", "versioned Android release asset");
requireText(release, "apps/desktop/release/aiTeamOS-*", "desktop release asset prefix retained for updater metadata");
requireText(desktop, '"artifactName": "aiTeamOS-${version}-${os}-${arch}.${ext}"', "desktop artifact prefix retained for updater metadata");

const releaseJobs = release.slice(release.indexOf("jobs:"));
const ciCall = releaseJobs.slice(releaseJobs.indexOf("  ci:"), releaseJobs.indexOf("  # ── Server images"));
requireText(ciCall, "run_docker: false", "release CI Docker suppression");
requireText(release, 'path: apps/cli/release/*', "versionless CLI build artifact upload");
requireText(android, 'run: bash scripts/android/qa.sh assemble', "Android QA debug build");
requireText(cliInstaller, "name: CLI installer", "CLI installer workflow");

console.log("Release workflow checks passed.");
console.log("Release tags run release.yml only; its reusable CI call skips Docker validation, so release images are built once.");
console.log("Desktop keeps its historical artifact prefix until a beta.13 updater fixture proves the renamed prefix resolves.");
console.log("Versionless CLI binaries are stable download assets, not duplicate versioned application builds.");
