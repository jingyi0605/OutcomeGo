import type { Dirent } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Prisma } from "@aiteamos/db";
import { safePackagePath } from "@aiteamos/plugin-sdk";
import { parseDocument, stringify as stringifyYaml } from "yaml";
import { atomicWrite, listDirectories, readText, safeFolderId, uniqueSlug } from "./file-state";

export const MAX_SKILL_NAME = 80;
export const MAX_SKILL_DESCRIPTION = 1_536;
export const MAX_SKILL_BODY = 100_000;
export const MAX_INJECTED_SKILL_BODY = 8_000;

export interface ParsedSkillFile {
  name: string;
  description: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

const requiredText = (value: unknown, name: string, maximum: number): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} must be a non-empty string`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${name} is longer than ${maximum} characters`);
  return text;
};

export const parseSkillFile = (text: string, label: string): ParsedSkillFile => {
  if (text.length > MAX_SKILL_BODY + 16_384) throw new Error(`${label} is too large`);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${label} must start with YAML frontmatter`);
  const document = parseDocument(match[1] ?? "", { prettyErrors: true });
  if (document.errors.length > 0) throw new Error(`${label}: ${document.errors[0]?.message}`);
  const raw = document.toJS() as unknown;
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    throw new Error(`${label} frontmatter must be a mapping`);
  }
  const frontmatter = raw as Record<string, unknown>;
  const name = requiredText(frontmatter.name, "skill name", MAX_SKILL_NAME);
  const description = requiredText(
    frontmatter.description,
    "skill description",
    MAX_SKILL_DESCRIPTION
  );
  const body = (match[2] ?? "").trim();
  if (body.length > MAX_SKILL_BODY)
    throw new Error(`skill body is longer than ${MAX_SKILL_BODY} characters`);
  return { name, description, body, frontmatter };
};

export const renderSkillFile = (skill: {
  name: string;
  description: string;
  body: string;
  frontmatter?: Prisma.JsonValue | Record<string, unknown>;
}): string => {
  const raw =
    skill.frontmatter && typeof skill.frontmatter === "object" && !Array.isArray(skill.frontmatter)
      ? { ...(skill.frontmatter as Record<string, unknown>) }
      : {};
  raw.name = skill.name;
  raw.description = skill.description;
  delete raw.id;
  const yaml = stringifyYaml(raw).trimEnd();
  return `---\n${yaml}\n---\n\n${skill.body.trim()}\n`;
};

export const writeSkillFile = async (
  skillsRoot: string,
  input: {
    slug?: string;
    name: string;
    description: string;
    body: string;
    frontmatter?: Record<string, unknown>;
  }
): Promise<{ slug: string; path: string }> => {
  await mkdir(skillsRoot, { recursive: true, mode: 0o700 });
  const occupied = new Set(await listDirectories(skillsRoot));
  const slug = input.slug ?? uniqueSlug(input.name, "skill", occupied);
  if (input.slug && !occupied.has(input.slug))
    await mkdir(join(skillsRoot, slug), { recursive: true });
  const path = join(skillsRoot, slug, "SKILL.md");
  await atomicWrite(path, renderSkillFile(input));
  return { slug, path };
};

const SKILL_FILE = "SKILL.md";
const MAX_SUPPORT_FILES = 200;
const MAX_SUPPORT_BYTES = 5 * 1024 * 1024;

/** Every regular file under a skill folder except SKILL.md, keyed by its relative path. */
export const readSkillSupportFiles = async (
  skillsRoot: string,
  slug: string
): Promise<Record<string, string>> => {
  const root = join(skillsRoot, safeFolderId(slug, "skill folder"));
  const files: Record<string, string> = {};
  let bytes = 0;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), relativePath);
      else if (entry.isFile() && relativePath !== SKILL_FILE) {
        // Binary or oversized files stay on disk for the Bot but are not editable text.
        if (Object.keys(files).length >= MAX_SUPPORT_FILES) return;
        const info = await stat(join(directory, entry.name));
        if (bytes + info.size > MAX_SUPPORT_BYTES) continue;
        const text = await readText(join(directory, entry.name), MAX_SUPPORT_BYTES);
        if (text === null || text.includes("\0")) continue;
        bytes += info.size;
        files[relativePath] = text;
      }
    }
  };
  await walk(root, "");
  return files;
};

/** Normalized paths of `files`, or an error for any path that is unsafe or would replace SKILL.md. */
export const validateSkillSupportFiles = (files: Record<string, string>): Map<string, string> => {
  const wanted = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    const safe = safePackagePath(path);
    if (safe === SKILL_FILE) throw new Error("SKILL.md is the skill itself, not a supporting file");
    wanted.set(safe, content);
  }
  return wanted;
};

/** Make the support files under a skill folder exactly `files`; SKILL.md is never touched. */
export const writeSkillSupportFiles = async (
  skillsRoot: string,
  slug: string,
  files: Record<string, string>
): Promise<void> => {
  const root = join(skillsRoot, safeFolderId(slug, "skill folder"));
  const wanted = validateSkillSupportFiles(files);
  for (const stale of Object.keys(await readSkillSupportFiles(skillsRoot, slug)))
    if (!wanted.has(stale)) await rm(join(root, stale), { force: true });
  for (const [path, content] of wanted) await atomicWrite(join(root, path), content);
};

export const deleteSkillFolder = async (skillsRoot: string, slug: string): Promise<void> => {
  await rm(join(skillsRoot, slug), {
    recursive: true,
    force: true,
  });
};

export const readSkillCatalog = async (
  skillsRoot: string
): Promise<Array<ParsedSkillFile & { slug: string; path: string }>> => {
  const result: Array<ParsedSkillFile & { slug: string; path: string }> = [];
  for (const slug of await listDirectories(skillsRoot)) {
    const path = join(skillsRoot, slug, "SKILL.md");
    const text = await readText(path, MAX_SKILL_BODY + 16_384);
    if (text === null) continue;
    result.push({
      slug,
      path,
      ...parseSkillFile(text, `workflows/${slug}/SKILL.md`),
    });
  }
  return result;
};
