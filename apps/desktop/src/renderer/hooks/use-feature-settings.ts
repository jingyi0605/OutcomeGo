import type { FeatureSettingsView } from "@outcomego/contracts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "../client/outcomego-api";

/** Optional modules are off until the owner enables them, so an unloaded setting reads as off. */
interface FeatureState extends FeatureSettingsView {
  /** False until the server answered, so callers can tell "off" from "not known yet". */
  loaded: boolean;
  /** The last read failed (for example the server could not be reached), so "off" is only a default. */
  failed: boolean;
}
const OFF: FeatureState = { outcomesEnabled: false, loaded: false, failed: false };

let current: FeatureState = OFF;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const publish = (next: FeatureSettingsView) => {
  if (current.loaded && next.outcomesEnabled === current.outcomesEnabled) return;
  current = { outcomesEnabled: next.outcomesEnabled, loaded: true, failed: false };
  for (const listener of listeners) listener();
};

const load = () => {
  loading ??= api
    .featureSettings()
    .then(publish)
    .catch(() => {
      // Stay off, but say so: the settings row offers a retry.
      if (current.failed) return;
      current = { ...current, failed: true };
      for (const listener of listeners) listener();
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
  }, []);
  const retry = useCallback(() => void load(), []);
  const update = useCallback(
    async (input: Partial<FeatureSettingsView>) => publish(await api.updateFeatureSettings(input)),
    []
  );
  return { ...settings, update, retry };
}

/** Whether goal management (Outcomes, quick ideas, the bots' goal tools) is turned on. */
export const useOutcomesEnabled = () => useFeatureSettings().outcomesEnabled;
