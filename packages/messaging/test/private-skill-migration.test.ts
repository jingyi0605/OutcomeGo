import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDataStore } from "../src/agent-data";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "outcomego-private-skill-migration-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Just enough of Prisma for saveLibrarySkill: one SavedSkill table and a pass-through transaction. */
const fakePrisma = (legacy: Array<Record<string, unknown>>) => {
  const saved = new Map<string, Record<string, unknown>>();
  const deleted: string[] = [];
  const savedSkill = {
    findFirst: async () => null,
    count: async () => saved.size,
    upsert: async ({ create }: { create: Record<string, unknown> }) => {
      saved.set(create.slug as string, create);
    },
    findUniqueOrThrow: async ({ where }: { where: { slug: string } }) => ({
      id: `id-${where.slug}`,
      ...saved.get(where.slug),
    }),
  };
  const prisma = {
    pluginPrivateSkill: {
      findMany: async () => legacy,
      delete: async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
      },
    },
    savedSkill,
    $transaction: async (action: (tx: unknown) => unknown) =>
      action({ savedSkill, $executeRaw: async () => 0 }),
  };
  return { prisma, saved, deleted };
};

const store = (prisma: unknown) =>
  new AgentDataStore(prisma as never, { root, workspaceRoot: join(root, "workspace") });

test("a legacy private skill becomes workflows/<slug>/SKILL.md with its files, then its row is deleted", async () => {
  const { prisma, saved, deleted } = fakePrisma([
    {
      id: "legacy-1",
      name: "Release notes",
      description: "Group changes",
      body: "Use Added, Changed, Fixed.",
      files: { "references/style.md": "Style notes" },
      enabledBotIds: ["some-bot"],
    },
  ]);

  expect(await store(prisma).migratePrivateSkills()).toEqual({ migrated: 1, failed: [] });

  expect([...saved.keys()]).toEqual(["release-notes"]);
  const slug = "release-notes";
  const skill = await readFile(join(root, "workflows", slug, "SKILL.md"), "utf8");
  expect(skill).toContain("description: Group changes");
  expect(skill).toContain("Use Added, Changed, Fixed.");
  expect(await readFile(join(root, "workflows", slug, "references/style.md"), "utf8")).toBe(
    "Style notes"
  );
  expect(deleted).toEqual(["legacy-1"]);
});

test("a skill that cannot be written keeps its row and does not stop the others", async () => {
  const { prisma, saved, deleted } = fakePrisma([
    { id: "bad", name: "Bad files", description: "x", body: "b", files: { "../escape.md": "no" } },
    { id: "good", name: "Good", description: "", body: "b", files: {} },
  ]);

  const result = await store(prisma).migratePrivateSkills();

  expect(result.migrated).toBe(1);
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]).toContain("Bad files");
  expect(deleted).toEqual(["good"]);
  // The rejected skill wrote nothing, so the next start retries it without making a copy.
  expect([...saved.keys()]).toEqual(["good"]);
});
