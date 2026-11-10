import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDataStore } from "@aiteamos/messaging";
import { pluginRuntimeContext, pluginSkillInstructions } from "../src/plugins";

const manifest = {
  key: "fixture",
  name: "Fixture",
  version: "1",
  publisher: "aiTeamOS",
  files: {},
  skills: [
    { name: "main-only", description: "Main", body: "Main agent workflow.", path: "skills/main-only" },
    {
      name: "sign-in",
      description: "Sign in",
      body: "Shared sign-in workflow.",
      path: "skills/sign-in",
      agents: ["main", "computerUse"],
    },
  ],
};
const installation = { name: "Fixture", pluginKey: "fixture", version: "1", status: "installed", manifest };
const prisma = {
  pluginConnection: { findMany: async () => [] },
  pluginInstallation: { findMany: async () => [installation] },
} as any;

let root = "";
const previousRoot = process.env.AITEAMOS_AGENT_DATA_ROOT;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aiteamos-worker-skills-"));
  process.env.AITEAMOS_AGENT_DATA_ROOT = root;
});
afterEach(async () => {
  if (previousRoot === undefined) delete process.env.AITEAMOS_AGENT_DATA_ROOT;
  else process.env.AITEAMOS_AGENT_DATA_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true });
});

const syncCache = () =>
  new AgentDataStore({} as never, { root, workspaceRoot: join(root, "workspace") }).syncPluginSkillCache([
    { id: "fixture", name: "Fixture", version: "1", publisher: "aiTeamOS", skills: manifest.skills, files: manifest.files },
  ]);

test("cataloged plugin skills leave only provider-workflow notes in the main agent's instructions", async () => {
  await syncCache();
  const main = (await pluginRuntimeContext(prisma, "bot", "main")).skillInstructions;
  expect(main).toContain("## Installed plugin skills");
  expect(main).toContain("listed with their SKILL.md paths in the agent_skills catalog");
  for (const text of ["Main agent workflow.", "Shared sign-in workflow.", "Path:"])
    expect(main).not.toContain(text);
});

test("agents a skill names keep its full text, and executors get no skills", async () => {
  await syncCache();
  const worker = await pluginSkillInstructions(prisma, "child", "computerUse");
  expect(worker).toContain("Shared sign-in workflow.");
  expect(worker).not.toContain("Main agent workflow.");
  expect((await pluginRuntimeContext(prisma, "parent", "executor")).skillInstructions).toBe("");
});

test("skills whose files are not on the computer yet keep their full text", async () => {
  const main = (await pluginRuntimeContext(prisma, "bot", "main")).skillInstructions;
  expect(main).toContain("Main agent workflow.");
  expect(main).not.toContain("agent_skills catalog");
});
