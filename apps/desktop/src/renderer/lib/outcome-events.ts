import type { ProductEvent } from "@outcomego/contracts";

const listeners = new Map<string, Set<() => void>>();

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

export const refreshOutcomeViews = (event?: ProductEvent) => {
  if (event && event.topic !== "goal.progress.updated" && event.topic !== "snapshot.required") return;
  const targetId = event?.topic === "goal.progress.updated" ? event.entityId : null;
  if (targetId) {
    const set = listeners.get(targetId);
    if (set) for (const listener of set) listener();
    return;
  }
  for (const set of listeners.values()) {
    for (const listener of set) listener();
  }
};
