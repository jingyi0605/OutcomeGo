import type { DecisionResolution, DecisionView, OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import type { HumanWorkItemDetail } from "@outcomego/contracts/human-work";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";

export const fixtureIds = {
  outcome: "10000000-0000-4000-8000-000000000001",
  decision: "20000000-0000-4000-8000-000000000001",
  revision: "30000000-0000-4000-8000-000000000001",
  human: "40000000-0000-4000-8000-000000000001",
  criterion: "50000000-0000-4000-8000-000000000001",
  bot: "60000000-0000-4000-8000-000000000001",
  channel: "70000000-0000-4000-8000-000000000001",
};
export const decisionFixture: DecisionView = {
  id: fixtureIds.decision, outcomeId: fixtureIds.outcome, contractRevisionId: fixtureIds.revision, contractRevision: 1,
  runId: null, workItemId: null, status: "open", reasonCode: "new_server_reason",
  completedSummary: "Compared the fixture records.", problemSummary: "", nextStepSummary: "Choose a supported source.",
  recommendation: { optionId: "source-a", reason: "The source can be independently verified." },
  options: [{ id: "source-a", label: "Use source A", consequence: "Continue with the existing scope.", resolutionEffect: "plan_only", source: "runtime" }],
  customEntryAllowed: true, expiresAt: null, resolvedOption: null, customText: null, resolvedBy: null,
  resolvedAt: null, truncatedOptionCount: 0, createdAt: "2026-11-17T00:00:00.000Z",
};
export const decisionResolutionFixture: DecisionResolution = {
  decisionId: fixtureIds.decision, outcomeId: fixtureIds.outcome, contractRevision: 1, status: "resolved",
  resolutionEffect: "plan_only", resume: { status: "enqueued", workItemIds: [] },
};
export const inboxFixture: OutcomeInboxItemView = {
  id: `decision_pending:${fixtureIds.decision}`, outcomeId: fixtureIds.outcome, decisionId: fixtureIds.decision,
  contractRevision: 1, category: "decision_pending", priority: 3, title: "Inspect fixture equipment",
  completed: "Read the procedure.", problem: "", next: "Choose a source.", requiresAction: true,
  availableAt: "2026-11-17T00:00:00.000Z", createdAt: "2026-11-17T00:00:00.000Z", read: false,
};
export const humanFixture: HumanWorkItemDetail = {
  id: fixtureIds.human, outcomeId: fixtureIds.outcome, executorType: "human", kind: "human_action", status: "paused",
  title: "Record a fixture inspection", contractRevision: 1, evidenceCount: 0, startedAt: "2026-11-17T00:00:00.000Z",
  card: {
    id: fixtureIds.human, workItemId: fixtureIds.human, outcomeId: fixtureIds.outcome, contractRevision: 1,
    title: "Record a fixture inspection", purpose: "Record actual observations before acceptance.",
    prerequisites: [{ label: "Read the safety procedure.", completed: false }],
    steps: [{ id: "step-1", ordinal: 1, text: "Inspect the fixture label.", optional: false }],
    inputFields: [{ id: "label", label: "Equipment label", type: "text", required: true }],
    evidenceRequirements: [{ criterionId: fixtureIds.criterion, label: "Attach the fixture inspection record.", acceptedTypes: ["asset"], required: true }],
    references: [{ id: "ref-1", title: "Fixture procedure", sourceType: "file", sourceRef: "fixture:procedure", version: "v1", updatedAt: "2026-11-17T00:00:00.000Z", projectScope: `bot:${fixtureIds.bot}`, stale: false, permissionSummary: "This fixture only.", digest: "test-digest", excerpt: "Only this short excerpt is shown." }],
    status: "paused", draft: { currentStepId: "step-1", draftSummary: "Observed the label; photos pending.", readReferenceIds: ["ref-1"], reason: "Waiting for a camera." },
    startedBy: "owner:local", startedAt: "2026-11-17T00:00:00.000Z", submittedAt: null, acceptedAt: null,
  },
  receipts: [],
};
export const exploreFixture: Extract<OutcomeDetail, { kind: "explore_idea" }> = {
  id: "80000000-0000-4000-8000-000000000001", kind: "explore_idea", botId: fixtureIds.bot, title: "Explore fixture inspection improvements",
  description: "An idea for a later, separately approved task.", status: "draft", parentOutcomeId: fixtureIds.outcome,
  sourceRef: [{ sourceRef: "fixture:procedure", title: "Procedure", sourceType: "fixture", version: "v1" }],
  kindMeta: { budget: { timeLimitMinutes: 20, costLimit: null } }, revision: 1, currentRevision: null,
  attachments: [], tags: [], urgency: "normal", executor: "bot", dueAt: null, scheduledAt: null, followUpAt: null, snoozeUntil: null,
  resumeStatus: null, prepareAt: null, prepareInstruction: null, dedupeKey: null, createdBy: "owner:local",
  createdAt: "2026-11-17T00:00:00.000Z", updatedAt: "2026-11-17T00:00:00.000Z", acceptedAt: null, cancelledAt: null,
  autoClosedAt: null, closeSummary: null, currentRevisionView: null, revisions: [], workItems: [], outputs: [], evidence: [], reviews: [],
};
