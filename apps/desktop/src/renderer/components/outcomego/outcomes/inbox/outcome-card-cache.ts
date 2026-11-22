import type { HumanWorkItemView } from "@outcomego/contracts/human-work";
import { CREDENTIAL_ACCESS_REASON_CODE } from "@outcomego/contracts/outcome-inbox-categories";
import type { DecisionView, OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import type { OutcomeResultSummary } from "@outcomego/contracts/outcomes";
import { api } from "../../../../client/outcomego-api";
import { isApprovalDecision } from "./decision-state";

export interface CachedOutcomeActions {
  items: HumanWorkItemView[];
  inbox: OutcomeInboxItemView[];
}

const MAX_CACHE_ENTRIES = 50;
const actionsCache = new Map<string, CachedOutcomeActions>();
const decisionCache = new Map<string, DecisionView>();
const resultSummaryCache = new Map<string, OutcomeResultSummary | null>();
const inflightPrefetch = new Map<string, Promise<void>>();

function setBounded<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function summaryKey(outcomeId: string, revisionId: string) {
  return `${outcomeId}:${revisionId}`;
}

export function getCachedOutcomeActions(outcomeId: string): CachedOutcomeActions | undefined {
  return actionsCache.get(outcomeId);
}

export function setCachedOutcomeActions(outcomeId: string, value: CachedOutcomeActions) {
  setBounded(actionsCache, outcomeId, value);
}

export function getCachedDecision(decisionId: string): DecisionView | undefined {
  return decisionCache.get(decisionId);
}

export function setCachedDecision(decisionId: string, value: DecisionView) {
  setBounded(decisionCache, decisionId, value);
}

export function getCachedResultSummary(
  outcomeId: string,
  revisionId: string
): OutcomeResultSummary | null | undefined {
  return resultSummaryCache.get(summaryKey(outcomeId, revisionId));
}

export function setCachedResultSummary(
  outcomeId: string,
  revisionId: string,
  value: OutcomeResultSummary | null
) {
  setBounded(resultSummaryCache, summaryKey(outcomeId, revisionId), value);
}

export function clearOutcomeCardCache() {
  actionsCache.clear();
  decisionCache.clear();
  resultSummaryCache.clear();
  inflightPrefetch.clear();
}

/**
 * Warms actions, pending decisions, and result summaries for an inline chat goal card
 * so first-time expansion opens smoothly in a single step without loading flashes.
 */
export function prefetchOutcomeCardData(
  outcomeId: string,
  options?: { force?: boolean; revision?: { id: string; revision: number } | null }
): Promise<void> {
  if (!options?.force && actionsCache.has(outcomeId)) {
    return Promise.resolve();
  }
  const existing = inflightPrefetch.get(outcomeId);
  if (existing && !options?.force) return existing;

  let task!: Promise<void>;
  task = (async () => {
    try {
      const [human, page] = await Promise.allSettled([
        api.outcomeInbox.humanItems(outcomeId),
        api.outcomeInbox.forOutcome(outcomeId),
      ]);
      const prev = actionsCache.get(outcomeId);
      const items = human.status === "fulfilled" ? human.value : (prev?.items ?? []);
      const inbox =
        page.status === "fulfilled"
          ? page.value.items.filter((item) => item.outcomeId === outcomeId)
          : (prev?.inbox ?? []);
      if (human.status === "fulfilled" || page.status === "fulfilled") {
        setCachedOutcomeActions(outcomeId, { items, inbox });
      }
      const decisionIds = [
        ...new Set(
          inbox
            .filter((item) => item.requiresAction && item.decisionId)
            .map((item) => item.decisionId!)
        ),
      ];
      const prefetchedRevisions = new Set<string>();
      await Promise.allSettled([
        ...decisionIds.map(async (decisionId) => {
          const decision = await api.outcomeInbox.decision(decisionId);
          setCachedDecision(decisionId, decision);
          if (
            !isApprovalDecision(decision) &&
            decision.workItemId &&
            decision.reasonCode !== CREDENTIAL_ACCESS_REASON_CODE &&
            api.outcomes.resultSummary
          ) {
            prefetchedRevisions.add(decision.contractRevisionId);
            const summary = await api.outcomes.resultSummary(outcomeId, decision.contractRevision);
            if (
              summary === null ||
              (summary.outcomeId === outcomeId && summary.revisionId === decision.contractRevisionId)
            ) {
              setCachedResultSummary(outcomeId, decision.contractRevisionId, summary);
            }
          }
        }),
        ...(options?.revision &&
        !prefetchedRevisions.has(options.revision.id) &&
        inbox.some((item) => item.requiresAction && item.category === "acceptance_pending") &&
        api.outcomes.resultSummary
          ? [
              (async () => {
                const rev = options.revision!;
                const summary = await api.outcomes.resultSummary!(outcomeId, rev.revision);
                if (
                  summary === null ||
                  (summary.outcomeId === outcomeId && summary.revisionId === rev.id)
                ) {
                  setCachedResultSummary(outcomeId, rev.id, summary);
                }
              })(),
            ]
          : []),
      ]);
    } catch {
      // Prefetch is best-effort; foreground components handle and display any real read errors.
    } finally {
      if (inflightPrefetch.get(outcomeId) === task) {
        inflightPrefetch.delete(outcomeId);
      }
    }
  })();

  inflightPrefetch.set(outcomeId, task);
  return task;
}
