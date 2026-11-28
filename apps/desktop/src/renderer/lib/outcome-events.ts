import type { ProductEvent } from "@outcomego/contracts";
import { GROUP_TASK_CHANGED_TOPIC } from "@outcomego/contracts/event-protocol";
import type { OutcomeKind } from "@outcomego/contracts/outcomes";

export interface OutcomeTriageEvent {
  outcomeId: string;
  triageStatus: "completed" | "failed";
  triageSummary?: string;
  sourceKind?: OutcomeKind;
  createdChildren?: Array<{ outcomeId: string; kind: OutcomeKind; title: string }>;
  triageError?: string;
}

const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const triageListeners = new Set<(event: OutcomeTriageEvent) => void>();

/** One state change often appends several Outcome events; they collapse into a single reload. */
export const OUTCOME_REFRESH_DEBOUNCE_MS = 300;

export const subscribeOutcomeTriageEvents = (listener: (event: OutcomeTriageEvent) => void) => {
  triageListeners.add(listener);
  return () => {
    triageListeners.delete(listener);
  };
};

const notifyTriage = (event: ProductEvent) => {
  if (event.topic !== "goal.updated") return;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const status = payload.triageStatus;
  if (status !== "completed" && status !== "failed") return;
  const outcomeId = typeof payload.outcomeId === "string" ? payload.outcomeId : event.entityId;
  if (!outcomeId) return;
  const createdChildren = Array.isArray(payload.createdChildren)
    ? payload.createdChildren
        .filter((item): item is { outcomeId: string; kind: OutcomeKind; title: string } =>
          Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).outcomeId === "string")
        )
    : undefined;
  const notice: OutcomeTriageEvent = {
    outcomeId,
    triageStatus: status,
    ...(typeof payload.triageSummary === "string" ? { triageSummary: payload.triageSummary } : {}),
    ...(typeof payload.sourceKind === "string" ? { sourceKind: payload.sourceKind as OutcomeKind } : {}),
    ...(createdChildren ? { createdChildren } : {}),
    ...(typeof payload.triageError === "string" ? { triageError: payload.triageError } : {}),
  };
  for (const listener of triageListeners) listener(notice);
};

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
  else if (event.topic.startsWith("routine.") || event.topic === "goal.schedule.changed" ||
      event.topic === GROUP_TASK_CHANGED_TOPIC || event.topic === "channel.deleted") notifyList(false);
  else if (event.topic === "goal.status.changed" || event.topic === "goal.updated") {
    notifyList(false);
    if (event.entityId && listeners.has(event.entityId)) notifySoon(event.entityId);
    notifyTriage(event);
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
  // A task's schedule or the goal's due date changed (the owner's change, or a bot deferring its own task). The
  // client stream carries no `outcome.*` topics, so this goal-level signal is what refreshes the open timeline.
  if (event.topic === "goal.schedule.changed" && event.entityId && listeners.has(event.entityId)) {
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
