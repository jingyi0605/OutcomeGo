import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkBackupReferences, parseBackupSchema } from "./backup-schema";
import {
  createOutcomegoBackup,
  validateOutcomegoBackup,
  validateOutcomegoBackupFile,
} from "./validate-outcomego-backup";

describe("OutcomeGo latest-schema backup validation", () => {
  test("accepts a backup that already uses the current physical schema", () => {
    const backup = createOutcomegoBackup({
      outcomego_bot: [{ id: "bot-1", name: "OutcomeGo" }],
      outcomego_channel: [{ id: "channel-1", name: "Launch" }],
      outcomego_channel_member: [{ channelId: "channel-1", botId: "bot-1" }],
    });

    const result = validateOutcomegoBackup(JSON.stringify(backup));

    expect(result.backup).toEqual(backup);
    expect(result.rowCounts).toEqual({
      outcomego_bot: 1,
      outcomego_channel: 1,
      outcomego_channel_member: 1,
    });
  });

  test("rejects a legacy format instead of converting table or field names", () => {
    expect(() =>
      validateOutcomegoBackup(
        JSON.stringify({
          manifest: {
            format: "legacy-backup/v1",
            product: "LegacyProduct",
            schema: "legacy-v1",
            schemaVersion: 1,
            dataSha256: "0".repeat(64),
            rowCounts: {},
          },
          tables: { Bot: [{ id: "bot-1" }] },
        })
      )
    ).toThrow("backup.manifest.format must be outcomego-backup/v1");
  });

  test("rejects a current manifest that contains a non-current table name", () => {
    const backup = createOutcomegoBackup({ Bot: [{ id: "bot-1" }] });

    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "is not a current OutcomeGo physical table name"
    );
  });

  test("rejects broken relationships before import", () => {
    const backup = createOutcomegoBackup({
      outcomego_bot: [],
      outcomego_channel_member: [{ botId: "missing" }],
    });

    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "outcomego_channel_member.botId references missing outcomego_bot id missing"
    );
  });

  test("rejects a changed payload or row count", () => {
    const backup = createOutcomegoBackup({
      outcomego_bot: [{ id: "bot-1" }],
    });
    backup.tables.outcomego_bot.push({ id: "bot-2" });

    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "backup.manifest.dataSha256 does not match tables"
    );
  });

  test("rejects an unknown table even when it has the current product prefix", () => {
    const backup = createOutcomegoBackup({ outcomego_nonexistent_table: [{ id: "synthetic" }] });
    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "outcomego_nonexistent_table is not a current OutcomeGo physical table name"
    );
  });

  test("rejects the historical channel.botId sample as a nonexistent physical column", () => {
    const backup = createOutcomegoBackup({
      outcomego_channel: [{ id: "channel-1", botId: "missing" }],
    });
    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "outcomego_channel.botId is not a current OutcomeGo physical column"
    );
  });

  test("rejects a non-null foreign key when its entire target table is omitted", () => {
    const backup = createOutcomegoBackup({
      outcomego_channel: [{ id: "channel-1" }],
      outcomego_channel_member: [{ channelId: "channel-1", botId: "missing" }],
    });
    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "outcomego_channel_member.botId references missing outcomego_bot id missing"
    );
  });

  test("rejects an Outcome work item referencing a missing Outcome", () => {
    const backup = createOutcomegoBackup({
      outcomego_outcome: [],
      outcomego_outcome_work_item: [{ id: "work-1", outcomeId: "missing" }],
    });
    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "outcomego_outcome_work_item.outcomeId references missing outcomego_outcome id missing"
    );
  });

  test.each([
    ["outcomego_outcome_decision", "contractRevisionId", "outcomego_outcome_contract_revision"],
    ["outcomego_outcome_decision", "workItemId", "outcomego_outcome_work_item"],
    ["outcomego_outcome_human_receipt", "outcomeId", "outcomego_outcome"],
    ["outcomego_outcome_human_receipt", "workItemId", "outcomego_outcome_work_item"],
    ["outcomego_outcome_human_action_card", "requestedByWorkItemId", "outcomego_outcome_work_item"],
  ])("checks %s.%s against its declared schema relation", (table, column, target) => {
    const backup = createOutcomegoBackup({ [table]: [{ [column]: "missing" }] });
    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      `${table}.${column} references missing ${target} id missing`
    );
  });

  test("accepts a connected Outcome, Decision, human action and receipt graph", () => {
    const backup = createOutcomegoBackup({
      outcomego_bot: [{ id: "bot-1" }],
      outcomego_outcome: [{ id: "outcome-1", botId: "bot-1", currentRevisionId: "revision-1" }],
      outcomego_outcome_contract_revision: [{ id: "revision-1", outcomeId: "outcome-1" }],
      outcomego_outcome_work_item: [
        { id: "work-1", outcomeId: "outcome-1", contractRevisionId: "revision-1", rootRunId: null },
      ],
      outcomego_outcome_decision: [
        { id: "decision-1", outcomeId: "outcome-1", contractRevisionId: "revision-1", workItemId: "work-1" },
      ],
      outcomego_outcome_human_action_card: [{ workItemId: "work-1", requestedByWorkItemId: null }],
      outcomego_outcome_human_receipt: [{ id: "receipt-1", workItemId: "work-1", outcomeId: "outcome-1" }],
    });
    expect(validateOutcomegoBackup(JSON.stringify(backup)).backup).toEqual(backup);
  });

  test("uses the referenced physical column rather than assuming an id column", () => {
    const backup = createOutcomegoBackup({
      outcomego_host_machine: [{ machineId: "host-1" }],
      outcomego_messages_allowed_recipient: [{ machineId: "host-1", recipient: "fixture@example.test" }],
    });
    expect(validateOutcomegoBackup(JSON.stringify(backup)).backup).toEqual(backup);
  });

  test("resolves sessionId using its source model instead of a shared column-name heuristic", () => {
    const backup = createOutcomegoBackup({
      outcomego_voice_session: [{ id: "voice-1" }],
      outcomego_voice_turn: [{ id: "turn-1", sessionId: "voice-1" }],
    });
    expect(validateOutcomegoBackup(JSON.stringify(backup)).backup).toEqual(backup);
  });

  test("allows null optional keys, empty tables and scalar IDs without schema foreign keys", () => {
    const backup = createOutcomegoBackup({
      outcomego_saved_skill: [{ id: "skill-1", botId: null }],
      outcomego_channel_member: [],
      outcomego_search_document: [{
        id: "projection-1", botId: "retired-bot", channelId: "retired-channel", searchVector: "'fixture':1",
      }],
    });
    expect(validateOutcomegoBackup(JSON.stringify(backup)).backup).toEqual(backup);
  });

  test("rejects incorrect row counts even when the table data checksum is valid", () => {
    const backup = createOutcomegoBackup({ outcomego_bot: [{ id: "bot-1" }] });
    backup.manifest.rowCounts.outcomego_bot = 2;
    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "backup.manifest.rowCounts does not match tables"
    );
  });

  test("file validation leaves valid and rejected source backups byte-for-byte unchanged", async () => {
    const directory = await mkdtemp(join(import.meta.dirname, ".backup-validation-"));
    try {
      const samples: Array<Parameters<typeof createOutcomegoBackup>[0]> = [
        { outcomego_bot: [{ id: "bot-1" }] },
        { outcomego_outcome_work_item: [{ id: "work-1", outcomeId: "missing" }] },
      ];
      for (const tables of samples) {
        const backup = createOutcomegoBackup(tables);
        const path = join(directory, "source.json");
        await writeFile(path, JSON.stringify(backup, null, 2) + "\n");
        const before = await readFile(path);
        const hash = createHash("sha256").update(before).digest("hex");
        for (let attempt = 0; attempt < 2; attempt++) {
          if ("outcomego_bot" in tables) {
            expect((await validateOutcomegoBackupFile(path)).backup).toEqual(backup);
          } else {
            await expect(validateOutcomegoBackupFile(path)).rejects.toThrow("references missing");
          }
          expect(await readFile(path)).toEqual(before);
          expect(createHash("sha256").update(await readFile(path)).digest("hex")).toBe(hash);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("schema-backed backup relationships", () => {
  const schema = parseBackupSchema(`
model Parent {
  tenant String @map("tenant_id")
  key String
  children FutureExplore[]
  @@id([tenant, key])
  @@map("outcomego_parent")
}

// A future model is recognized directly from schema, without a validator allowlist.
model FutureExplore {
  id String @id
  parentTenant String? @map("parent_tenant")
  parentKey String? @map("parent_key")
  label String @default("https://example.test/{sample}") // Comment must not consume the quoted URL.
  diagnostic String @default("@relation(fields: [notAField], references: [notAField])")
  parent Parent? @relation(
    fields: [parentTenant, parentKey],
    references: [tenant, key]
  )
  @@map("outcomego_future_explore")
}
`);

  test("loads new model names, mapped columns and multiline composite foreign keys from schema", () => {
    expect(schema.get("outcomego_future_explore")?.columns).toEqual(
      new Set(["id", "parent_tenant", "parent_key", "label", "diagnostic"])
    );
    expect(schema.get("outcomego_future_explore")?.foreignKeys).toEqual([{
      columns: ["parent_tenant", "parent_key"],
      targetTable: "outcomego_parent",
      targetColumns: ["tenant_id", "key"],
    }]);
  });

  test("checks a composite reference as one tuple and honors MATCH SIMPLE null semantics", () => {
    const tables = {
      outcomego_parent: [{ tenant_id: "tenant-a", key: "one" }, { tenant_id: "tenant-b", key: "two" }],
      outcomego_future_explore: [{ id: "explore-1", parent_tenant: "tenant-a", parent_key: "one" }],
    };
    expect(() => checkBackupReferences(tables, schema)).not.toThrow();
    tables.outcomego_future_explore[0]!.parent_key = "two";
    expect(() => checkBackupReferences(tables, schema)).toThrow(
      'references missing outcomego_parent tenant_id,key ["tenant-a","two"]'
    );
    expect(() => checkBackupReferences({
      outcomego_future_explore: [{ parent_tenant: "tenant-a", parent_key: null }],
    }, schema)).not.toThrow();
    expect(() => checkBackupReferences({
      outcomego_future_explore: [{ parent_tenant: "tenant-a", parent_key: "one" }],
    }, schema)).toThrow("references missing outcomego_parent");
  });

  test("rejects an unsupported or unresolved schema relation instead of dropping it", () => {
    expect(() => parseBackupSchema(`
model Broken {
  id String @id
  parentId String
  parent Missing @relation(fields: [parentId], references: [id])
  @@map("outcomego_broken")
}
`)).toThrow("Cannot read backup foreign key");
    expect(() => parseBackupSchema("model Inline { id String @id }")).toThrow(
      "Cannot read all current backup schema models"
    );
  });
});
