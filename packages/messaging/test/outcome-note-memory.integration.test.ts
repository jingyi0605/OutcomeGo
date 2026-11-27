import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createPrismaClient, type Prisma } from "@outcomego/db";
import { AgentDataStore } from "../src/agent-data";
import { syncOutcomeNoteMemory } from "../src/outcome-note-memory";

const databaseUrl = (process.env.OUTCOMEGO_TEST_DATABASE_URL ?? process.env.OPENTEAM_TEST_DATABASE_URL);
const dbTest = test.skipIf(!databaseUrl);

async function fixture(run: (context: {
  prisma: ReturnType<typeof createPrismaClient>;
  store: AgentDataStore;
  botId: string;
  peerId: string;
  createNote: (data: Partial<Prisma.OutcomeUncheckedCreateInput>) => Promise<string>;
}) => Promise<void>) {
  const prisma = createPrismaClient(databaseUrl!);
  const botId = randomUUID();
  const peerId = randomUUID();
  const outcomeIds: string[] = [];
  const root = tmpdir();
  const store = new AgentDataStore(prisma, { root, workspaceRoot: root });
  try {
    await prisma.bot.createMany({ data: [botId, peerId].map((id) => ({ id, name: "Note Memory Bot", status: "active", defaultDirectory: root })) });
    await run({ prisma, store, botId, peerId, createNote: async (data) => {
      const id = randomUUID();
      outcomeIds.push(id);
      await prisma.$transaction(async (tx) => {
        const outcome = await tx.outcome.create({ data: { kind: "note", status: "active", title: "Team notes", ...data, id } });
        await syncOutcomeNoteMemory(tx, outcome);
      });
      return id;
    } });
  } finally {
    await prisma.memoryFact.deleteMany({ where: { OR: [{ sourceOutcomeId: { in: outcomeIds } }, { writtenByBotId: { in: [botId, peerId] } }] } });
    await prisma.outcome.deleteMany({ where: { id: { in: outcomeIds } } });
    await prisma.bot.deleteMany({ where: { id: { in: [botId, peerId] } } });
    await prisma.$disconnect();
  }
}

dbTest("notes are bounded and discoverable across bots only where shared memory is visible", () => fixture(async ({ prisma, store, botId, peerId, createNote }) => {
  const query = "Pomegranate";
  const title = "  Pomegranate\n  briefing  ";
  const description = `Calibrate the sensors. ${"\u{1F9EA}".repeat(500)} unindexedtail`;
  const noteId = await createNote({ title, description });
  const duplicateId = await createNote({ title, description, botId });
  const fact = await prisma.memoryFact.findFirstOrThrow({ where: { sourceOutcomeId: noteId } });
  expect(fact).toMatchObject({ namespace: "user:notes", scope: "user", origin: "note", tier: "note", writtenByBotId: null });
  expect(fact.fact.length).toBeLessThanOrEqual(500);
  expect(fact.fact).toStartWith("[note] Pomegranate briefing: Calibrate the sensors.");
  expect(fact.fact).not.toMatch(/[\uD800-\uDBFF]$/);
  await prisma.memoryFact.create({ data: {
    namespace: `user:agent:${peerId}`, scope: "user", tier: "note", writtenByBotId: peerId,
    fact: fact.fact, factHash: fact.factHash, logicalId: fact.logicalId,
  } });
  const shared = await store.recallMemory(peerId, { query });
  expect(shared).toContain(`[noteId: ${noteId}]`);
  expect(shared).toContain(`[noteId: ${duplicateId}]`);
  expect(shared).toContain("[shared_note via Note Memory Bot]");
  expect(shared).toContain("[shared_journal via Note Memory Bot]");
  expect(shared).not.toContain(`id: ${fact.id}`);
  expect(shared).not.toContain("unindexedtail");

  const group = await prisma.channel.create({ data: { kind: "group", name: "Group", members: { create: { botId: peerId, ordinal: 0 } } } });
  try {
    await store.writeMemory(peerId, { scope: "agent", tier: "profile", fact: `${query} private profile control` });
    const groupResult = await store.recallMemory(peerId, { query, includeHistory: true }, group.id);
    expect(groupResult).toContain("private profile control");
    expect(groupResult).not.toContain("noteId:");
    expect(groupResult).not.toContain("briefing");
    await expect(store.recallMemory(botId, { query }, group.id)).rejects.toThrow("not a member");
  } finally {
    await prisma.channel.delete({ where: { id: group.id } });
  }
}));

dbTest("note edits and lifecycle transitions atomically replace or remove facts and invalidate shared memory", () => fixture(async ({ prisma, store, botId, peerId, createNote }) => {
  const noteId = await createNote({ title: "Tamarind sensors", description: "Legacycalibration test.", tags: ["olderlabel"] });
  const disabledId = await createNote({ kindMeta: { syncToMemory: false } });
  expect(await prisma.memoryFact.count({ where: { sourceOutcomeId: disabledId } })).toBe(0);

  const pinned = { memory: { render: "old memory" }, other: { render: "unchanged" } };
  const context = await prisma.contextSession.create({ data: {
    botId: peerId, scope: "home", scopeId: peerId, promptSnapshot: { create: { promptSections: pinned } },
  } });
  const before = await prisma.memoryRevision.findUniqueOrThrow({ where: { scope: "user" } });
  const unchanged = await prisma.outcome.findUniqueOrThrow({ where: { id: noteId } });
  await prisma.$transaction((tx) => syncOutcomeNoteMemory(tx, unchanged));
  expect((await prisma.memoryRevision.findUniqueOrThrow({ where: { scope: "user" } })).revision).toBe(before.revision);
  const mutate = (data: Prisma.OutcomeUncheckedUpdateInput, abort = false) => prisma.$transaction(async (tx) => {
    const outcome = await tx.outcome.update({ where: { id: noteId }, data });
    await syncOutcomeNoteMemory(tx, outcome);
    if (abort) throw new Error("Abort note transaction");
  });
  const readSnapshot = () => prisma.contextPromptSnapshot.findUniqueOrThrow({ where: { contextSessionId: context.id } });
  const recallHistory = (query: string) => store.recallMemory(peerId, { query, includeHistory: true });

  await expect(mutate({ description: "Abortedcalibration update." }, true)).rejects.toThrow("Abort note transaction");
  expect(await recallHistory("Legacycalibration")).toContain(`[noteId: ${noteId}]`);
  expect(await recallHistory("Abortedcalibration")).not.toContain(`[noteId: ${noteId}]`);
  expect((await readSnapshot()).promptSections).toEqual(pinned);
  expect((await prisma.memoryRevision.findUniqueOrThrow({ where: { scope: "user" } })).revision).toBe(before.revision);

  await mutate({ title: "Tamarind sensors revised", description: "Unindexedbody stays on the note.", tags: ["newerlabel"],
    kindMeta: { memorySummary: "Finalcalibration controls verified." }, botId });
  expect((await readSnapshot()).promptSections).toEqual({ other: pinned.other });
  expect((await prisma.memoryRevision.findUniqueOrThrow({ where: { scope: "user" } })).revision).toBe(before.revision + 1);
  expect(await recallHistory("Finalcalibration")).toContain("[note] Tamarind sensors revised: Finalcalibration controls verified. (Tags: newerlabel)");
  expect(await recallHistory("newerlabel")).toContain(`[noteId: ${noteId}]`);
  for (const query of ["Unindexedbody", "Legacycalibration", "olderlabel"]) {
    expect(await recallHistory(query)).not.toContain(`[noteId: ${noteId}]`);
  }
  expect(await prisma.memoryFact.count({ where: { sourceOutcomeId: noteId } })).toBe(1);

  for (const data of [{ status: "archived" }, { status: "cancelled" }, { kindMeta: { syncToMemory: false } }, { kind: "todo", status: "open" }] as const) {
    await mutate(data);
    expect(await prisma.memoryFact.count({ where: { sourceOutcomeId: noteId } })).toBe(0);
    expect(await recallHistory("Tamarind sensors")).not.toContain(`[noteId: ${noteId}]`);
    await mutate({ kind: "note", status: "active", kindMeta: {} });
    expect(await recallHistory("Tamarind sensors")).toContain(`[noteId: ${noteId}]`);
  }
}));
