import { useEffect, useRef, useState } from "react";
import type { ChannelMessageView } from "@outcomego/contracts";
import {
  AUTH_CREDENTIALS_CHANGED_EVENT,
  getAuthCredentialGeneration,
  getAuthSnapshot,
} from "../../client/auth";
import { API_BASE } from "../../client/http";
import { DraftReviewJournal, draftReviewState } from "../../lib/draft-review-journal";

const owner = () => {
  const auth = getAuthSnapshot();
  return JSON.stringify([API_BASE, auth.mode, auth.user?.id ?? "local"]);
};

const journals = new Map<string, { journal: DraftReviewJournal; restored: Promise<void>; users: number }>();

/** Uses the existing fsync/two-slot host journal, in a separate per-card namespace. */
export function useDraftReview(
  message: ChannelMessageView,
  refresh: () => Promise<{ message: ChannelMessageView }>,
  initialFields: Record<string, string> = {}
) {
  const [identity] = useState(() => ({ owner: owner(), generation: getAuthCredentialGeneration() }));
  const owns = () => owner() === identity.owner && getAuthCredentialGeneration() === identity.generation;
  const [shared] = useState(() => {
    const scope = `draft-review:${identity.owner}:${message.id}`;
    const key = `outcomego:${scope}`;
    const memoryKey = `${scope}:${identity.generation}`;
    const existing = journals.get(memoryKey);
    if (existing) return { ...existing, memoryKey };
    const journal = new DraftReviewJournal({
      read: async () => window.outcomego?.deliveryJournal
        ? window.outcomego.deliveryJournal.read(scope)
        : JSON.parse(localStorage.getItem(key) ?? "null"),
      write: async (record) => {
        if (window.outcomego?.deliveryJournal) await window.outcomego.deliveryJournal.write(scope, record);
        else localStorage.setItem(key, JSON.stringify(record));
      },
    }, message, initialFields);
    const entry = { journal, restored: journal.restore(), users: 0 };
    // Attach a handler immediately; the effect reports storage failures.
    entry.restored.catch(() => undefined);
    journals.set(memoryKey, entry);
    return { ...entry, memoryKey };
  });
  const { journal, memoryKey } = shared;
  const release = () => {
    const entry = journals.get(memoryKey);
    if (entry && entry.users === 0 && !journal.running) journals.delete(memoryKey);
  };
  const [, render] = useState(0);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<unknown>(null);
  const [active, setActive] = useState(true);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const reconciling = useRef<Promise<void> | null>(null);
  const publish = () => render((value) => value + 1);
  const reconcile = () => {
    if (!owns() || journal.running) return Promise.resolve();
    if (reconciling.current) return reconciling.current;
    reconciling.current = (async () => {
      const attempt = journal.attempt;
      const result = await refreshRef.current();
      if (!owns() || journal.running || journal.attempt !== attempt) return;
      await journal.acknowledge(result.message);
      setStorageError(null);
      publish();
    })().finally(() => { reconciling.current = null; });
    return reconciling.current;
  };
  useEffect(() => {
    let live = true;
    const unsubscribe = journal.subscribe(publish);
    const entry = journals.get(memoryKey);
    if (entry) entry.users++;
    void shared.restored.then(async () => {
      if (!live || !owns()) return;
      setReady(true);
      publish();
      // Even a settled local receipt is refreshed; terminal state cannot regress.
      await reconcile().catch(() => undefined);
    }).catch((error) => {
      if (!live || !owns()) return;
      setStorageError(error);
      publish();
    });
    const retry = () => {
      if (live && owns()) void reconcile().catch(() => undefined);
    };
    const invalidate = () => {
      if (!owns()) setActive(false);
    };
    const timer = window.setInterval(() => {
      if (journal.record.pending || draftReviewState(journal.record.message) === "sending") retry();
    }, 5_000);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    window.addEventListener(AUTH_CREDENTIALS_CHANGED_EVENT, invalidate);
    return () => {
      live = false;
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      window.removeEventListener(AUTH_CREDENTIALS_CHANGED_EVENT, invalidate);
      if (entry) entry.users--;
      release();
    };
  }, [journal]);
  useEffect(() => {
    if (!ready || !owns()) return;
    journal.observe(message);
    if (!["pending", "sending"].includes(draftReviewState(message)))
      void journal.acknowledge(message).catch(setStorageError);
    publish();
  }, [message, ready, journal]);

  return {
    message: journal.record.message,
    state: journal.record.pending && journal.record.action === "send" &&
      draftReviewState(journal.record.message) === "pending"
      ? "sending" : draftReviewState(journal.record.message),
    fields: journal.record.fields,
    locked: !ready || !active || journal.record.pending,
    unconfirmed: journal.record.pending,
    storageError,
    owns,
    reconcile,
    edit: (fields: Record<string, string>) => {
      if (!ready || !owns()) return;
      void journal.edit(fields).then(() => setStorageError(null), setStorageError);
      publish();
    },
    begin: async (action: "send" | "cancel") => {
      if (!ready || !owns()) return false;
      if (journal.record.pending || draftReviewState(journal.record.message) === "sending") {
        await reconcile();
        return false;
      }
      try {
        const started = await journal.begin(action);
        if (started && !owns()) {
          journal.running = false;
          release();
          return false;
        }
        return started;
      } finally {
        publish();
      }
    },
    acknowledge: async (next: ChannelMessageView) => {
      if (!owns()) return;
      await journal.acknowledge(next);
      publish();
    },
    finish: () => {
      journal.running = false;
      release();
    },
  };
}
