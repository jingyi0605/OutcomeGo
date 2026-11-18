import { readFileSync } from "node:fs";

export type BackupForeignKey = {
  columns: string[];
  targetTable: string;
  targetColumns: string[];
};

export type BackupTable = {
  columns: Set<string>;
  foreignKeys: BackupForeignKey[];
};

export type BackupSchema = Map<string, BackupTable>;

const attributeArguments = (declaration: string, name: string): string | undefined => {
  // Quoted defaults and relation names can contain text resembling attributes.
  for (const token of declaration.matchAll(/"(?:\\.|[^"\\])*"|@@?[\w.]+/g)) {
    if (token[0] !== name) continue;
    const start = token.index + token[0].length;
    const suffix = declaration.slice(start);
    if (!/^\s*\(/.test(suffix)) throw new Error(`Cannot read backup schema attribute ${name}`);
    let depth = 0;
    let opening = -1;
    for (const part of suffix.matchAll(/"(?:\\.|[^"\\])*"|[()]/g)) {
      if (part[0] === "(") {
        if (depth++ === 0) opening = part.index;
      } else if (part[0] === ")" && --depth === 0) {
        return suffix.slice(opening + 1, part.index);
      }
    }
    throw new Error(`Unclosed backup schema attribute ${name}`);
  }
  return undefined;
};

/** Read physical names and explicit foreign keys, without loading Prisma or a database. */
export const parseBackupSchema = (source: string): BackupSchema => {
  // Preserve quoted defaults and line breaks when removing Prisma comments.
  const uncommented = source.replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.startsWith('"') ? token : token.replace(/[^\r\n]/g, " ")
  );
  const models = new Map(
    [...uncommented.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)].map(
      ([, name, body]) => {
        const fields = new Map(
          body!.split(/\n(?=\s*(?:\w+\s+\w|@@))/).flatMap((declaration) => {
            const field = declaration.match(/^\s*(\w+)\s+(\w+)([\s\S]*)$/);
            if (!field) return [];
            const [, fieldName, type, attributes] = field;
            const mapped = attributeArguments(attributes!, "@map");
            return [[fieldName!, {
              type: type!,
              column: mapped === undefined ? fieldName! : JSON.parse(mapped) as string,
              attributes: attributes!,
            }] as const];
          })
        );
        const mapped = attributeArguments(body!, "@@map");
        return [name!, { table: mapped === undefined ? name! : JSON.parse(mapped) as string, fields }] as const;
      }
    )
  );
  const modelDeclarations = [...uncommented.matchAll(/^\s*model\s+\w+\s*\{/gm)].length;
  if (models.size === 0 || models.size !== modelDeclarations) {
    throw new Error("Cannot read all current backup schema models");
  }

  const schema: BackupSchema = new Map();
  for (const [name, model] of models) {
    const columns = new Set(
      [...model.fields.values()].filter((field) => !models.has(field.type)).map((field) => field.column)
    );
    const foreignKeys: BackupForeignKey[] = [];
    for (const field of model.fields.values()) {
      const relationAttribute = attributeArguments(field.attributes, "@relation");
      if (relationAttribute === undefined) continue;
      const relation = relationAttribute.replace(/"(?:\\.|[^"\\])*"/g, "");
      const from = relation.match(/\bfields\s*:\s*\[([^\]]*)\]/)?.[1];
      const to = relation.match(/\breferences\s*:\s*\[([^\]]*)\]/)?.[1];
      if (from === undefined && to === undefined) continue; // Inverse relation; no stored foreign key.
      const target = models.get(field.type);
      const identifiers = (list: string | undefined): string[] =>
        list?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
      const sourceFields = identifiers(from);
      const targetFields = identifiers(to);
      if (!target || !sourceFields.length || sourceFields.length !== targetFields.length) {
        throw new Error(`Cannot read backup foreign key ${name}.${field.column}`);
      }
      const physicalColumns = (
        fields: typeof model.fields,
        names: string[]
      ): string[] => names.map((fieldName) => {
        const scalar = fields.get(fieldName);
        if (!scalar || models.has(scalar.type)) {
          throw new Error(`Unknown backup foreign key field ${fieldName}`);
        }
        return scalar.column;
      });
      foreignKeys.push({
        columns: physicalColumns(model.fields, sourceFields),
        targetTable: target.table,
        targetColumns: physicalColumns(target.fields, targetFields),
      });
    }
    if (schema.has(model.table)) throw new Error(`Duplicate backup physical table ${model.table}`);
    schema.set(model.table, { columns, foreignKeys });
  }
  return schema;
};

let currentSchema: BackupSchema | undefined;

export const currentBackupSchema = (): BackupSchema =>
  currentSchema ??= parseBackupSchema(
    readFileSync(new URL("../../packages/db/prisma/schema.prisma", import.meta.url), "utf8")
  );

export const checkBackupReferences = (
  tables: Record<string, Array<Record<string, unknown>>>,
  schema = currentBackupSchema()
): void => {
  const indexes = new Map<string, Set<string>>();
  for (const [table, rows] of Object.entries(tables)) {
    for (const foreignKey of schema.get(table)!.foreignKeys) {
      const { columns, targetTable, targetColumns } = foreignKey;
      const indexKey = JSON.stringify([targetTable, targetColumns]);
      let index = indexes.get(indexKey);
      if (!index) {
        index = new Set(
          (tables[targetTable] ?? [])
            .map((row) => targetColumns.map((column) => row[column]))
            .filter((values) => values.every((value) => value !== null && value !== undefined))
            .map((values) => JSON.stringify(values))
        );
        indexes.set(indexKey, index);
      }
      for (const row of rows) {
        const values = columns.map((column) => row[column]);
        // PostgreSQL's default MATCH SIMPLE exempts a tuple containing any null.
        // Omitted fields retain the validator's existing sparse-row behavior.
        if (values.some((value) => value === null || value === undefined)) continue;
        if (!index.has(JSON.stringify(values))) {
          throw new Error(
            `${table}.${columns.join(",")} references missing ${targetTable} ${targetColumns.join(",")} ${
              values.length === 1 ? String(values[0]) : JSON.stringify(values)
            }`
          );
        }
      }
    }
  }
};
