import type { OutcomeStatus } from "@outcomego/contracts/outcome-view";
import type { OutcomeSummary } from "@outcomego/contracts/outcomes";
import type { DecisionView, OutcomeInboxCategory, OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import { CREDENTIAL_ACCESS_REASON_CODE } from "@outcomego/contracts/outcome-inbox-categories";
import { canResolveDecision, isApprovalDecision } from "../inbox/decision-state";

/** The owner's turn: something to approve, decide, do or accept. */
export const OWNER_OUTCOME_STATUSES: readonly OutcomeStatus[] = [
  "pending_approval",
  "decision_pending",
  "human_action_pending",
  "review_pending",
];
/** A Bot's turn: it is planning or executing without needing the owner. */
export const BOT_OUTCOME_STATUSES: readonly OutcomeStatus[] = ["planning", "approved", "running"];
/** Nobody is moving these forward until the owner looks. */
export const STUCK_OUTCOME_STATUSES: readonly OutcomeStatus[] = ["paused", "failed"];

/** Goals that are alive: planned or started, and neither accepted, stopped nor still a bare draft. */
export const ACTIVE_OUTCOME_STATUSES: readonly OutcomeStatus[] = [
  ...BOT_OUTCOME_STATUSES,
  ...OWNER_OUTCOME_STATUSES,
  "paused",
];

/** Rows shown per dashboard section; the full lists stay one click away. */
export const DASHBOARD_ROW_LIMIT = 5;

export interface DashboardStats {
  active: number;
  accepted: number;
  total: number;
}

const activeSet = new Set<OutcomeStatus>(ACTIVE_OUTCOME_STATUSES);

export const isActiveOutcome = (outcome: Pick<OutcomeSummary, "status">) =>
  activeSet.has(outcome.status);

export function summarizeOutcomes(items: readonly OutcomeSummary[]): DashboardStats {
  return {
    active: items.filter(isActiveOutcome).length,
    accepted: items.filter((item) => item.status === "accepted").length,
    total: items.length,
  };
}

const byRecent = (a: OutcomeSummary, b: OutcomeSummary) =>
  Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/** Most recently touched live goals first, so what moved last is what the owner sees first. */
export function activeOutcomes(
  items: readonly OutcomeSummary[],
  limit = DASHBOARD_ROW_LIMIT
): OutcomeSummary[] {
  return items.filter(isActiveOutcome).sort(byRecent).slice(0, limit);
}

/** One row on the owner's list: a pending Inbox step, or a goal that waits on the owner without one. */
export interface AttentionRow {
  key: string;
  outcomeId: string;
  title: string;
  category: OutcomeInboxCategory;
  /** When the owner's turn began; drives the waiting time. */
  since: string;
  completed: string;
  problem: string;
  next: string;
  /** Absent when an older server has no Inbox entry for the goal; the row then opens the goal itself. */
  step?: OutcomeInboxItemView;
}

const categoryForStatus: Partial<Record<OutcomeStatus, OutcomeInboxCategory>> = {
  pending_approval: "decision_pending",
  decision_pending: "decision_pending",
  human_action_pending: "human_action_pending",
  review_pending: "acceptance_pending",
};

/**
 * Pending Inbox steps first (the server already orders them by urgency), then goals that wait on the owner
 * but have no step, oldest first. Together they are everything that needs the owner, once each.
 */
export function attentionRows(
  steps: readonly OutcomeInboxItemView[],
  outcomes: readonly OutcomeSummary[]
): AttentionRow[] {
  const covered = new Set(steps.map((step) => step.outcomeId));
  const rows: AttentionRow[] = steps.map((step) => ({
    key: step.id,
    outcomeId: step.outcomeId,
    title: step.title,
    category: step.category,
    since: step.availableAt,
    completed: step.completed,
    problem: step.problem,
    next: step.next,
    step,
  }));
  const orphans = outcomes
    .filter((outcome) =>
      !covered.has(outcome.id) &&
      !(outcome.status === "review_pending" && outcome.prereviewStatus === "pending") &&
      categoryForStatus[outcome.status]
    )
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  for (const outcome of orphans)
    rows.push({
      key: `goal:${outcome.id}`,
      outcomeId: outcome.id,
      title: outcome.title,
      category: categoryForStatus[outcome.status]!,
      since: outcome.updatedAt,
      completed: "",
      problem: "",
      next: "",
    });
  return rows;
}

/** A goal appears once on the page: goals already on the owner's list never repeat in the Bot lanes. */
export function laneOutcomes(
  items: readonly OutcomeSummary[],
  statuses: readonly OutcomeStatus[],
  attention: readonly AttentionRow[],
  limit = DASHBOARD_ROW_LIMIT
): { rows: OutcomeSummary[]; total: number } {
  const listed = new Set(attention.map((row) => row.outcomeId));
  const all = items
    .filter((item) => statuses.includes(item.status) && !listed.has(item.id))
    .sort(byRecent);
  return { rows: all.slice(0, limit), total: all.length };
}

/** Waiting longer than a day is worth a colored hint. */
export const STALE_AFTER_MINUTES = 24 * 60;

export type WaitingLabel =
  | { key: "Just arrived" }
  | { key: "{count}m" | "{count}h" | "{count}d"; count: number };

export function waitingMinutes(since: string, now = Date.now()) {
  const start = Date.parse(since);
  return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 60_000)) : 0;
}

export function waitingLabel(minutes: number): WaitingLabel {
  if (minutes < 1) return { key: "Just arrived" };
  if (minutes < 60) return { key: "{count}m", count: minutes };
  if (minutes < 24 * 60) return { key: "{count}h", count: Math.floor(minutes / 60) };
  return { key: "{count}d", count: Math.floor(minutes / (24 * 60)) };
}

/** The verb on the action button: say what the owner will do, not just "handle". */
export const attentionVerbs: Record<OutcomeInboxCategory, string> = {
  decision_pending: "Make a decision",
  acceptance_pending: "Review result",
  human_action_pending: "Take action",
  completed: "View details",
};

/** Singular names for the category tag; `inboxCategoryLabels` is plural for filter chips. */
export const attentionCategoryLabels: Record<OutcomeInboxCategory, string> = {
  decision_pending: "Decision",
  acceptance_pending: "Acceptance review",
  human_action_pending: "Human action",
  completed: "Completed",
};

/**
 * Whether a decision can be answered from the dashboard without reading it in full.
 *
 * - `approval`: a yes/no pair, one click each.
 * - `choice`: two to four options, pick one and confirm.
 * - `none`: open the full card. Credential grants hand over saved logins, and an option that carries a
 *   revised Contract changes what "done" means, so neither is ever answered blind.
 */
export function quickDecisionMode(
  decision: DecisionView | null
): "approval" | "choice" | "none" {
  if (!decision || !canResolveDecision(decision)) return "none";
  if (decision.reasonCode === CREDENTIAL_ACCESS_REASON_CODE) return "none";
  const { options } = decision;
  if (options.length === 0 || options.length > 4 || decision.truncatedOptionCount > 0) return "none";
  if (options.some((option) => option.contract || (option.credentialGrant?.length ?? 0) > 0))
    return "none";
  return isApprovalDecision(decision) ? "approval" : "choice";
}

export const recommendedOptionId = (decision: DecisionView): string | undefined =>
  decision.options.find((option) => option.id === decision.recommendation?.optionId)?.id ??
  decision.options.find((option) => option.recommended)?.id;

/** Counts above this render as "99+": the dashboard reads one page and never pages for an exact total. */
export const formatCount = (count: number) => (count > 99 ? "99+" : String(count));

/** The most a description may say on the dashboard; the full text stays one click away in the details. */
export const BRIEF_MAX_CHARS = 30;

/**
 * Shortens server-written text to one glanceable line: the first sentence if it fits, otherwise the start of
 * it with an ellipsis. It never rewrites the text, so the full version is kept in a tooltip and the details.
 */
export function brief(text: string, max = BRIEF_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const end = flat.search(/[。；;！？!?]|\.(?:\s|$)/);
  const first = end >= 0 ? flat.slice(0, end) : flat;
  const chars = [...first];
  return chars.length <= max ? first : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}
