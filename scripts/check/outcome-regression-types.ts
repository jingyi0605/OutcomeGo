import ts from "typescript";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dir, "../..");
export const regressionTypeTargets = [
  "scripts/check/outcome-regression-types.ts", "scripts/check-outcome-contracts.ts", "scripts/check-outcome-contracts.test.ts",
  "scripts/check/test-database-gates.ts", "scripts/check/test-database-gates.test.ts",
  "scripts/test-outcome-recovery.ts",
  "scripts/outcome-recovery/report.ts", "scripts/outcome-recovery/report.test.ts",
  "apps/server/test/fixtures/outcome-recovery/fixture.ts", "apps/server/test/fixtures/outcome-recovery/scenarios.ts",
  "apps/server/test/fixtures/outcome-recovery/restart-process.ts", "apps/server/test/fixtures/outcome-recovery/recovery-process.ts",
  "scripts/outcome-recovery/scenarios.integration.test.ts",
  "apps/server/test/outcome-cross-phase-regression.integration.test.ts",
];

const config = ts.readConfigFile(resolve(root, "tsconfig.base.json"), ts.sys.readFile);
if (config.error) throw new Error("typescript_configuration_unreadable");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const targets = new Set(regressionTypeTargets.map(file => resolve(root, file)));
const program = ts.createProgram([...targets], {
  ...parsed.options, noEmit: true, types: ["bun"],
});
const diagnostics = ts.getPreEmitDiagnostics(program);
const owned = diagnostics.filter(diagnostic => diagnostic.file && targets.has(resolve(diagnostic.file.fileName)));
const dependencyDiagnostics = diagnostics.filter(diagnostic => !diagnostic.file || !targets.has(resolve(diagnostic.file.fileName)));
console.log(JSON.stringify({
  targetStatus: owned.length ? "FAIL" : "PASS", targetFiles: targets.size,
  diagnostics: owned.map(diagnostic => ({
    file: relative(root, diagnostic.file!.fileName),
    line: diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
    code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  })),
  dependencyDiagnosticCount: dependencyDiagnostics.length,
  dependencyDiagnostics: dependencyDiagnostics.map(diagnostic => ({
    file: diagnostic.file ? relative(root, diagnostic.file.fileName) : null,
    code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  })),
  fullWorkspaceTypecheck: "PENDING", databaseExecution: "PENDING",
}, null, 2));
process.exitCode = owned.length ? 1 : 0;
