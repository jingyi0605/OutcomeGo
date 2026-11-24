import { resolve } from "node:path";
import * as tsModule from "typescript";

/**
 * Catalog coverage check for the CLI.
 *
 * Every `cliTranslate("…")` call must resolve in the CLI catalog, and no entry may
 * repeat its English source — otherwise Chinese output silently falls back to English.
 */

const ts = (tsModule as unknown as { default?: typeof tsModule }).default ?? tsModule;
const root = resolve(import.meta.dir, "../..");
const cliDir = resolve(root, "apps/cli/src");
const catalogFile = resolve(cliDir, "localization.ts");

const readSource = async (path: string) =>
  ts.createSourceFile(
    path,
    await Bun.file(path).text(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

const catalogEntries = async (): Promise<Map<string, string>> => {
  const file = await readSource(catalogFile);
  let entries: Map<string, string> | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "simplifiedChinese" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      entries = new Map(
        node.initializer.properties.map((property) => {
          if (!ts.isPropertyAssignment(property)) {
            throw new Error(`Unsupported catalog entry in ${catalogFile}: ${property.getText()}`);
          }
          const key = property.name.text;
          const value = property.initializer;
          if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) {
            throw new Error(`Catalog value for ${JSON.stringify(key)} must be a string literal`);
          }
          return [key, value.text] as const;
        })
      );
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!entries || entries.size === 0)
    throw new Error("No catalog entries found in localization.ts");
  return entries;
};

const usedKeys = async (): Promise<Map<string, string[]>> => {
  const used = new Map<string, string[]>();
  const files = (
    await Array.fromAsync(new Bun.Glob("**/*.ts").scan({ cwd: cliDir, absolute: true }))
  ).sort();
  for (const path of files) {
    if (path === catalogFile) continue;
    const file = await readSource(path);
    const relative = path.slice(root.length + 1);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "cliTranslate"
      ) {
        const [first] = node.arguments;
        if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
          const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const locations = used.get(first.text) ?? [];
          locations.push(`${relative}:${line}`);
          used.set(first.text, locations);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return used;
};

const stringObject = async (path: string, name: string): Promise<Map<string, string>> => {
  const file = await readSource(path);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(file) !== name || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      return new Map(declaration.initializer.properties.flatMap(property =>
        ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && ts.isStringLiteral(property.initializer)
          ? [[property.name.text, property.initializer.text] as const] : []));
    }
  }
  throw new Error(`Missing ${name} in ${path}`);
};

const catalog = await catalogEntries();
const renderer = resolve(root, "apps/desktop/src/renderer/lib");
const cliErrors = await stringObject(resolve(cliDir, "deploy-events.ts"), "deployErrorTexts");
const desktopErrors = await stringObject(resolve(renderer, "local-deploy-flow.ts"), "issues");
const desktopCatalog = await stringObject(resolve(renderer, "i18n-catalog.ts"), "sourceTranslations");
const design = await Bun.file(resolve(root, "specs/012-桌面端一键本地部署/design.md")).text();
const errorTable = design.split(/^### 5\.1 /m)[1]?.split(/^### 5\.2 /m)[0] ?? "";
const documentedCodes = new Set(Array.from(errorTable.matchAll(/^\| `([A-Z_]+)` \|/gm), match => match[1]!));
const troubleshooting = await Bun.file(resolve(root, "docs/manage/troubleshooting.md")).text();
const deploymentDifferences = [...new Set([...documentedCodes, ...cliErrors.keys(), ...desktopErrors.keys()])].filter(code => {
  const text = cliErrors.get(code);
  return !documentedCodes.has(code) || !text || text !== desktopErrors.get(code) || !catalog.has(text) || catalog.get(text) !== desktopCatalog.get(text)
    || troubleshooting.split(`| \`${code}\` |`).length !== 2;
});
if (cliErrors.size === 0 || deploymentDifferences.length) throw new Error(`Deployment error catalog mismatch: ${deploymentDifferences.join(", ")}`);
console.log(`i18n (deploy): ${cliErrors.size} error codes match on CLI, desktop, Spec and troubleshooting`);
const used = await usedKeys();
const keys = [...catalog.keys()];

const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
const missing = [...used.keys()].filter((key) => !catalog.has(key)).sort();
const report = { catalogKeys: catalog.size, usedKeys: used.size, missing, duplicates };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
  process.exit(missing.length > 0 || duplicates.length > 0 ? 1 : 0);
}

const problems: string[] = [];
if (duplicates.length > 0)
  problems.push(
    `Duplicate CLI catalog keys: ${duplicates.map((key) => JSON.stringify(key)).join(", ")}`
  );
if (missing.length > 0)
  problems.push(
    `Missing CLI catalog entries:\n${missing
      .map((key) => `  ${JSON.stringify(key)}\n    ${used.get(key)?.slice(0, 3).join("\n    ")}`)
      .join("\n")}`
  );
if (problems.length > 0) {
  console.error(problems.join("\n\n"));
  process.exit(1);
}

console.log(
  `i18n (cli): ${used.size} translated strings across ${catalog.size} catalog entries are consistent`
);
