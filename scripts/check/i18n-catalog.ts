import { resolve } from "node:path";
import * as tsModule from "typescript";

/**
 * Catalog coverage check for the desktop renderer.
 *
 * Every `t("...")` call must resolve in the shipped catalog, and no shipped
 * translation may repeat its English source (that silently reintroduces English
 * text in the Chinese interface). The check is read-only and cheap, so it runs
 * alongside the other architecture checks.
 */

const ts = (tsModule as unknown as { default?: typeof tsModule }).default ?? tsModule;
const root = resolve(import.meta.dir, "../..");
const rendererDir = resolve(root, "apps/desktop/src/renderer");
const catalogFile = resolve(rendererDir, "lib/i18n-catalog.ts");

const readSource = async (path: string) =>
  ts.createSourceFile(
    path,
    await Bun.file(path).text(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

const collectFiles = async (dir: string): Promise<string[]> =>
  (await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: dir, absolute: true }))).sort();

const catalogEntries = async (): Promise<Map<string, string>> => {
  const file = await readSource(catalogFile);
  let entries: Map<string, string> | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "sourceTranslations" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      entries = new Map(
        node.initializer.properties.map((property) => {
          if (!ts.isPropertyAssignment(property)) {
            throw new Error(`Unsupported catalog entry in ${catalogFile}: ${property.getText()}`);
          }
          const name = property.name;
          const key = ts.isIdentifier(name) ? name.text : name.text;
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
    throw new Error("No catalog entries found in i18n-catalog.ts");
  return entries;
};

/** Functions that resolve a catalog key to interface copy. */
const TRANSLATORS = new Set(["t", "translate", "translateCurrent"]);

const usedKeys = async (): Promise<Map<string, string[]>> => {
  const files = await collectFiles(rendererDir);
  const used = new Map<string, string[]>();
  for (const path of files) {
    if (path === catalogFile) continue;
    const file = await readSource(path);
    const relative = path.slice(root.length + 1);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        TRANSLATORS.has(node.expression.text)
      ) {
        // `translate(locale, key, …)` takes the locale first; the others take the key first.
        const [first] =
          node.expression.text === "translate" ? node.arguments.slice(1) : node.arguments;
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

const catalog = await catalogEntries();
const used = await usedKeys();

const keys = [...catalog.keys()];
const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
const missing = [...used.keys()].filter((key) => !catalog.has(key)).sort();
const unused = keys.filter((key) => !used.has(key)).sort();
// Product and protocol names stay identical in every language.
const UNTRANSLATABLE = new Set(["Tailscale HTTPS"]);
// A translation that repeats the English source is almost always a missed entry.
const untranslated = keys
  .filter(
    (key) =>
      catalog.get(key) === key &&
      !UNTRANSLATABLE.has(key) &&
      /[A-Za-z]{2,}[ ,.'’-]+[A-Za-z]{2,}/.test(key)
  )
  .sort();

const report = {
  catalogKeys: catalog.size,
  usedKeys: used.size,
  missing,
  missingLocations: Object.fromEntries(missing.map((key) => [key, used.get(key)?.slice(0, 4)])),
  unused,
  duplicates,
  untranslated,
};

const problems: string[] = [];
if (duplicates.length > 0)
  problems.push(
    `Duplicate catalog keys: ${duplicates.map((key) => JSON.stringify(key)).join(", ")}`
  );
if (missing.length > 0) {
  problems.push(
    `Missing catalog entries:\n${missing
      .map((key) => `  ${JSON.stringify(key)}\n    ${used.get(key)?.slice(0, 3).join("\n    ")}`)
      .join("\n")}`
  );
}
if (untranslated.length > 0) {
  problems.push(
    `Catalog entries still equal to their English source:\n${untranslated
      .map((key) => `  ${JSON.stringify(key)}`)
      .join("\n")}`
  );
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
  process.exit(problems.length > 0 ? 1 : 0);
}

if (unused.length > 0) {
  console.log(
    `i18n: ${unused.length} catalog entr${unused.length === 1 ? "y is" : "ies are"} currently unused`
  );
}

if (problems.length > 0) {
  console.error(problems.join("\n\n"));
  process.exit(1);
}

console.log(
  `i18n: ${used.size} translated strings across ${catalog.size} catalog entries are consistent`
);
