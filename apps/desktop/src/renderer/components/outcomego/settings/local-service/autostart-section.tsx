import { useEffect, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import type {
  BackgroundPreferenceState,
  LocalAutostartStatus,
} from "../../../../lib/local-deploy-contract";
import { InteractiveSwitch, SectionLabel, SettingsGroup, SettingsRow } from "../ui";

export function AutostartSection({
  busy,
}: {
  busy: boolean;
}) {
  const { t } = useI18n();
  const bridge = window.outcomego?.localServer;
  const preferences = window.outcomego?.backgroundPreferences;

  const [autostart, setAutostart] = useState<LocalAutostartStatus | null>(null);
  const [prefs, setPrefs] = useState<BackgroundPreferenceState>({
    warnedOnClose: false,
    stopServiceOnQuit: false,
    launchAtLogin: false,
    launchHidden: true,
  });
  const [savingService, setSavingService] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void bridge?.autostartStatus?.()
      .then((value) => {
        if (active) setAutostart(value);
      })
      .catch(() => undefined);
    void preferences?.get()
      .then((value) => {
        if (active) setPrefs(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bridge, preferences]);

  const toggleServiceAutostart = async (enabled: boolean) => {
    if (!bridge?.setAutostart || savingService || busy) return;
    setSavingService(true);
    setError(null);
    try {
      const next = await bridge.setAutostart(enabled);
      setAutostart(next);
    } catch {
      setError(t("Unable to update local service autostart."));
    } finally {
      setSavingService(false);
    }
  };

  const updateBackgroundPreference = async (
    patch: Partial<
      Pick<BackgroundPreferenceState, "stopServiceOnQuit" | "launchAtLogin" | "launchHidden">
    >
  ) => {
    if (!preferences || savingPrefs) return;
    setSavingPrefs(true);
    setError(null);
    try {
      const next = await preferences.set(patch);
      setPrefs(next);
    } catch {
      setError(t("Unable to update desktop startup preferences."));
    } finally {
      setSavingPrefs(false);
    }
  };

  const serviceSupported = autostart?.serviceSupported ?? false;
  const serviceDescription =
    autostart && !autostart.serviceSupported
      ? t("Managed by external container engine.")
      : autostart && autostart.serviceEnabled && !autostart.serviceRegistered
        ? t("System task missing. Toggle to repair.")
        : undefined;

  return (
    <div className="mt-5">
      <SectionLabel>{t("Startup and exit")}</SectionLabel>
      <SettingsGroup>
        {bridge?.autostartStatus ? (
          <SettingsRow
            control={
              <InteractiveSwitch
                checked={Boolean(serviceSupported && autostart?.serviceEnabled)}
                disabled={busy || savingService || !autostart || !serviceSupported}
                label="Start local services at login"
                onChange={(checked) => void toggleServiceAutostart(checked)}
              />
            }
            description={serviceDescription}
            title={t("Start local services at login")}
          />
        ) : null}

        {preferences ? (
          <>
            <SettingsRow
              control={
                <InteractiveSwitch
                  checked={prefs.launchAtLogin}
                  disabled={savingPrefs}
                  label="Launch OutcomeGo at login"
                  onChange={(checked) =>
                    void updateBackgroundPreference({ launchAtLogin: checked })
                  }
                />
              }
              title={t("Launch OutcomeGo at login")}
            />
            {prefs.launchAtLogin ? (
              <SettingsRow
                control={
                  <InteractiveSwitch
                    checked={prefs.launchHidden}
                    disabled={savingPrefs}
                    label="Start minimized to tray"
                    onChange={(checked) =>
                      void updateBackgroundPreference({ launchHidden: checked })
                    }
                  />
                }
                title={t("Start minimized to tray")}
              />
            ) : null}
            <SettingsRow
              control={
                <InteractiveSwitch
                  checked={prefs.stopServiceOnQuit}
                  disabled={savingPrefs}
                  label="Stop local services when quitting"
                  onChange={(checked) =>
                    void updateBackgroundPreference({ stopServiceOnQuit: checked })
                  }
                />
              }
              title={t("Stop local services when quitting")}
            />
          </>
        ) : null}
      </SettingsGroup>
      {error ? (
        <p className="mt-2 px-2 text-[12px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
