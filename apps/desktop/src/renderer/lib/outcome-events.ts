import type { ProductEvent } from "@outcomego/contracts";

const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** One state change often appends several Outcome events; they collapse into a single reload. */
export const OUTCOME_REFRESH_DEBOUNCE_MS = 300;

export const subscribeOutcomeRefresh = (outcomeId: string, listener: () => void) => {
  let set = listeners.get(outcomeId);
  if (!set) {
    set = new Set();
    listeners.set(outcomeId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(outcomeId);
  };
};

const notify = (outcomeId: string) => {
  const set = listeners.get(outcomeId);
  if (set) for (const listener of set) listener();
};

const notifySoon = (outcomeId: string) => {
  if (pending.has(outcomeId)) return;
  pending.set(
    outcomeId,
    setTimeout(() => {
      pending.delete(outcomeId);
      notify(outcomeId);
    }, OUTCOME_REFRESH_DEBOUNCE_MS)
  );
};

export const refreshOutcomeViews = (event?: ProductEvent) => {
  if (!event) {
    for (const id of [...listeners.keys()]) notify(id);
    return;
  }
  if (event.topic === "snapshot.required") {
    for (const id of [...listeners.keys()]) notify(id);
    return;
  }
  // Progress reports arrive with this dedicated, already-lightweight signal.
  if (event.topic === "goal.progress.updated") {
    if (event.entityId) notify(event.entityId);
    else for (const id of [...listeners.keys()]) notify(id);
    return;
  }
  // Status, work item, contract, decision and output changes (the prerequisite and task rows derive from them).
  // `outcome.progress.updated` is skipped because the same report also emits goal.progress.updated.
  if (
    event.entityId &&
    event.topic.startsWith("outcome.") &&
    event.topic !== "outcome.progress.updated" &&
    listeners.has(event.entityId)
  ) {
    notifySoon(event.entityId);
  }
};
