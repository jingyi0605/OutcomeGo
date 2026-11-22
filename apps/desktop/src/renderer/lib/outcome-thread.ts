import type { ProductEvent } from "@outcomego/contracts";
import type { OutcomeThreadTurnStatus, OutcomeThreadView } from "@outcomego/contracts/outcome-thread";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OutcomeClient } from "../client/outcome-api";

/**
 * A goal's own Agent thread: the owner's words and the bot's answers. The server does the work in the
 * bot's turn and saves the result, so the window can close, or the app quit, and it is all still there.
 */
export const OUTCOME_THREAD_TOPIC = "goal.thread.updated";
const POLL_WHILE_WORKING_MS = 4_000;

export interface OutcomeThreadEvent {
  outcomeId: string;
  title: string;
  status: OutcomeThreadTurnStatus;
}

const listeners = new Set<(event: OutcomeThreadEvent) => void>();

/** Called for every server event; forwards the goal-thread ones to whoever is listening. */
export const handleOutcomeThreadEvent = (event: ProductEvent) => {
  if (event.topic !== OUTCOME_THREAD_TOPIC) return;
  const payload = (event.payload ?? {}) as Partial<OutcomeThreadEvent>;
  const outcomeId = payload.outcomeId ?? event.entityId;
  if (!outcomeId || !payload.status) return;
  for (const listener of listeners) listener({ outcomeId, title: payload.title ?? "", status: payload.status });
};

export const subscribeOutcomeThreadEvents = (listener: (event: OutcomeThreadEvent) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const working = (view: OutcomeThreadView | null) =>
  Boolean(
    view?.turns.some((turn) => turn.status === "queued" || turn.status === "running") ||
      view?.reviewTurns?.some((turn) => turn.status === "queued" || turn.status === "running")
  );

/** The goal's thread, kept fresh from events and, while the bot is working, a slow poll. */
export function useOutcomeThread(outcomeId: string, client: OutcomeClient) {
  const [view, setView] = useState<OutcomeThreadView | null>(null);
  const generation = useRef(0);
  const reload = useCallback(() => {
    const read = client.thread;
    if (!read) return;
    const request = ++generation.current;
    void read.call(client, outcomeId).then(
      (value) => {
        if (generation.current === request) setView(value);
      },
      () => {
        /* Keep what is shown; the next event or poll tries again. */
      }
    );
  }, [client, outcomeId]);
  useEffect(() => {
    setView(null);
    reload();
    return subscribeOutcomeThreadEvents((event) => {
      if (event.outcomeId === outcomeId) reload();
    });
  }, [outcomeId, reload]);
  const busy = working(view);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(reload, POLL_WHILE_WORKING_MS);
    return () => clearInterval(timer);
  }, [busy, reload]);
  return { view, reload, working: busy };
}
