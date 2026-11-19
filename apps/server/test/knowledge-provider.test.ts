import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KnowledgeError, type KnowledgeErrorCode, type KnowledgeProvider, type KnowledgeReference, type KnowledgeScope } from "@outcomego/contracts/knowledge";
import { createPrismaClient } from "@outcomego/db";
import { AssetStore } from "@outcomego/messaging";
import { FixtureKnowledgeProvider, type FixtureKnowledgeEntry } from "../src/services/fixture-knowledge-provider";
import { createProjectFileKnowledgeProvider, ProjectFileKnowledgeProvider } from "../src/services/knowledge-file-provider";
import { knowledgeDigest, type KnowledgeSource } from "../src/services/knowledge-provider";
import { KnowledgeScopeService, type KnowledgeScopeResolver } from "../src/services/knowledge-scope-service";
import { HumanWorkService } from "../src/services/human-work-service";
import { humanWorkScenario } from "./human-work-fixtures";
import fixture from "../../../specs/004.4-现实任务与知识资料闭环/docs/human-task-fixture.json";
import { humanActionInputSchema, humanWorkMutationSchema, humanWorkPauseSchema } from "@outcomego/contracts/human-work";

const expectCode = async (operation: () => Promise<unknown>, code: KnowledgeErrorCode) => {
  try { await operation(); throw new Error("Expected a knowledge failure"); }
  catch (error) { expect(error).toBeInstanceOf(KnowledgeError); expect((error as KnowledgeError).code).toBe(code); }
};

/** Both providers run exactly the same behavioral suite, with injectable I/O faults. */
for (const kind of ["fixture", "project"] as const) {
  describe(`${kind} provider shared contract`, () => {
    const scope: KnowledgeScope = { projectScope: kind === "fixture" ? "fixture:contract" : "bot:contract", outcomeId: "outcome-contract", contractRevision: 1 };
    const scopes: KnowledgeScopeResolver = {
      async resolve(input) {
        if (!input.projectScope) throw new KnowledgeError("knowledge_scope_required", "Scope required");
        if (input.projectScope !== scope.projectScope) throw new KnowledgeError("knowledge_source_forbidden", "Other scope");
        return { botId: kind === "project" ? "contract" : null };
      },
    };
    const entries: FixtureKnowledgeEntry[] = [
      { id: "reference:network", title: "Network checklist", text: "Check fixture network", projectScope: scope.projectScope, version: "1", updatedAt: "2026-11-17T00:00:00.000Z" },
      { id: "reference:foreign", title: "Network foreign", text: "Private foreign body", projectScope: "bot:foreign", version: "1", updatedAt: "2026-11-17T00:00:00.000Z" },
    ];
    const source = (entry: FixtureKnowledgeEntry): KnowledgeSource => ({
      ...entry, sourceType: "file", sourceRef: entry.id, digest: knowledgeDigest(entry.text), excerpt: entry.text,
      read: async () => {
        if (entry.fault === "timeout") return new Promise<string>(() => {});
        if (entry.fault === "unreadable") throw new KnowledgeError("unreadable_source", "Unreadable");
        if (entry.fault === "forbidden") throw new KnowledgeError("knowledge_source_forbidden", "Forbidden");
        return entry.text;
      },
    });
    const provider = (inputScope = scope): KnowledgeProvider => kind === "fixture"
      ? new FixtureKnowledgeProvider(inputScope, scopes, entries, 20)
      : new ProjectFileKnowledgeProvider(inputScope, scopes, {
        search: async (query) => entries.filter((entry) => `${entry.title} ${entry.text}`.toLowerCase().includes(query.text.toLowerCase())).map(source),
        load: async (id) => { const entry = entries.find((entry) => entry.id === id); return entry ? source(entry) : null; },
      }, 20);
    const query = () => ({ text: "network", scope, limit: 20 });
    const first = async (p = provider()) => (await p.search(query()))[0]!;

    test("search returns scoped stable sources and reads exact text/digest", async () => {
      const p = provider();
      const references = await p.search(query());
      expect(references).toHaveLength(1);
      expect(references[0]?.projectScope).toBe(scope.projectScope);
      expect(references[0]?.version).toBe("1");
      expect(references[0]?.permissionSummary).toBeTruthy();
      expect(await p.read(references[0]!)).toEqual({ text: entries[0]!.text, digest: knowledgeDigest(entries[0]!.text) });
      expect(await p.search({ ...query(), text: "absent" })).toEqual([]);
    });
    test("duplicate stable sources are returned once", async () => {
      entries.push({ ...entries[0]! });
      try { expect(await provider().search(query())).toHaveLength(1); }
      finally { entries.pop(); }
    });
    test("stale versions and digests fail without returning changed text", async () => {
      const p = provider(), selected = await first(p);
      entries[0]!.version = "2";
      try { await expectCode(() => p.read(selected), "knowledge_source_stale"); }
      finally { entries[0]!.version = "1"; }
      entries[0]!.text = "Changed network";
      try { await expectCode(() => p.read(selected), "knowledge_source_stale"); }
      finally { entries[0]!.text = "Check fixture network"; }
      entries[0]!.stale = true;
      try { expect((await first()).stale).toBe(true); await expectCode(() => p.read(selected), "knowledge_source_stale"); }
      finally { entries[0]!.stale = false; }
    });
    test("missing scope and cross-scope references/queries cannot return a body", async () => {
      const p = provider(), selected = await first(p);
      await expectCode(() => provider({ ...scope, projectScope: "" }).search(query()), "knowledge_scope_required");
      await expectCode(() => p.search({ ...query(), scope: { ...scope, projectScope: "bot:foreign" } }), "knowledge_source_forbidden");
      await expectCode(() => p.read({ ...selected, projectScope: "bot:foreign" }), "knowledge_source_forbidden");
      await expectCode(() => p.read({ ...selected, id: "reference:foreign", sourceRef: "reference:foreign" }), "knowledge_source_forbidden");
    });
    test("timeout, unreadable and permission failures are structured", async () => {
      const p = provider(), selected = await first(p);
      for (const [fault, code] of [
        ["timeout", "knowledge_provider_timeout"], ["unreadable", "unreadable_source"], ["forbidden", "knowledge_source_forbidden"],
      ] as const) {
        entries[0]!.fault = fault;
        try { await expectCode(() => p.read(selected), code); }
        finally { delete entries[0]!.fault; }
      }
      expect(new KnowledgeError("knowledge_provider_timeout", "Timeout").toJSON()).toEqual({
        code: "knowledge_provider_timeout", message: "Timeout", retryable: true,
      });
    });
    test("allowed sources and forged source references remain bounded", async () => {
      const p = provider(), selected = await first(p);
      expect(await p.search({ ...query(), scope: { ...scope, allowedSources: [] } })).toEqual([]);
      expect(await provider({ ...scope, allowedSources: [] }).search(query())).toEqual([]);
      await expectCode(() => p.read({ ...selected, sourceRef: "asset:unlinked" }), "knowledge_source_forbidden");
    });
  });
}

test("the canonical synthetic human-task fixture validates this wave's schemas and preserves wave 2 replay inputs", () => {
  expect(fixture.fictional).toBe(true);
  expect(humanActionInputSchema.safeParse(fixture.requestHumanAction).success).toBe(true);
  expect(humanWorkMutationSchema.safeParse(fixture.start).success).toBe(true);
  expect(humanWorkPauseSchema.safeParse(fixture.pause).success).toBe(true);
  expect(fixture.receipts.missing.expected).toBe("human_evidence_missing");
  expect(fixture.receipts.rejected.review.result).toBe("FAIL");
  expect(fixture.receipts.accepted.review.result).toBe("PASS");
  expect(fixture.continuation.sameOutcomeThread).toBe(true);
});

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
describe.skipIf(!url)("ProjectFile provider actual mounted files, messages and assets", () => {
  const prisma = createPrismaClient(url!);
  const bots: string[] = [];
  let root: string;
  let scope: KnowledgeScope;
  let assets: AssetStore;
  let provider: KnowledgeProvider;
  let botRoot: string;
  let tracked: string;
  let messageRef: KnowledgeReference;
  let fileRef: KnowledgeReference;
  let assetRef: KnowledgeReference;
  const text = "Synthetic network checklist\nHuman checks DHCP and DNS.\n";
  beforeAll(async () => {
    await prisma.$connect();
    root = await mkdtemp(join(import.meta.dir, ".knowledge-test-"));
    const scenario = await humanWorkScenario(prisma, new HumanWorkService(prisma));
    bots.push(scenario.bot.id);
    scope = { projectScope: `bot:${scenario.bot.id}`, outcomeId: scenario.outcome.id, contractRevision: 1 };
    const agentData = { root, botDirectory: (id: string) => join(root, "agents", id) };
    botRoot = agentData.botDirectory(scenario.bot.id);
    await mkdir(botRoot, { recursive: true });
    tracked = join(botRoot, "network-checklist.txt");
    await writeFile(tracked, text);
    await prisma.agentFileState.create({ data: { path: tracked, botId: scenario.bot.id, kind: "document", digest: knowledgeDigest(text), validDigest: knowledgeDigest(text) } });
    assets = new AssetStore({ root: join(root, "assets") });
    const attachment = await assets.ingestBytes({ fileName: "network-log.txt", mimeType: "text/plain", bytes: Buffer.from(text) });
    const channel = await prisma.channel.create({
      data: { name: "Synthetic Bot DM", kind: "bot_dm", members: { create: { botId: scenario.bot.id, ordinal: 1 } } },
    });
    await prisma.channelMessage.create({
      data: { channelId: channel.id, sender: "user", content: "Synthetic network observation", metadata: { attachments: [attachment] } },
    });
    provider = createProjectFileKnowledgeProvider(prisma, scope, agentData, assets);
    const references = await provider.search({ text: "network", scope, limit: 20 });
    fileRef = references.find((entry) => entry.id.startsWith("agent-file:"))!;
    messageRef = references.find((entry) => entry.sourceType === "message")!;
    assetRef = references.find((entry) => entry.id.startsWith("file:"))!;
    expect(references).toHaveLength(3);
  });
  afterAll(async () => {
    const channels = await prisma.channelMember.findMany({ where: { botId: { in: bots } }, select: { channelId: true } });
    await prisma.channel.deleteMany({ where: { id: { in: channels.map((entry) => entry.channelId) } } });
    await prisma.bot.deleteMany({ where: { id: { in: bots } } });
    await prisma.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });
  test("actual text bytes, user message and linked attachment read successfully with SHA-256", async () => {
    expect(await provider.read(fileRef)).toEqual({ text, digest: knowledgeDigest(text) });
    expect(await provider.read(assetRef)).toEqual({ text, digest: knowledgeDigest(text) });
    expect((await provider.read(messageRef)).text).toBe("Synthetic network observation");
    expect(messageRef.version).toContain(messageRef.updatedAt);
  });
  test("fresh null-vector projection and populated vector both search within Bot scope", async () => {
    const columns = await prisma.$queryRaw<Array<{ is_generated: string }>>`
      SELECT is_generated FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'outcomego_search_document' AND column_name = 'searchVector'
    `;
    const id = messageRef.id;
    if (columns[0]?.is_generated === "NEVER") {
      const rows = await prisma.$queryRaw<Array<{ empty: boolean }>>`
        SELECT "searchVector" IS NULL AS empty FROM outcomego_search_document WHERE id = ${id}
      `;
      expect(rows[0]?.empty).toBe(true);
      expect((await provider.search({ text: "network", scope, limit: 20 })).some((entry) => entry.id === id)).toBe(true);
      await prisma.$executeRaw`
        UPDATE outcomego_search_document SET "searchVector" = to_tsvector('simple', "title") WHERE id = ${id}
      `;
    }
    expect((await provider.search({ text: "network", scope, limit: 20 })).some((entry) => entry.id === id)).toBe(true);
  });
  test("changed bytes are stale even when DB digest/generation have not changed", async () => {
    await writeFile(tracked, "Changed after selection");
    try { await expectCode(() => provider.read(fileRef), "knowledge_source_stale"); }
    finally { await writeFile(tracked, text); }
  });
  test("selected messages detect changed body digests and do not mutate Outcome work", async () => {
    const id = messageRef.id.slice("message:".length);
    const before = await prisma.outcomeWorkItem.findMany({ where: { outcomeId: scope.outcomeId }, select: { id: true, status: true }, orderBy: { ordinal: "asc" } });
    await prisma.channelMessage.update({ where: { id }, data: { content: "Edited observation" } });
    try { await expectCode(() => provider.read(messageRef), "knowledge_source_stale"); }
    finally { await prisma.channelMessage.update({ where: { id }, data: { content: "Synthetic network observation" } }); }
    expect(await prisma.outcomeWorkItem.findMany({ where: { outcomeId: scope.outcomeId }, select: { id: true, status: true }, orderBy: { ordinal: "asc" } })).toEqual(before);
  });
  test("another Bot cannot supply tracked files, messages or an unlinked asset reference", async () => {
    const other = await prisma.bot.create({ data: { name: "Other Bot", defaultDirectory: "/tmp", conversation: { create: {} } } });
    bots.push(other.id);
    const foreignPath = join(root, "agents", other.id, "network.txt");
    await mkdir(join(root, "agents", other.id), { recursive: true });
    await writeFile(foreignPath, "Do not return this");
    await prisma.agentFileState.create({ data: { path: foreignPath, botId: other.id, kind: "document" } });
    await expectCode(() => provider.read({ ...fileRef, id: `agent-file:${foreignPath}` }), "knowledge_source_forbidden");
    const foreignChannel = await prisma.channel.create({ data: { name: "Other DM", kind: "bot_dm", members: { create: { botId: other.id, ordinal: 1 } } } });
    const foreignMessage = await prisma.channelMessage.create({ data: { channelId: foreignChannel.id, sender: "user", content: "network private" } });
    await expectCode(() => provider.read({ ...messageRef, id: `message:${foreignMessage.id}` }), "knowledge_source_forbidden");
    await expectCode(() => provider.read({ ...assetRef, sourceRef: `asset:${"a".repeat(64)}` }), "knowledge_source_forbidden");
    expect((await provider.search({ text: "network", scope, limit: 20 })).some((entry) => entry.id.includes(foreignMessage.id))).toBe(false);
  });
  test("missing/binary/oversized sources return unreadable, protected files and symlinks return no body", async () => {
    await rm(tracked);
    await expectCode(() => provider.read(fileRef), "unreadable_source");
    await writeFile(tracked, Buffer.from([0, 255, 1, 0]));
    await expectCode(() => provider.read(fileRef), "unreadable_source");
    await writeFile(tracked, Buffer.alloc(1_000_001, 65));
    await expectCode(() => provider.read(fileRef), "unreadable_source");
    await writeFile(tracked, text);
    const dbPath = join(botRoot, "store.db");
    await prisma.agentFileState.create({ data: { path: dbPath, botId: bots[0]!, kind: "database" } });
    await expectCode(() => provider.read({ ...fileRef, id: `agent-file:${dbPath}` }), "knowledge_source_forbidden");
    await rm(tracked);
    await symlink(join(root, "agents", bots[1]!, "network.txt"), tracked);
    try { await expectCode(() => provider.read(fileRef), "knowledge_source_forbidden"); }
    finally { await rm(tracked); await writeFile(tracked, text); }
  });
  test("scope applies before search limit and nontext linked assets do not invent text", async () => {
    const message = await prisma.channelMessage.findUniqueOrThrow({ where: { id: messageRef.id.slice("message:".length) } });
    const current = await prisma.channelMessage.create({ data: {
      channelId: message.channelId, sender: "user", content: "needlelimit current Bot document",
    } });
    const foreign = await prisma.channelMember.findFirstOrThrow({ where: { botId: bots[1]! } });
    await prisma.channelMessage.createMany({ data: Array.from({ length: 30 }, (_, index) => ({
      channelId: foreign.channelId, sender: "user" as const, content: `needlelimit foreign ${index}`,
    })) });
    const references = await provider.search({ text: "needlelimit", scope, limit: 1 });
    expect(references).toHaveLength(1);
    expect(references[0]?.id).toBe(`message:${current.id}`);
    expect(await provider.search({ text: "needlelimit'); DROP TABLE sample; --", scope, limit: 1 })).toEqual([]);
    const binary = await assets.ingestBytes({
      fileName: "binaryfixture.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.0\nSynthetic non-extracted file"),
    });
    await prisma.channelMessage.create({ data: {
      channelId: message.channelId, sender: "user", content: "", metadata: { attachments: [binary] },
    } });
    const reference = (await provider.search({ text: "binaryfixture", scope, limit: 20 }))[0]!;
    expect(reference.id.startsWith("file:")).toBe(true);
    await expectCode(() => provider.read(reference), "unreadable_source");
  });
  for (const mode of ["query", "bound"] as const) {
    test(`${mode} source filter applies before limit and skips tracked files for message-only search`, async () => {
      const original = await prisma.channelMessage.findUniqueOrThrow({ where: { id: messageRef.id.slice("message:".length) } });
      const keyword = `sourcefilter${mode}`;
      const message = await prisma.channelMessage.create({ data: {
        channelId: original.channelId, sender: "user", content: `${keyword} older message`,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      } });
      const attachment = await assets.ingestBytes({
        fileName: `${keyword}.txt`, mimeType: "text/plain", bytes: Buffer.from("Newer excluded attachment"),
      });
      await prisma.channelMessage.create({ data: {
        channelId: original.channelId, sender: "user", content: "", metadata: { attachments: [attachment] },
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      } });
      const messageScope: KnowledgeScope = { ...scope, allowedSources: ["message"] };
      const selected = createProjectFileKnowledgeProvider(
        prisma, mode === "bound" ? messageScope : scope,
        { root, botDirectory: (id: string) => join(root, "agents", id) }, assets,
      );
      const trackedFiles = spyOn(prisma.agentFileState, "findMany");
      try {
        const references = await selected.search({
          text: keyword, scope: mode === "query" ? messageScope : scope, limit: 1,
        });
        expect(references.map((reference) => reference.id)).toEqual([`message:${message.id}`]);
        expect(trackedFiles).not.toHaveBeenCalled();
        expect(await selected.search({
          text: keyword, scope: { ...scope, allowedSources: ["file"] }, limit: 1,
        })).toHaveLength(mode === "bound" ? 0 : 1);
      } finally { trackedFiles.mockRestore(); }
    });
  }
  test("message membership is revalidated on read, not trusted from selected references", async () => {
    const message = await prisma.channelMessage.findUniqueOrThrow({ where: { id: messageRef.id.slice("message:".length) } });
    const botId = bots[0]!;
    await prisma.channelMember.delete({ where: { channelId_botId: { channelId: message.channelId, botId } } });
    try { await expectCode(() => provider.read(messageRef), "knowledge_source_forbidden"); }
    finally { await prisma.channelMember.create({ data: { channelId: message.channelId, botId, ordinal: 1 } }); }
  });
  test("stale revision and malformed/missing scope are checked before content access", async () => {
    const scopes = new KnowledgeScopeService(prisma);
    await expectCode(() => scopes.resolve({ ...scope, projectScope: "" }), "knowledge_scope_required");
    await expectCode(() => scopes.resolve({ ...scope, projectScope: `bot:${bots[1]}` }), "knowledge_source_forbidden");
    await expectCode(() => scopes.resolve({ ...scope, contractRevision: 2 }), "knowledge_source_stale");
  });
});
