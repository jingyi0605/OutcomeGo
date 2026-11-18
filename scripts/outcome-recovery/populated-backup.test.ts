import { expect, test } from "bun:test";
import { backupOptions, canonicalJson, compareSnapshots, sha256, type DatabaseSnapshot } from "../../apps/server/test/fixtures/outcome-recovery/populated-backup";

const args = ["--container", "owned-test-pg", "--restore-database", "restored", "--output", "/tmp/owned-test-report"];
test("requires an explicit local canonical test URL and a distinct new restore database", () => {
  expect(() => backupOptions(args, { DATABASE_URL: "postgresql://fixture@127.0.0.1/source" })).toThrow("test_database_url_required");
  expect(() => backupOptions(args, { OUTCOMEGO_TEST_DATABASE_URL: "postgresql://fixture@database.example/source" })).toThrow("expected_explicit_local_test_postgres");
  expect(() => backupOptions(args, { OUTCOMEGO_TEST_DATABASE_URL: "postgresql://fixture@127.0.0.1/restored" })).toThrow("explicit_distinct_backup_databases_required");
  for (const port of [5432, 55437, 55439]) {
    const options = backupOptions(args, { OUTCOMEGO_TEST_DATABASE_URL: `postgresql://fixture@127.0.0.1:${port}/source` });
    expect(options.restored.pathname).toBe("/restored");
    expect(options.restored.port).toBe(String(port));
  }
});

test("full-row comparison detects content and identity changes even when counts are identical", () => {
  const snapshot = (value: string, id = "same"): DatabaseSnapshot => ({
    tables: { example: { count: 1, sha256: sha256(value), identities: [{ id }] } },
    foreignKeys: [], schemaMarker: null, portableDataSha256: "",
  });
  expect(compareSnapshots(snapshot("original"), snapshot("changed"))).toEqual(["example"]);
  expect(compareSnapshots(snapshot("original"), snapshot("original", "rebound"))).toEqual(["example"]);
  expect(compareSnapshots(snapshot("original"), snapshot("original"))).toEqual([]);
  expect(canonicalJson({ second: 2, first: { b: 2, a: 1 } })).toBe(canonicalJson({ first: { a: 1, b: 2 }, second: 2 }));
});
