import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;
type PortableTable = JsonObject[];

export const OUTCOMEGO_BACKUP_FORMAT = "outcomego-backup/v1" as const;
export const OUTCOMEGO_DATABASE_SCHEMA = "outcomego-v1" as const;

export type OutcomeGoBackup = {
  manifest: {
    format: typeof OUTCOMEGO_BACKUP_FORMAT;
    product: "OutcomeGo";
    schema: typeof OUTCOMEGO_DATABASE_SCHEMA;
    schemaVersion: 1;
    dataSha256: string;
    rowCounts: Record<string, number>;
    createdAt?: string;
    [key: string]: unknown;
  };
  tables: Record<string, PortableTable>;
};

export type BackupValidation = {
  backup: OutcomeGoBackup;
  dataSha256: string;
  rowCounts: Record<string, number>;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const assertObject = (value: unknown, label: string): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
};

const assertSha256 = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
};

const assertRowCounts = (value: unknown): Record<string, number> => {
  const rowCounts = assertObject(value, "backup.manifest.rowCounts");
  for (const [table, count] of Object.entries(rowCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`backup.manifest.rowCounts.${table} must be a non-negative integer`);
    }
  }
  return rowCounts as Record<string, number>;
};

const validateManifest = (value: unknown): OutcomeGoBackup["manifest"] => {
  const manifest = assertObject(value, "backup.manifest");
  if (manifest.format !== OUTCOMEGO_BACKUP_FORMAT) {
    throw new Error(`backup.manifest.format must be ${OUTCOMEGO_BACKUP_FORMAT}`);
  }
  if (manifest.product !== "OutcomeGo") {
    throw new Error("backup.manifest.product must be OutcomeGo");
  }
  if (manifest.schema !== OUTCOMEGO_DATABASE_SCHEMA) {
    throw new Error(`backup.manifest.schema must be ${OUTCOMEGO_DATABASE_SCHEMA}`);
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error("backup.manifest.schemaVersion must be 1");
  }
  return {
    ...manifest,
    format: OUTCOMEGO_BACKUP_FORMAT,
    product: "OutcomeGo",
    schema: OUTCOMEGO_DATABASE_SCHEMA,
    schemaVersion: 1,
    dataSha256: assertSha256(manifest.dataSha256, "backup.manifest.dataSha256"),
    rowCounts: assertRowCounts(manifest.rowCounts),
  };
};

const validateTables = (value: unknown): Record<string, PortableTable> => {
  const tables = assertObject(value, "backup.tables") as Record<string, unknown>;
  const validated: Record<string, PortableTable> = {};
  for (const [table, rows] of Object.entries(tables)) {
    if (!/^outcomego_[a-z0-9_]+$/.test(table)) {
      throw new Error(`backup.tables.${table} is not a current OutcomeGo physical table name`);
    }
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
    ) {
      throw new Error(`backup.tables.${table} must be an array of objects`);
    }
    validated[table] = rows as PortableTable;
  }
  return validated;
};

const checkReferences = (tables: Record<string, PortableTable>): void => {
  const ids = new Map<string, Set<unknown>>();
  for (const [table, rows] of Object.entries(tables)) {
    ids.set(
      table,
      new Set(rows.map((row) => row.id).filter((id) => id !== undefined && id !== null))
    );
  }

  const references: Array<[string, string]> = [
    ["botId", "outcomego_bot"],
    ["parentBotId", "outcomego_bot"],
    ["childBotId", "outcomego_bot"],
    ["executorBotId", "outcomego_bot"],
    ["writtenByBotId", "outcomego_bot"],
    ["senderBotId", "outcomego_bot"],
    ["initiatorBotId", "outcomego_bot"],
    ["subagentBotId", "outcomego_bot"],
    ["userId", "outcomego_user"],
    ["channelId", "outcomego_channel"],
    ["parentChannelId", "outcomego_channel"],
    ["sourceChannelId", "outcomego_channel"],
    ["runId", "outcomego_run"],
    ["parentRunId", "outcomego_run"],
    ["requestRunId", "outcomego_run"],
    ["currentRunId", "outcomego_run"],
    ["childRunId", "outcomego_run"],
    ["sourceRunId", "outcomego_run"],
    ["sessionId", "outcomego_context_session"],
    ["contextSessionId", "outcomego_context_session"],
    ["routineId", "outcomego_routine"],
    ["routineRevisionId", "outcomego_routine_revision"],
  ];

  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      for (const [column, target] of references) {
        const value = row[column];
        if (
          value !== undefined &&
          value !== null &&
          ids.has(target) &&
          !ids.get(target)!.has(value)
        ) {
          throw new Error(`${table}.${column} references missing ${target} id ${String(value)}`);
        }
      }
    }
  }
};

const validateBackupObject = (value: unknown): OutcomeGoBackup => {
  const root = assertObject(value, "backup");
  const manifest = validateManifest(root.manifest);
  const tables = validateTables(root.tables);
  const calculatedHash = sha256(canonicalJson(tables));
  if (manifest.dataSha256 !== calculatedHash) {
    throw new Error(
      `backup.manifest.dataSha256 does not match tables: expected ${calculatedHash}, received ${manifest.dataSha256}`
    );
  }

  const calculatedRowCounts = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, rows.length])
  );
  if (canonicalJson(manifest.rowCounts) !== canonicalJson(calculatedRowCounts)) {
    throw new Error("backup.manifest.rowCounts does not match tables");
  }

  checkReferences(tables);
  return { manifest, tables };
};

export const createOutcomegoBackup = (
  tables: Record<string, PortableTable>,
  metadata: { createdAt?: string } = {}
): OutcomeGoBackup => {
  const rowCounts = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, rows.length])
  );
  return {
    manifest: {
      format: OUTCOMEGO_BACKUP_FORMAT,
      product: "OutcomeGo",
      schema: OUTCOMEGO_DATABASE_SCHEMA,
      schemaVersion: 1,
      dataSha256: sha256(canonicalJson(tables)),
      rowCounts,
      ...metadata,
    },
    tables,
  };
};

export const validateOutcomegoBackup = (sourceText: string): BackupValidation => {
  const backup = validateBackupObject(JSON.parse(sourceText));
  return {
    backup,
    dataSha256: backup.manifest.dataSha256,
    rowCounts: backup.manifest.rowCounts,
  };
};

export const validateOutcomegoBackupFile = async (inputPath: string): Promise<BackupValidation> => {
  return validateOutcomegoBackup(await readFile(inputPath, "utf8"));
};

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (import.meta.main) {
  const input = argument("--input");
  if (!input) {
    console.error("Usage: bun scripts/migration/validate-outcomego-backup.ts --input outcomego-backup.json");
    process.exit(2);
  }

  const inputPath = resolve(input);
  const result = await validateOutcomegoBackupFile(inputPath);
  console.log(`Validated latest OutcomeGo backup at ${inputPath}`);
  console.log(`Schema: ${result.backup.manifest.schema}`);
  console.log(`Data SHA-256: ${result.dataSha256}`);
  console.log(`Rows: ${JSON.stringify(result.rowCounts)}`);
}
