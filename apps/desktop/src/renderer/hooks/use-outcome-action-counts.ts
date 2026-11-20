import { useEffect, useState } from "react";
import { OUTCOME_LIMITS, type OutcomeStatus } from "@outcomego/contracts/outcome-view";
import { api } from "../client/outcomego-api";
import { subscribeOutcomeListRefresh } from "../lib/outcome-events";
import { countByBot, sameCounts } from "../lib/outcome-counts";

/** Goals that wait on the owner: something to approve, decide or do, and a result to accept. */
export interface OutcomeActionCounts {
  approval: number;
  review: number;
  /** Goals waiting on the owner (the `approval` kinds), per Bot: the floating window's yellow badge. */
  approvalByBot?: Readonly<Record<string, number>>;
}
const NONE: OutcomeActionCounts = { approval: 0, review: 0 };
const REFRESH_INTERVAL_MS = 60_000;

/** Everything that waits on the owner to approve, decide or act, as opposed to accepting a finished result. */
const APPROVAL_STATUSES: readonly OutcomeStatus[] = [
  "pending_approval",
  "decision_pending",
  "human_action_pending",
];
const REVIEW_STATUSES: readonly OutcomeStatus[] = ["review_pending"];

/** Reads one page at most; callers cap the display at "99+" instead of paging for an exact total. */
async function listStatuses(statuses: readonly OutcomeStatus[]) {
  const query = new URLSearchParams({
    status: statuses.join(","),
    limit: String(OUTCOME_LIMITS.listPageSizeMax),
  });
  return (await api.outcomes.list(query.toString())).items;
}

export function useOutcomeActionCounts(enabled: boolean): OutcomeActionCounts {
  const [counts, setCounts] = useState<OutcomeActionCounts>(NONE);
  useEffect(() => {
    if (!enabled) {
      setCounts(NONE);
      return;
    }
    let generation = 0;
    const load = () => {
      const request = ++generation;
      Promise.all([listStatuses(APPROVAL_STATUSES), listStatuses(REVIEW_STATUSES)])
        .then(([approvalItems, reviewItems]) => {
          if (request !== generation) return;
          const approval = approvalItems.length;
          const review = reviewItems.length;
          const approvalByBot = countByBot(approvalItems);
          setCounts((current) =>
            current.approval === approval &&
            current.review === review &&
            sameCounts(current.approvalByBot, approvalByBot)
              ? current
              : { approval, review, approvalByBot }
          );
        })
        .catch(() => {
          /* Keep the last known counts; the next refresh retries. */
        });
    };
    const refreshVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const unsubscribe = subscribeOutcomeListRefresh(load);
    const interval = window.setInterval(refreshVisible, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshVisible);
    return () => {
      generation++;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [enabled]);
  return counts;
}
