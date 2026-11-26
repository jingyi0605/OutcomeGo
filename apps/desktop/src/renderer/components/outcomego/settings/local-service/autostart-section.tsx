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
    patch: Partial<Pick<BackgroundPreferenceState, "stopServiceOnQuit" | "launchAtLogin" | "launchHidden">>
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
  const serviceDescription = !autostart
    ? t("Checking autostart status…")
    : !autostart.serviceSupported
      ? t(
          "Autostart is managed by your external container engine (for example Docker Desktop or OrbStack)."
        )
      : autostart.serviceEnabled && !autostart.serviceRegistered
        ? t("Enabled in preferences, but the system task is not registered. Toggle to repair.")
        : t("Automatically start the managed container engine and local services when you sign in.");

  return (
    <div className="mt-5">
      <SectionLabel>{t("Startup and exit")}</SectionLabel>
      <SettingsGroup>
        {bridge?.autostartStatus ? (
          <SettingsRow
            title={t("Start local services at login")}
            description={serviceDescription}
            control={
              <InteractiveSwitch
                checked={Boolean(serviceSupported && autostart?.serviceEnabled)}
                disabled={busy || savingService || !autostart || !serviceSupported}
                label="Start local services at login"
                onChange={(checked) => void toggleServiceAutostart(checked)}
              />
            }
          />
        ) : null}

        {preferences ? (
          <>
            <SettingsRow
              title={t("Launch OutcomeGo at login")}
              description={t("Start the OutcomeGo desktop app automatically when you sign in.")}
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
            />
            <SettingsRow
              title={t("Start minimized to tray")}
              description={t(
                "Keep the main window hidden in the tray when launched automatically at login."
              )}
              control={
                <InteractiveSwitch
                  checked={prefs.launchHidden}
                  disabled={savingPrefs || !prefs.launchAtLogin}
                  label="Start minimized to tray"
                  onChange={(checked) =>
                    void updateBackgroundPreference({ launchHidden: checked })
                  }
                />
              }
            />
            <SettingsRow
              title={t("Stop local services when quitting")}
              description={t(
                "When disabled, local services stay running in the background after you quit the desktop app."
              )}
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
