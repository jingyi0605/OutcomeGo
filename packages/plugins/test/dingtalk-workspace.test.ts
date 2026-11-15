import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPackageArchive, importPackageArchive } from "@outcomego/plugin-sdk/archive";
import { pluginCatalog } from "../src";

const root = new URL("../dingtalk-workspace/", import.meta.url);
const installer = new URL("skills/dingtalk-setup/scripts/ensure-dws.sh", root).pathname;
const wrapper = new URL("skills/dingtalk-setup/scripts/dws.sh", root).pathname;
const statusScript = new URL("skills/dingtalk-setup/scripts/dws-status.sh", root).pathname;
const authExport = new URL("skills/dingtalk-setup/scripts/dws-auth-export.sh", root).pathname;
const authImport = new URL("skills/dingtalk-setup/scripts/dws-auth-import.sh", root).pathname;
const authLogout = new URL("skills/dingtalk-setup/scripts/dws-logout.sh", root).pathname;

async function fixture(run: (directory: string, target: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dws-plugin-"));
  try {
    await run(directory, join(directory, "managed CLI"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executable(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`);
  await chmod(path, 0o755);
}

async function run(target: string, args: string[], env: Record<string, string> = {}, script = installer) {
  const child = Bun.spawn(["bash", script, ...args], {
    env: { ...process.env, DWS_NO_UPDATE_CHECK: "1", OUTCOMEGO_DWS_CLI_DIR: target, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("DWS check does not install and install reuses a matching managed version", async () => {
  await fixture(async (directory, target) => {
    expect((await run(target, ["--check"])).code).toBe(1);
    expect(await Bun.file(join(target, "dws")).exists()).toBe(false);
    expect(await readdir(directory)).toEqual([]);
    await mkdir(target);
    await executable(join(target, "dws"), "printf '%s\\n' 'dws version v1.0.68 (test, test)'");
    expect(await run(target, ["--install"])).toEqual({
      code: 0,
      stdout: `${join(target, "dws")}\n`,
      stderr: "",
    });
    expect((await run(target, ["--check"])).stdout).toBe(`${join(target, "dws")}\n`);
  });
});

test("DWS installer preserves an unexpected existing binary and rejects relative targets", async () => {
  await fixture(async (_directory, target) => {
    await mkdir(target);
    const binary = join(target, "dws");
    await executable(binary, "echo 'dws version v9.0.0 (other, other)'");
    const before = await readFile(binary);
    const result = await run(target, ["--install"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unexpected DWS version");
    expect(await readFile(binary)).toEqual(before);
    expect((await run("relative/path", ["--install"])).code).toBe(2);
  });
});

test("DWS installer rejects unsupported platforms before any download", async () => {
  await fixture(async (directory, target) => {
    const mocks = join(directory, "bin");
    await mkdir(mocks);
    await executable(join(mocks, "uname"), "echo Unsupported");
    const result = await run(target, ["--install"], { PATH: `${mocks}:${process.env.PATH}` });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Supported hosts");
    expect(await Bun.file(join(target, "dws")).exists()).toBe(false);
  });
});

test("DWS installer rejects corrupt archives, pins its source, and cleans staging", async () => {
  await fixture(async (directory, target) => {
    const mocks = join(directory, "bin");
    const requested = join(directory, "requested-url");
    await mkdir(mocks);
    await executable(join(mocks, "uname"), 'if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi');
    await executable(join(mocks, "curl"), `
printf '%s\\n' "$@" > "$DWS_TEST_REQUESTED_URL"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then printf corrupted > "$2"; exit 0; fi
  shift
done
exit 2`);
    const result = await run(target, ["--install"], {
      PATH: `${mocks}:${process.env.PATH}`,
      DWS_TEST_REQUESTED_URL: requested,
      DWS_VERSION: "v9.0.0",
      DWS_RELEASE_BASE: "https://invalid.example/untrusted",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("checksum mismatch");
    expect(result.stdout).toBe("");
    expect(await readdir(target)).toEqual([]);
    const request = await readFile(requested, "utf8");
    expect(request).toContain("releases/download/v1.0.68/dws-linux-amd64.tar.gz");
    expect(request).not.toContain("untrusted");
  });
});

test("DWS wrapper forwards literal arguments and preserves selected credentials and profile", async () => {
  await fixture(async (directory, target) => {
    await mkdir(target);
    await executable(join(target, "dws"), `
if [[ "$1" == --version ]]; then echo 'dws version v1.0.68 (test, test)'; exit 0; fi
printf '%s\\n' "$DWS_CONFIG_DIR" "$DWS_KEYCHAIN_DIR" "$@"`);
    const args = ["--profile", "corp:user", "chat", "+search-msg", 'text $(touch unwanted) `literal` "quoted"'];
    const result = await run(target, args, {
      DWS_CONFIG_DIR: join(directory, "config"),
      DWS_KEYCHAIN_DIR: join(directory, "keychain"),
    }, wrapper);
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      join(directory, "config"), join(directory, "keychain"), ...args,
    ]);
    expect(result.stderr).toBe("");
  });
});

test("DWS status runs on the selected Computer and keeps the read-only contract", async () => {
  await fixture(async (directory, target) => {
    await mkdir(target);
    await executable(join(target, "dws"), `
if [[ "$1" == --version ]]; then echo 'dws version v1.0.68 (test, test)'; exit 0; fi
printf '%s\\n' "$@"`);
    const result = await run(target, ["--profile", "corp:user"], {}, statusScript);
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      "auth", "status", "--readonly", "--format", "json", "--profile", "corp:user",
    ]);
    expect(result.stderr).toBe("");
  });
});

test("DWS logout stays scoped to the selected Computer and preserves the profile selector", async () => {
  await fixture(async (directory, target) => {
    await mkdir(target);
    await executable(join(target, "dws"), `
if [[ "$1" == --version ]]; then echo 'dws version v1.0.68 (test, test)'; exit 0; fi
printf '%s\\n' "$@"`);
    const result = await run(target, ["--profile", "corp:user"], {}, authLogout);
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      "auth", "logout", "--yes", "--profile", "corp:user",
    ]);
    expect(result.stderr).toBe("");
  });
});

test("DWS auth export is workspace-scoped and auth import deletes only a verified one-time bundle", async () => {
  await fixture(async (directory, target) => {
    const workspace = join(directory, "workspace");
    const bundle = join(workspace, "dws-auth.tar.gz");
    const importedMarker = join(directory, "imported");
    await mkdir(target);
    await mkdir(workspace);
    await writeFile(bundle, "encrypted bundle bytes");
    await executable(join(target, "dws"), `
if [[ "$1" == --version ]]; then echo 'dws version v1.0.68 (test, test)'; exit 0; fi
if [[ "$1" == auth && "$2" == import ]]; then touch "$DWS_TEST_IMPORTED"; exit 0; fi
if [[ "$1" == auth && "$2" == export ]]; then
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == --output ]]; then printf 'bundle' > "$2"; exit 0; fi
    shift
  done
fi
if [[ "$1" == auth && "$2" == status ]]; then
  if [[ -e "$DWS_TEST_IMPORTED" ]]; then printf '%s\\n' '{"authenticated":true}'; else printf '%s\\n' '{"authenticated":false}'; fi
  exit 0
fi
exit 2`);
    const imported = await run(target, [bundle, "--force"], {
      OUTCOMEGO_WORKSPACE_ROOT: workspace,
      DWS_TEST_IMPORTED: importedMarker,
    }, authImport);
    expect(imported.code).toBe(0);
    expect(imported.stdout).toContain('"authenticated":true');
    expect(await Bun.file(bundle).exists()).toBe(false);
    expect(await Bun.file(importedMarker).exists()).toBe(true);

    const exported = join(workspace, "exported.tar.gz");
    const exportResult = await run(target, [exported], {
      OUTCOMEGO_WORKSPACE_ROOT: workspace,
    }, authExport);
    expect(exportResult.code).toBe(0);
    expect(exportResult.stdout).toBe(`${await realpath(workspace)}/exported.tar.gz\n`);
    expect(await Bun.file(exported).text()).toBe("bundle");
    expect((await run(target, [join(directory, "outside.tar.gz")], {
      OUTCOMEGO_WORKSPACE_ROOT: workspace,
    }, authExport)).code).toBe(2);
  });
});

test("DWS auth import retains an unverified bundle and rejects paths outside the Computer workspace", async () => {
  await fixture(async (directory, target) => {
    const workspace = join(directory, "workspace");
    const bundle = join(workspace, "dws-auth.tar.gz");
    await mkdir(target);
    await mkdir(workspace);
    await writeFile(bundle, "encrypted bundle bytes");
    await executable(join(target, "dws"), `
if [[ "$1" == --version ]]; then echo 'dws version v1.0.68 (test, test)'; exit 0; fi
if [[ "$1" == auth && "$2" == import ]]; then exit 0; fi
if [[ "$1" == auth && "$2" == status ]]; then printf '%s\\n' '{"authenticated":false}'; exit 0; fi
exit 2`);
    const retained = await run(target, [bundle], {
      OUTCOMEGO_WORKSPACE_ROOT: workspace,
    }, authImport);
    expect(retained.code).toBe(1);
    expect(await Bun.file(bundle).exists()).toBe(true);
    expect((await run(target, [join(directory, "outside.tar.gz")], {
      OUTCOMEGO_WORKSPACE_ROOT: workspace,
    }, authImport)).code).toBe(2);
  });
});

test("DWS package exports focused workflows, executable support files and pinned provenance", async () => {
  const plugin = pluginCatalog.find((item) => item.key === "dingtalk-workspace")!;
  expect(plugin).toBeDefined();
  expect(plugin.components).toEqual(["skills"]);
  expect(plugin.connections).toEqual([]);
  expect(plugin.skills.map((skill) => skill.name)).toEqual(["dingtalk-setup", "dingtalk-workspace"]);
  const restored = importPackageArchive(exportPackageArchive(plugin)).definition;
  const metadata = JSON.parse(restored.files!["20261115-上游资产清单.json"]!);
  const source = await readFile(installer, "utf8");
  expect(source).toContain(`version="${metadata.version}"`);
  for (const hash of Object.values(metadata.assets)) expect(source).toContain(String(hash));
  for (const [name, hash] of Object.entries(metadata.sourceFiles)) {
    expect(createHash("sha256").update(restored.files![name]!).digest("hex")).toBe(String(hash));
  }
  expect(restored.files!["skills/dingtalk-setup/scripts/dws.sh"]).toBe(await readFile(wrapper, "utf8"));
  for (const script of ["dws-status.sh", "dws-auth-export.sh", "dws-auth-import.sh", "dws-logout.sh"]) {
    expect(restored.files![`skills/dingtalk-setup/scripts/${script}`]).toBe(
      await readFile(new URL(`skills/dingtalk-setup/scripts/${script}`, root).pathname, "utf8")
    );
  }
  for (const skill of restored.skills) {
    const base = `skills/${skill.name}/`;
    const body = restored.files![`${base}SKILL.md`]!;
    for (const match of body.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (match[1]!.includes(":")) continue;
      const path = new URL(match[1]!, `https://package.invalid/${base}SKILL.md`).pathname.slice(1);
      expect(restored.files![decodeURI(path)]).toBeDefined();
    }
  }
  expect(Object.keys(restored.files!).some((path) => /\.env$|auth-token|app\.json$/.test(path))).toBe(false);
});
