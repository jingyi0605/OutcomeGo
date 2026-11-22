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

const listListeners = new Set<() => void>();
let listPending: ReturnType<typeof setTimeout> | null = null;

/** Aggregate views (such as the sidebar badges) reload whenever any Outcome changes; bursts collapse into one reload. */
export const subscribeOutcomeListRefresh = (listener: () => void) => {
  listListeners.add(listener);
  return () => {
    listListeners.delete(listener);
  };
};

const notifyList = (immediate: boolean) => {
  if (immediate) {
    if (listPending) clearTimeout(listPending);
    listPending = null;
    for (const listener of listListeners) listener();
    return;
  }
  if (listPending) return;
  listPending = setTimeout(() => {
    listPending = null;
    for (const listener of listListeners) listener();
  }, OUTCOME_REFRESH_DEBOUNCE_MS);
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
  if (!event || event.topic === "snapshot.required") notifyList(true);
  else if (event.topic === "goal.status.changed") {
    notifyList(false);
    if (event.entityId && listeners.has(event.entityId)) notifySoon(event.entityId);
  }
  if (!event) {
    for (const id of [...listeners.keys()]) notify(id);
    return;
  }
  if (event.topic === "snapshot.required") {
    for (const id of [...listeners.keys()]) notify(id);
    return;
  }
  if (event.topic === "goal.thread.updated" && event.entityId && listeners.has(event.entityId)) {
    notifySoon(event.entityId);
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
