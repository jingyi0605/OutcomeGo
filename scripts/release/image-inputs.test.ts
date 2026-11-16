import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { copySources, imageInputs } from "./image-inputs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const write = (root: string, file: string, value: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), value);
};
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "outcomego-image-inputs-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  const app = `FROM scratch AS build
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/server ./apps/server
COPY apps/worker ./apps/worker
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/plugins ./packages/plugins
COPY --from=build /app/main.js /main.js
`;
  write(root, "docker/app.Dockerfile", app);
  write(root, "docker/computer.Dockerfile", `FROM scratch AS build
COPY package.json bun.lock ./
COPY apps/computer ./apps/computer
FROM scratch AS computer-base
ARG COMPUTER_BASE_REVISION=1
COPY docker/officekit-ts /opt/officekit
FROM computer-base AS runtime
COPY --from=build /app/main.js /main.js
`);
  write(root, "package.json", '{"name":"fixture","version":"1.0.0","scripts":{"build":"bun build"}}');
  write(root, "bun.lock", '{"workspaces":{"":{"name":"fixture"},"apps/server":{"version":"1.0.0"},"apps/worker":{"version":"1.0.0"},"apps/desktop":{"version":"1.0.0"},"apps/computer":{"version":"1.0.0"}},"packages":{"example":["example@1.0.0",],},}');
  for (const name of ["server", "worker", "computer", "desktop"]) {
    write(root, `apps/${name}/package.json`, `{"name":"${name}","version":"1.0.0"}`);
    write(root, `apps/${name}/src/main.ts`, `console.log("${name}")`);
  }
  write(root, "packages/plugins/example/package.json", '{"name":"plugin","version":"1.0.0"}');
  write(root, "docker/officekit-ts/main.js", "officekit");
  write(root, ".dockerignore", "node_modules\n");
  write(root, "turbo.json", "{}");
  write(root, "tsconfig.base.json", "{}");
  write(root, "scripts/release/image-inputs.ts", "hash recipe v1");
  write(root, ".github/workflows/release.yml", "release recipe v1");
  return root;
};
const replace = (root: string, path: string, before: string, after: string) =>
  write(root, path, readFileSync(join(root, path), "utf8").replaceAll(before, after));

test("version-only bumps reuse server and worker bundles but rebuild shipped manifests", () => {
  const root = fixture();
  const before = Object.fromEntries((["server", "worker", "migrate", "computer"] as const).map((image) => [image, imageInputs(image, root)]));
  for (const path of ["package.json", "bun.lock", ...["server", "worker", "computer", "desktop"].map((name) => `apps/${name}/package.json`)]) {
    // The lock also changes a registry dependency here; preserve it for this metadata-only case.
    if (path === "bun.lock") {
      replace(root, path, '"version":"1.0.0"', '"version":"1.0.1"');
    } else replace(root, path, "1.0.0", "1.0.1");
  }
  expect(imageInputs("server", root)).toBe(before.server);
  expect(imageInputs("worker", root)).toBe(before.worker);
  expect(imageInputs("migrate", root)).not.toBe(before.migrate);
  expect(imageInputs("computer", root)).not.toBe(before.computer);
});

test.each(["bun.lock", "package.json", "tsconfig.base.json", "turbo.json", ".dockerignore", "apps/worker/src/main.ts", "apps/desktop/package.json", "scripts/release/image-inputs.ts", ".github/workflows/release.yml"])("changes to %s invalidate the server input key", (file) => {
  const root = fixture();
  const before = imageInputs("server", root);
  if (file === "bun.lock") replace(root, file, "example@1.0.0", "example@2.0.0");
  else if (file.endsWith("package.json")) replace(root, file, "fixture", "changed");
  else write(root, file, `${readFileSync(join(root, file), "utf8")}\nchanged`);
  // The desktop manifest has no fixture word, so change its name explicitly.
  if (file === "apps/desktop/package.json") replace(root, file, "desktop", "desktop-changed");
  expect(imageInputs("server", root)).not.toBe(before);
});

test("plugin package versions remain meaningful; only workspace release versions are metadata", () => {
  const root = fixture();
  const before = imageInputs("server", root);
  replace(root, "packages/plugins/example/package.json", "1.0.0", "2.0.0");
  expect(imageInputs("server", root)).not.toBe(before);
});

test("unrelated client source does not invalidate server images", () => {
  const root = fixture();
  const before = imageInputs("server", root);
  write(root, "apps/desktop/src/main.ts", "new UI");
  expect(imageInputs("server", root)).toBe(before);
});

test("Computer base survives app edits but changes for office assets and base refreshes", () => {
  const root = fixture();
  const before = imageInputs("computer-base", root);
  write(root, "apps/computer/src/main.ts", "new app");
  replace(root, "docker/computer.Dockerfile", "/main.js\n", "/new-main.js\n");
  expect(imageInputs("computer-base", root)).toBe(before);
  write(root, "docker/officekit-ts/main.js", "new officekit");
  expect(imageInputs("computer-base", root)).not.toBe(before);
  const afterOffice = imageInputs("computer-base", root);
  replace(root, "docker/computer.Dockerfile", "REVISION=1", "REVISION=2");
  expect(imageInputs("computer-base", root)).not.toBe(afterOffice);
});

test("executable permission changes invalidate image inputs", () => {
  const root = fixture();
  const before = imageInputs("computer-base", root);
  chmodSync(join(root, "docker/officekit-ts/main.js"), 0o755);
  expect(imageInputs("computer-base", root)).not.toBe(before);
});

test("unknown COPY forms and missing sources fail instead of accidentally reusing an image", () => {
  expect(() => copySources('COPY ["source", "dest"]')).toThrow("Unsupported Docker COPY syntax");
  expect(() => copySources("COPY apps/* /app/")).toThrow("Unsupported Docker COPY syntax");
  const root = fixture();
  write(root, "docker/app.Dockerfile", "FROM scratch\nCOPY missing /app\n");
  expect(() => imageInputs("server", root)).toThrow("No files found");
});


test("Computer base keys include the sources of internal helper stages", () => {
  const root = fixture();
  const dockerfile = readFileSync(join(root, "docker/computer.Dockerfile"), "utf8");
  write(root, "docker/computer.Dockerfile", dockerfile.replace("FROM scratch AS computer-base", "FROM scratch AS helper\nCOPY docker/helper.c /helper.c\nFROM scratch AS computer-base").replace("ARG COMPUTER_BASE_REVISION=1", "ARG COMPUTER_BASE_REVISION=1\nCOPY --from=helper /helper /helper"));
  write(root, "docker/helper.c", "helper v1");
  const before = imageInputs("computer-base", root);
  write(root, "docker/helper.c", "helper v2");
  expect(imageInputs("computer-base", root)).not.toBe(before);
});
