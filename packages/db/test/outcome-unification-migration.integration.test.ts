import { expect, test } from "bun:test";

const migration = await Bun.file(
  new URL("../prisma/migrations/202611260001_unify_outcome_model/migration.sql", import.meta.url),
).text();
const schema = await Bun.file(new URL("../prisma/schema.prisma", import.meta.url)).text();

test("the unified schema removes legacy models and keeps one Outcome table", () => {
  for (const legacyModel of ["OwnerTodoItem", "ExploreIdea", "OutcomePlanningDraft", "OutcomeTrackingMode"]) {
    expect(schema).not.toContain(`model ${legacyModel}`);
    expect(schema).not.toContain(`enum ${legacyModel}`);
  }
  expect(schema).toContain("model OutcomeAutoAcceptRule");
  expect(schema).toContain('@@map("outcomego_outcome")');
});

test("the unification migration converts legacy rows before retiring their tables", () => {
  const ownerTodoInsert = migration.indexOf('FROM "outcomego_owner_todo_item"');
  const exploreInsert = migration.indexOf('FROM "outcomego_explore_idea"');
  const ownerTodoDrop = migration.indexOf('DROP TABLE "outcomego_owner_todo_item"');
  const exploreDrop = migration.indexOf('DROP TABLE "outcomego_explore_idea"');

  expect(ownerTodoInsert).toBeGreaterThanOrEqual(0);
  expect(exploreInsert).toBeGreaterThanOrEqual(0);
  expect(ownerTodoDrop).toBeGreaterThan(ownerTodoInsert);
  expect(exploreDrop).toBeGreaterThan(exploreInsert);
  expect(migration).toContain("WHEN 'done' THEN 'accepted'");
  expect(migration).toContain("WHEN 'dismissed' THEN 'cancelled'");
  expect(migration).toContain("planningDraft");
  expect(migration).toContain('DROP COLUMN "trackingMode", DROP COLUMN "sourceExploreId"');
});
