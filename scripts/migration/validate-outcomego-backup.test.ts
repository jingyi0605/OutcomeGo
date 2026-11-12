import { describe, expect, test } from "bun:test";
import {
  createOutcomegoBackup,
  validateOutcomegoBackup,
} from "./validate-outcomego-backup";

describe("OutcomeGo latest-schema backup validation", () => {
  test("accepts a backup that already uses the current physical schema", () => {
    const backup = createOutcomegoBackup({
      outcomego_bot: [{ id: "bot-1", name: "OutcomeGo" }],
      outcomego_channel: [{ id: "channel-1", botId: "bot-1", name: "Launch" }],
    });

    const result = validateOutcomegoBackup(JSON.stringify(backup));

    expect(result.backup).toEqual(backup);
    expect(result.rowCounts).toEqual({
      outcomego_bot: 1,
      outcomego_channel: 1,
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
      outcomego_channel: [{ id: "channel-1", botId: "missing" }],
    });

    expect(() => validateOutcomegoBackup(JSON.stringify(backup))).toThrow(
      "outcomego_channel.botId references missing outcomego_bot id missing"
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
});
