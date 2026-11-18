import { backupOptions, runPopulatedBackup } from "../apps/server/test/fixtures/outcome-recovery/populated-backup";

if (import.meta.main) {
  try {
    const report = await runPopulatedBackup(backupOptions(process.argv.slice(2), process.env));
    console.log(JSON.stringify({ status: report.status, checks: report.checks, fixtureIds: report.fixtureIds,
      dumpSha256: report.dump.sha256, physicalTables: Object.keys(report.before.tables).length,
      foreignKeys: report.before.foreignKeys.length }, null, 2));
    if (report.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "populated_backup_failed");
    process.exitCode = 1;
  }
}
