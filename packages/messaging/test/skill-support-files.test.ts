import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSkillSupportFiles, writeSkillFile, writeSkillSupportFiles } from "../src/skill-files";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "outcomego-skill-support-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const skill = async () =>
  (
    await writeSkillFile(root, {
      name: "Style guide",
      description: "Write plainly",
      body: "Be brief.",
    })
  ).slug;

test("supporting files are read back without SKILL.md, hidden files or symlinks", async () => {
  const slug = await skill();
  await writeSkillSupportFiles(root, slug, {
    "references/style.md": "Style notes",
    "template.txt": "Template",
  });
  await writeFile(join(root, slug, ".hidden"), "ignored");
  await symlink("/etc/hostname", join(root, slug, "link.txt"));
  await writeFile(join(root, slug, "binary.bin"), Buffer.from([0, 1, 2, 255]));

  expect(await readSkillSupportFiles(root, slug)).toEqual({
    "references/style.md": "Style notes",
    "template.txt": "Template",
  });
});

test("writing supporting files makes the folder match exactly and leaves SKILL.md alone", async () => {
  const slug = await skill();
  const before = await readFile(join(root, slug, "SKILL.md"), "utf8");
  await writeSkillSupportFiles(root, slug, { "a.md": "A", "nested/b.md": "B" });
  await writeSkillSupportFiles(root, slug, { "a.md": "A2" });

  expect(await readSkillSupportFiles(root, slug)).toEqual({ "a.md": "A2" });
  expect(await readFile(join(root, slug, "SKILL.md"), "utf8")).toBe(before);
});

test("supporting files cannot replace SKILL.md or leave the skill folder", async () => {
  const slug = await skill();
  await mkdir(join(root, "other"));
  for (const path of ["SKILL.md", "../other/x.md", "/etc/passwd", "a/../../b.md"])
    await expect(writeSkillSupportFiles(root, slug, { [path]: "x" })).rejects.toThrow();
  await expect(writeSkillSupportFiles(root, "../other", { "x.md": "x" })).rejects.toThrow();
  expect(await readSkillSupportFiles(root, slug)).toEqual({});
});
