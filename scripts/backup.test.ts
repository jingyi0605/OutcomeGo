import { afterEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "outcomego-backup-project-"));
  roots.push(root);
  for (const directory of ["scripts", "bin", "apps/server"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  for (const script of ["backup.sh", "compose.sh"]) {
    copyFileSync(join(import.meta.dir, script), join(root, "scripts", script));
  }
  writeFileSync(join(root, "docker-compose.yml"), "name: outcomego-dev\n");
  writeFileSync(join(root, "apps/server/package.json"), '{"version": "0.0.1"}\n');
  const callsPath = join(root, "docker-calls.jsonl");
  const dockerPath = join(root, "bin/docker");
  writeFileSync(dockerPath, `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ["DOCKER_CALLS"], "a") as log:
    log.write(json.dumps(args) + "\\n")
if args[:2] == ["compose", "version"]:
    sys.exit(0)
if args[0] == "compose":
    args = args[1:]
    project = os.environ.get("COMPOSE_PROJECT_NAME") or "outcomego-dev"
    if args[:1] == ["--project-name"]:
        project, args = args[1], args[2:]
    if args[:1] == ["exec"]:
        if os.environ.get("FAIL_DUMP"):
            sys.exit(17)
        print("database:" + project)
    elif args == ["config", "--volumes"]:
        print("outcomego_postgres\\noutcomego_workspace\\noutcomego_agent_data")
    else:
        sys.exit(2)
elif args[:2] == ["volume", "inspect"]:
    pass
elif args[:1] == ["run"]:
    mounts = [args[i + 1] for i, arg in enumerate(args) if arg == "-v"]
    source = next(m.split(":")[0] for m in mounts if m.endswith(":/source:ro"))
    destination = next(m[:-len(":/backup")] for m in mounts if m.endswith(":/backup"))
    archive = args[args.index("-czf") + 1].removeprefix("/backup/")
    with open(os.path.join(destination, archive), "w") as output:
        output.write("volume:" + source + "\\n")
else:
    sys.exit(2)
`);
  chmodSync(dockerPath, 0o755);
  const destination = join(root, "backup");
  function run(overrides: Record<string, string> = {}) {
    const env = { ...process.env };
    for (const key of ["PROJECT", "COMPOSE_PROJECT_NAME", "OUTCOMEGO_VERSION", "FAIL_DUMP"]) delete env[key];
    return spawnSync("sh", [join(root, "scripts/backup.sh"), destination], {
      cwd: root,
      encoding: "utf8",
      env: { ...env, PATH: `${join(root, "bin")}:${process.env.PATH}`, DOCKER_CALLS: callsPath, ...overrides },
    });
  }
  const calls = (): string[][] => readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  return { destination, run, calls };
}

test.each([
  ["default Compose project", {}, "outcomego-dev"],
  ["explicit backup project", { PROJECT: "outcomego" }, "outcomego"],
  ["standard Compose project override", { COMPOSE_PROJECT_NAME: "isolated" }, "isolated"],
  ["explicit backup project takes precedence", { PROJECT: "outcomego", COMPOSE_PROJECT_NAME: "other" }, "outcomego"],
] as const)("database, config, volumes and manifest use the same %s", (_name, env, project) => {
  const f = fixture();
  const result = f.run(env);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(readFileSync(join(f.destination, "postgres.dump"), "utf8")).toBe(`database:${project}\n`);
  for (const key of ["outcomego_workspace", "outcomego_agent_data"]) {
    expect(readFileSync(join(f.destination, `${key}.tar.gz`), "utf8")).toBe(`volume:${project}_${key}\n`);
  }
  expect(readFileSync(join(f.destination, "manifest.txt"), "utf8")).toContain(`Compose project: ${project}\n`);
  const composeCalls = f.calls().filter((args) => args[0] === "compose" && args[1] !== "version");
  expect(composeCalls).toEqual([
    ["compose", "--project-name", project, "exec", "-T", "postgres", "pg_dump", "-U", "outcomego", "-d", "outcomego", "--format=custom"],
    ["compose", "--project-name", project, "config", "--volumes"],
  ]);
  expect(f.calls().filter((args) => args[0] === "volume")).toEqual([
    ["volume", "inspect", `${project}_outcomego_workspace`],
    ["volume", "inspect", `${project}_outcomego_agent_data`],
  ]);
});

test("a failed database dump stops before config lookup or volume archives", () => {
  const f = fixture();
  expect(f.run({ PROJECT: "outcomego", FAIL_DUMP: "1" }).status).toBe(17);
  const calls = f.calls();
  expect(calls.some((args) => args.includes("config"))).toBe(false);
  expect(calls.some((args) => args[0] === "volume" || args[0] === "run")).toBe(false);
});
