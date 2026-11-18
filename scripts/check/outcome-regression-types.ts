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
  "scripts/backup.test.ts",
  "scripts/outcome-recovery/product-replay.ts",
  "apps/server/test/fixtures/outcome-recovery/product-replay.ts",
  "apps/server/test/outcome-product-replay.integration.test.ts",
  "apps/server/test/fixtures/outcome-decision-replay.ts",
  "apps/server/test/outcome-decision-full-replay.integration.test.ts",
  "scripts/test-outcome-populated-backup.ts",
  "scripts/outcome-recovery/populated-backup.test.ts",
  "apps/server/test/fixtures/outcome-recovery/populated-backup.ts",
  "scripts/migration/validate-outcomego-backup.ts",
  "apps/desktop/test/outcome-human-receipt-ui.test.tsx",
  "apps/desktop/test/outcome-disclosure-ui.test.tsx",
  "apps/desktop/test/bot-screen-refresh.test.tsx",
  "apps/server/test/outcome-chat-tools.integration.test.ts",
  "apps/server/test/outcome-brief.test.ts",
  "apps/desktop/src/renderer/env.d.ts",
  "apps/desktop/src/renderer/novnc.d.ts",
];

const config = ts.readConfigFile(resolve(root, "tsconfig.base.json"), ts.sys.readFile);
if (config.error) throw new Error("typescript_configuration_unreadable");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const targets = new Set(regressionTypeTargets.map(file => resolve(root, file)));
// Match Desktop's normal vite/client ambient types for the mounted UI test.
const program = ts.createProgram([...targets, resolve(root, "apps/desktop/node_modules/vite/client.d.ts")], {
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
