import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { AssetRef } from "../src/asset-ref";
import {
  ActOnOutcomeInput,
  ConvertOutcomeInput,
  CreateOutcomeAutoAcceptRuleInput,
  CreateOutcomeInput,
  OUTCOME_KINDS,
  OUTCOME_KIND_META_SCHEMAS,
  OUTCOME_STATUSES,
  OUTCOME_STATUSES_BY_KIND,
  OutcomeIntakeInput,
  OutcomeSummarySchema,
  UpdateOutcomeAutoAcceptRuleInput,
  UpdateOutcomeInput,
  isOutcomeStatusForKind,
  outcomeKindRequiresBot,
  parseListOutcomesQuery,
  type OutcomeDetail,
} from "../src/outcomes";

const ID = "22222222-2222-4222-8222-222222222222";
const BOT = "11111111-1111-4111-8111-111111111111";
const WHEN = "2030-12-12T10:00:00+08:00";
const EARLIER = "2030-12-12T01:00:00Z";
const request = { clientRequestId: "unified:case-1" };
const asset = { assetId: "0".repeat(64), fileName: "image.png", mimeType: "image/png", byteSize: 500, kind: "image" };

describe("unified Outcome view", () => {
  const summary = (kind: (typeof OUTCOME_KINDS)[number]) => ({
    id: ID, kind, status: OUTCOME_STATUSES_BY_KIND[kind][0], kindMeta: {}, title: "An outcome",
    revision: 1, currentRevision: null, updatedAt: WHEN, parentOutcomeId: null,
    attachments: [asset], tags: ["work"], urgency: "normal", executor: "owner",
    botId: outcomeKindRequiresBot(kind) ? BOT : null,
    scheduledAt: kind === "scheduled_once" ? WHEN : null, dueAt: null, followUpAt: null, snoozeUntil: null,
  });

  test("decodes exactly the legal status subset for every kind", () => {
    for (const kind of OUTCOME_KINDS) {
      const row = summary(kind);
      expect(Schema.decodeUnknownSync(OutcomeSummarySchema)(row)).toMatchObject(row);
      for (const status of OUTCOME_STATUSES) {
        const allowed = (OUTCOME_STATUSES_BY_KIND[kind] as readonly string[]).includes(status);
        expect(isOutcomeStatusForKind(kind, status)).toBe(allowed);
        expect(Schema.is(OutcomeSummarySchema)({ ...row, status })).toBe(allowed);
      }
      expect(Schema.is(OutcomeSummarySchema)({ ...row, botId: null })).toBe(!outcomeKindRequiresBot(kind));
    }
    expect(Schema.is(OutcomeSummarySchema)({ ...summary("scheduled_once"), scheduledAt: null })).toBe(false);
  });

  test("validates metadata according to the discriminator and rejects unknown nested fields", () => {
    const noteMeta = { createdVia: "owner_go_inbox", syncToMemory: true, triageStatus: "pending" };
    const note = Schema.decodeUnknownSync(OutcomeSummarySchema)({ ...summary("note"), kindMeta: noteMeta });
    if (note.kind !== "note") throw new Error("Expected note");
    expect(note.kindMeta.triageStatus).toBe("pending");
    expect(Schema.is(OutcomeSummarySchema)({ ...summary("todo"), kindMeta: noteMeta })).toBe(false);
    expect(Schema.is(OUTCOME_KIND_META_SCHEMAS.explore_idea)({ budget: { timeLimitMinutes: 35, costLimit: null } })).toBe(true);
    expect(() => Schema.decodeUnknownSync(OUTCOME_KIND_META_SCHEMAS.explore_idea)({
      budget: { timeLimitMinutes: 35, costLimit: null, extra: true },
    })).toThrow();
    expect(Schema.is(OUTCOME_KIND_META_SCHEMAS.note)({ memorySummary: "x".repeat(501) })).toBe(false);
    expect(Schema.is(OUTCOME_KIND_META_SCHEMAS.scheduled_once)({ deliveredAt: WHEN, lastRunId: ID })).toBe(true);
  });

  test("detail retains standard contract data and includes unified fields", () => {
    const row = Schema.decodeUnknownSync(OutcomeSummarySchema)(summary("note"));
    const detail: OutcomeDetail = {
      ...row, description: "# Research", sourceRef: [{ kind: "file", id: "meeting.md" }],
      resumeStatus: null, prepareAt: null, prepareInstruction: null, dedupeKey: null,
      createdBy: "owner:local", createdAt: WHEN, acceptedAt: null, cancelledAt: null,
      autoClosedAt: null, closeSummary: null, currentRevisionView: null, revisions: [],
      workItems: [], outputs: [], evidence: [], reviews: [], latestAdvice: null,
    };
    expect(detail).toMatchObject({ kind: "note", description: "# Research", attachments: [asset], workItems: [] });
  });
});

describe("unified Outcome request inputs", () => {
  const create = Schema.decodeUnknownSync(CreateOutcomeInput);
  const intake = Schema.decodeUnknownSync(OutcomeIntakeInput);
  const update = Schema.decodeUnknownSync(UpdateOutcomeInput);
  const convert = Schema.decodeUnknownSync(ConvertOutcomeInput);
  const act = Schema.decodeUnknownSync(ActOnOutcomeInput);

  test("creates all six kinds while checking assignment and schedule requirements", () => {
    for (const kind of OUTCOME_KINDS) {
      const fields = { ...request, kind, title: "  Title  ", description: "Check the report" };
      const schedule = kind === "scheduled_once" ? { scheduledAt: WHEN, prepareAt: EARLIER } : {};
      if (outcomeKindRequiresBot(kind)) expect(() => create({ ...fields, ...schedule })).toThrow();
      expect(create({ ...fields, ...schedule, botId: outcomeKindRequiresBot(kind) ? BOT : null }).title).toBe("Title");
    }
    const scheduled = { ...request, kind: "scheduled_once", title: "Deliver", botId: BOT, description: "Check the report" };
    expect(() => create(scheduled)).toThrow();
    expect(() => create({ ...scheduled, scheduledAt: WHEN, prepareAt: WHEN })).toThrow();
    expect(() => create({ ...scheduled, scheduledAt: WHEN, description: " " })).toThrow();
    expect(() => create({ ...request, kind: "todo", title: "Todo", kindMeta: { authorizedByMessageId: ID } })).toThrow();
  });

  test("accepts text-only and asset-only intake and rejects empty or spoofed attachments", () => {
    expect(intake({ ...request, text: "# Note\n" }).text).toBe("# Note\n");
    expect(intake({ ...request, attachments: [asset], botId: BOT }).attachments).toEqual([Schema.decodeUnknownSync(AssetRef)(asset)]);
    expect(() => intake({ ...request, text: "  ", attachments: [] })).toThrow();
    expect(() => intake({ ...request, text: "Note", attachments: [{ ...asset, assetId: "https://example.com/image.png" }] })).toThrow();
    expect(() => intake({ ...request, text: "Note", status: "open" })).toThrow();
  });

  test("updates with a revision and preserves explicit null and false edits; converts with inherited fields", () => {
    expect(update({ ...request, expectedRevision: 2, scheduledAt: null, syncToMemory: false })).toEqual({
      ...request, expectedRevision: 2, scheduledAt: null, syncToMemory: false,
    });
    expect(() => update({ ...request, expectedRevision: 2 })).toThrow();
    expect(() => update({ ...request, expectedRevision: 2, title: "Test", status: "accepted" })).toThrow();
    expect(() => update({ ...request, expectedRevision: 2, dueAt: "2030-02-30T10:00:00Z" })).toThrow();
    expect(convert({ ...request, expectedRevision: 3, targetKind: "standard" }).targetKind).toBe("standard");
    expect(() => convert({ ...request, kind: "standard", expectedRevision: 3 })).toThrow();
  });

  test("accepts appropriate lifecycle payloads and rejects mismatched or invented actions", () => {
    expect(act({ ...request, action: "archive" }).action).toBe("archive");
    expect(act({ ...request, action: "snooze", payload: { snoozeUntil: WHEN }, expectedRevision: 2 }).action).toBe("snooze");
    expect(act({ ...request, action: "handoff_to_bot", payload: { botId: BOT } }).action).toBe("handoff_to_bot");
    expect(() => act({ ...request, action: "snooze" })).toThrow();
    expect(() => act({ ...request, action: "complete", payload: { snoozeUntil: WHEN } })).toThrow();
    expect(() => act({ ...request, action: "approve" })).toThrow();
  });

  test("lists by repeated or comma-separated kind/status plus view, tag, time and archive filters", () => {
    const params = new URLSearchParams([
      ["kinds", "todo,scheduled_once"], ["kinds", "note,todo"], ["statuses", "open,scheduled,archived"],
      ["view", "needs_me"], ["botId", BOT], ["tag", "reports"], ["query", "  budget  "], ["includeArchived", "true"],
      ["from", EARLIER], ["to", WHEN],
    ]);
    expect(parseListOutcomesQuery(params)).toMatchObject({
      kinds: ["todo", "scheduled_once", "note"], statuses: ["open", "scheduled", "archived"],
      view: "needs_me", botId: BOT, tag: "reports", query: "budget", includeArchived: true, from: EARLIER, to: WHEN,
    });
    const invalidQueries: Record<string, string>[] = [
      { kinds: "routine" }, { view: "wrong" }, { from: WHEN, to: EARLIER }, { includeArchived: "yes" }, { trackingMode: "tracked" },
    ];
    for (const invalid of invalidQueries) {
      expect(() => parseListOutcomesQuery(new URLSearchParams(invalid))).toThrow();
    }
  });

  test("auto-accept rules must bind a bot or routine and updates cannot empty both bindings", () => {
    const createRule = Schema.decodeUnknownSync(CreateOutcomeAutoAcceptRuleInput);
    const updateRule = Schema.decodeUnknownSync(UpdateOutcomeAutoAcceptRuleInput);
    expect(createRule({ name: "  Meetings  ", routineId: ID, sourceKind: "meeting" })).toMatchObject({ name: "Meetings", routineId: ID });
    expect(createRule({ name: "Bot requests", botId: BOT }).botId).toBe(BOT);
    expect(() => createRule({ name: "Unbound", sourceKind: "meeting" })).toThrow();
    expect(updateRule({ botId: null, enabled: false })).toEqual({ botId: null, enabled: false });
    expect(() => updateRule({})).toThrow();
    expect(() => updateRule({ botId: null, routineId: null })).toThrow();
  });
});
