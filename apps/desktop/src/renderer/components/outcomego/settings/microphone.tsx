import { type ReactNode, useState } from "react";
import { useMicrophoneDevices } from "../../../hooks/use-microphone-devices";
import { microphoneErrorMessage, setMicrophonePreference } from "../../../lib/microphone";
import { useI18n } from "../../../lib/i18n";
import { SectionLabel, SettingsGroup, SettingsRow, settingsSecondaryButton } from "./ui";

export interface MicrophoneControlProps {
  disabled: boolean;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}

const actionClass = settingsSecondaryButton;

export function MicrophoneSettings({
  renderControl,
}: {
  renderControl: (props: MicrophoneControlProps) => ReactNode;
}) {
  const { t } = useI18n();
  const {
    deviceId,
    devices,
    status,
    permission,
    checking,
    canOpenSettings,
    enable,
    openSettings,
    refresh,
  } = useMicrophoneDevices();
  const [saveError, setSaveError] = useState("");
  const [accessError, setAccessError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const accessLabel = checking
    ? t("Checking…")
    : permission === "granted"
      ? t("Allowed")
      : permission === "denied"
        ? t("Blocked")
        : permission === "prompt"
          ? t("Not requested")
          : t("Unknown");
  const requestAccess = async () => {
    setAccessError("");
    setRequesting(true);
    try {
      await enable();
    } catch (error) {
      setAccessError(microphoneErrorMessage(error));
    } finally {
      setRequesting(false);
    }
  };
  const showSystemSettings = async () => {
    setAccessError("");
    try {
      await openSettings();
    } catch {
      setAccessError(
        t("Could not open system settings. Open your device’s microphone privacy settings.")
      );
    }
  };
  const missing = Boolean(deviceId && !devices.some((device) => device.deviceId === deviceId));
  const availability =
    status === "unsupported"
      ? t("Microphone input is unavailable in this app environment.")
      : status === "error"
        ? t("Could not list microphones.")
        : permission === "granted" && status === "ready" && devices.length === 0
          ? t("No microphone found. Connect a microphone to record voice notes.")
          : missing && status === "ready"
            ? t(
                "Your saved microphone is unavailable. Recording will use the system default until it reconnects."
              )
            : undefined;
  return (
    <>
      <SectionLabel>{t("System")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          stackControl
          title={t("Microphone")}
          anchors={["microphone"]}
          description={saveError || availability}
          control={renderControl({
            disabled: status === "unsupported",
            value: deviceId || "system-default",
            options: [
              { value: "system-default", label: t("System Default") },
              ...(missing ? [{ value: deviceId, label: t("Saved microphone (unavailable)") }] : []),
              ...devices.map((device, index) => ({
                value: device.deviceId,
                label: device.label || t("Microphone {number}", { number: index + 1 }),
              })),
            ],
            onValueChange: (value) => {
              try {
                setMicrophonePreference(value === "system-default" ? "" : value);
                setSaveError("");
              } catch {
                setSaveError(
                  t("Could not save your microphone choice. Check local app storage and try again.")
                );
              }
            },
          })}
        />
        <SettingsRow
          stackControl
          title={t("Microphone access")}
          description={
            accessError ||
            (permission === "denied"
              ? canOpenSettings
                ? t("Allow OutcomeGo in system settings.")
                : t("Allow microphone access in your browser’s site settings.")
              : permission === "prompt"
                ? t("Allow microphone access to record voice notes.")
                : permission === "unknown" && !checking
                  ? t("Microphone permission could not be checked.")
                  : undefined)
          }
          control={
            <div className="flex items-center gap-3">
              <span
                aria-label={t("Microphone access {status}", { status: accessLabel.toLowerCase() })}
                className="inline-flex items-center gap-1.5 text-[12px] text-foreground-secondary"
                role="status"
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${permission === "granted" && !checking ? "bg-emerald-500" : "bg-foreground-tertiary"}`}
                />
                {accessLabel}
              </span>
              {!checking && (permission === "prompt" || permission === "unknown") ? (
                <button
                  className={actionClass}
                  disabled={requesting || status === "unsupported"}
                  onClick={() => void requestAccess()}
                  type="button"
                >
                  {requesting ? t("Requesting…") : t("Enable microphone")}
                </button>
              ) : !checking && canOpenSettings ? (
                <button
                  className={actionClass}
                  onClick={() => void showSystemSettings()}
                  type="button"
                >
                  {t("System settings")}
                </button>
              ) : !checking && permission === "denied" ? (
                <button className={actionClass} onClick={() => void refresh()} type="button">
                  {t("Check again")}
                </button>
              ) : null}
            </div>
          }
        />
      </SettingsGroup>
    </>
  );
}
