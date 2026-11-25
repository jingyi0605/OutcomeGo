import { readFile } from "node:fs/promises";
import { verifyEngineNotices } from "../../apps/cli/scripts/engine-assets";

const read = (path: string) => readFile(path, "utf8");
const fail = (message: string): never => {
  throw new Error(`Release workflow check failed: ${message}`);
};
const requireText = (text: string, expected: string, label: string): void => {
  if (!text.includes(expected)) fail(`${label} is missing: ${expected}`);
};

const [engineFlag, engineInventory, sectionFlag, sectionValue] = process.argv.slice(2);
if (engineFlag !== undefined) {
  const section = sectionValue ?? "windows";
  if (
    engineFlag !== "--engine-components" ||
    !engineInventory ||
    (sectionFlag !== undefined && sectionFlag !== "--section")
  ) {
    fail("expected --engine-components <engine-components.json> [--section <windows|macos>]");
  }
  verifyEngineNotices(JSON.parse(await read(engineInventory)), await read("THIRD-PARTY-NOTICES"), section);
  console.log(`Engine component inventory matches THIRD-PARTY-NOTICES (${section}).`);
}

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
requireText(constants, 'DEFAULT_IMAGE_PREFIX = "ghcr.io/jingyi0605/outcomego"', "stable GHCR identity");
requireText(release, '/outcomego"', "release GHCR identity");
requireText(release, "apps/cli/release/*", "CLI intermediate artifact upload");
requireText(release, "outcomego-linux-x64.gz", "versionless CLI release asset");
requireText(release, "if: vars.RELEASE_WINDOWS_ENGINE == 'true'", "Windows engine approval gate");
requireText(release, "--engine-components", "Windows engine notice verification");
requireText(release, "--file apps/cli/engine-assets/windows-x64.Dockerfile", "Windows engine recipe");
requireText(release, 'apps/cli/scripts/engine-assets.ts --windows-rootfs "$stage/rootfs.tar" "$stage/staged"', "Windows engine staging");
requireText(release, "name: windows-engine", "Windows engine signing input");
requireText(release, "bun apps/cli/scripts/sign-release.ts dist/core/outcomego-engine-windows-x64.tar.gz", "Windows engine signature");
requireText(release, "outcomego-engine-windows-x64.tar.gz.sigstore.json", "Windows engine release requirement");
requireText(release, "if: vars.RELEASE_MACOS == 'true'", "macOS engine approval gate");
requireText(release, "name: macos-engine-${{ matrix.architecture }}", "macOS engine asset artifact");
requireText(release, "bun apps/cli/scripts/build-macos-engine.ts", "macOS engine staging");
requireText(release, "name: macos-engine-components", "macOS engine component inventory artifact");
requireText(release, "bun apps/cli/scripts/sign-release.ts \"$asset\"", "macOS engine signature");
requireText(release, "engine-components-macos.json", "macOS engine notice inventory");
requireText(release, "Expected two macOS runtime assets", "macOS engine architecture coverage");
requireText(release, "runner: macos-15", "macOS arm64 desktop runner");
requireText(release, "runner: macos-15-intel", "macOS x64 desktop runner");
if (release.includes("aiteamos-") || release.includes("create-legacy-cli-aliases")) {
  fail("the next release must not generate legacy aiteamos-* CLI assets");
}
requireText(release, "OutcomeGo-$VERSION-android.apk", "versioned Android release asset");
if (release.includes("aiTeamOS-") || desktop.includes("aiTeamOS-")) {
  fail("desktop release artifacts must use the OutcomeGo- prefix, not legacy aiTeamOS-");
}
requireText(release, "apps/desktop/release/OutcomeGo-*", "OutcomeGo desktop release asset prefix");
requireText(desktop, '"artifactName": "OutcomeGo-${version}-${os}-${arch}.${ext}"', "OutcomeGo desktop artifact prefix");

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
console.log("Desktop uses the OutcomeGo artifact prefix.");
console.log("Versionless CLI binaries are stable download assets, not duplicate versioned application builds.");
