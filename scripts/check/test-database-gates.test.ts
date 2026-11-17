import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkTestDatabaseGates } from "./test-database-gates";

test("all legacy database read sites support the canonical CI environment", async () => {
  const result = await checkTestDatabaseGates();
  expect(result.failures).toEqual([]);
  expect(result.status).toBe("PASS");
  expect(result.files.filter(path => path.startsWith("apps/worker/"))).toHaveLength(11);
  expect(result.databaseExecution).toBe("PENDING");
});

test("real Routine skip gates activate under canonical-only and legacy-only input", async () => {
  const root = resolve(import.meta.dir, "../..");
  for (const file of ["routine-275-regressions", "routine-retest-execution", "routine-stop-ordering"]) {
    const source = await readFile(resolve(root, `apps/worker/test/${file}.integration.test.ts`), "utf8");
    const expression = source.match(/const integration = test\.skipIf\(!(.+)\);/)?.[1];
    expect(expression).toBeDefined();
    // Evaluate only this audited environment expression, never import a DB fixture.
    expect(expression).toMatch(/^\(process\.env\.OUTCOMEGO_TEST_DATABASE_URL \?\? process\.env\.OPENTEAM_TEST_DATABASE_URL\)$/);
    const read = new Function("process", `return ${expression};`) as (value: { env: Record<string, string> }) => string | undefined;
    expect(read({ env: { OUTCOMEGO_TEST_DATABASE_URL: "canonical" } })).toBe("canonical");
    expect(read({ env: { OPENTEAM_TEST_DATABASE_URL: "legacy" } })).toBe("legacy");
    expect(read({ env: { OUTCOMEGO_TEST_DATABASE_URL: "canonical", OPENTEAM_TEST_DATABASE_URL: "legacy" } })).toBe("canonical");
    expect(read({ env: {} })).toBeUndefined();
  }
});

test("crash fixture and Routine harness select the same URL as their parent gate", async () => {
  const root = resolve(import.meta.dir, "../..");
  for (const file of ["apps/worker/test/fixtures/routine-context.ts", "packages/messaging/test/fixtures/memory-crash-writer.ts", "apps/server/test/plugin/fixtures/invoke-child.ts"]) {
    const source = await readFile(resolve(root, file), "utf8");
    expect(source).toContain("createPrismaClient((process.env.OUTCOMEGO_TEST_DATABASE_URL ?? process.env.OPENTEAM_TEST_DATABASE_URL))");
  }
});
