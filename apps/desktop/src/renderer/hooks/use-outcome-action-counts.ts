import { useEffect, useState } from "react";
import { OUTCOME_LIMITS, type OutcomeStatus } from "@outcomego/contracts/outcomes";
import { api } from "../client/outcomego-api";
import { subscribeOutcomeListRefresh } from "../lib/outcome-events";

/** Goals that wait on the owner: something to approve, decide or do, and a result to accept. */
export interface OutcomeActionCounts {
  approval: number;
  review: number;
}
const NONE: OutcomeActionCounts = { approval: 0, review: 0 };
const REFRESH_INTERVAL_MS = 60_000;

/** Everything that waits on the owner to approve, decide or act, as opposed to accepting a finished result. */
const APPROVAL_STATUSES: readonly OutcomeStatus[] = ["pending_approval", "decision_pending", "human_action_pending"];
const REVIEW_STATUSES: readonly OutcomeStatus[] = ["review_pending"];

/** Counts one page at most; callers cap the display at "99+" instead of paging for an exact total. */
async function countStatuses(statuses: readonly OutcomeStatus[]) {
  const query = new URLSearchParams({ status: statuses.join(","), limit: String(OUTCOME_LIMITS.listPageSizeMax) });
  const page = await api.outcomes.list(query.toString());
  return page.items.length;
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
      Promise.all([countStatuses(APPROVAL_STATUSES), countStatuses(REVIEW_STATUSES)])
        .then(([approval, review]) => {
          if (request !== generation) return;
          setCounts((current) =>
            current.approval === approval && current.review === review ? current : { approval, review }
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
