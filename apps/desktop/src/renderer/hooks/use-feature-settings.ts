import type { FeatureSettingsView, UpdateFeatureSettingsInput } from "@outcomego/contracts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AUTH_CREDENTIALS_CHANGED_EVENT } from "../client/auth";
import { api } from "../client/outcomego-api";

/** Optional modules are off until the owner enables them, so an unloaded setting reads as off. */
interface FeatureState extends FeatureSettingsView {
  /** False until the server answered, so callers can tell "off" from "not known yet". */
  loaded: boolean;
  /** The last read failed (for example the server could not be reached), so "off" is only a default. */
  failed: boolean;
}
const OFF: FeatureState = {
  outcomesEnabled: false,
  streamBotReplies: false,
  plannerBotId: null,
  reviewerBotId: null,
  plannerModel: null,
  reviewerModel: null,
  environmentNote: null,
  taskPolicy: {},
  updatedAt: null,
  loaded: false,
  failed: false,
};

let current: FeatureState = OFF;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const publish = (next: FeatureSettingsView) => {
  const normalized: FeatureState = {
    outcomesEnabled: next.outcomesEnabled,
    streamBotReplies: next.streamBotReplies === true,
    plannerBotId: next.plannerBotId ?? null,
    reviewerBotId: next.reviewerBotId ?? null,
    plannerModel: next.plannerModel ?? null,
    reviewerModel: next.reviewerModel ?? null,
    environmentNote: next.environmentNote ?? null,
    // Only the keys the owner changed; an older server sends none, which reads as "all initial values".
    taskPolicy: next.taskPolicy ?? {},
    updatedAt: next.updatedAt ?? null,
    loaded: true,
    failed: false,
  };
  if (current.loaded && !current.failed && JSON.stringify(normalized) === JSON.stringify(current)) {
    return;
  }
  current = normalized;
  for (const listener of listeners) listener();
};

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = RETRY_BASE_MS;

/** A failed read (server still starting, sign-in not ready) must not leave goals off for the whole session. */
const scheduleRetry = () => {
  if (retryTimer || listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (listeners.size > 0 && !current.loaded) void load();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
};

const load = () => {
  loading ??= api
    .featureSettings()
    .then((settings) => {
      retryDelay = RETRY_BASE_MS;
      publish(settings);
    })
    .catch(() => {
      // Keep the last known value (off until one is known), say so for the settings row, and try again.
      if (!current.failed) {
        current = { ...current, failed: true };
        for (const listener of listeners) listener();
      }
      scheduleRetry();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useFeatureSettings() {
  const settings = useSyncExternalStore(subscribe, () => current, () => OFF);
  useEffect(() => {
    if (!current.loaded) void load();
    // Signing in as another account, or coming back to the window, reads the setting again, so
    // an earlier failure or a change made elsewhere never needs the settings page to be opened.
    const reload = () => void load();
    const onFocus = () => {
      if (document.visibilityState === "visible" && (!current.loaded || current.failed)) reload();
    };
    window.addEventListener(AUTH_CREDENTIALS_CHANGED_EVENT, reload);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(AUTH_CREDENTIALS_CHANGED_EVENT, reload);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  const retry = useCallback(() => void load(), []);
  const update = useCallback(
    async (input: UpdateFeatureSettingsInput) => publish(await api.updateFeatureSettings(input)),
    []
  );
  return { ...settings, update, retry };
}

/** Whether goal management (Outcomes, quick ideas, the bots' goal tools) is turned on. */
export const useOutcomesEnabled = () => useFeatureSettings().outcomesEnabled;
