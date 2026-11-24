import { useEffect, useRef, useState } from "react";
import type {
  BotMessageNotifyLevel,
  NotificationRouting,
} from "@outcomego/contracts/notification-presence";
import { api } from "../../../client/outcomego-api";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { SettingsSelectContent } from "./select-content";
import {
  InteractiveSwitch,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  settingsSelect,
} from "./ui";
import { useI18n } from "../../../lib/i18n";

type Preferences = Pick<NotificationRouting, "smartEnabled" | "botMessageLevel">;

export function SmartNotificationSettings() {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastResponse = useRef(-1);
  const apply = (value: NotificationRouting) => {
    if (value.serverTime < lastResponse.current) return;
    lastResponse.current = value.serverTime;
    setPreferences({ smartEnabled: value.smartEnabled, botMessageLevel: value.botMessageLevel });
  };
  const save = (changes: { smartEnabled?: boolean; botMessageLevel?: BotMessageNotifyLevel }) => {
    setSaving(true);
    setError(null);
    void api
      .updateNotificationPreferences(changes)
      .then(apply)
      .catch(() => setError(t("Couldn’t save notification settings. Try again.")))
      .finally(() => setSaving(false));
  };
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api
        .notificationPreferences()
        .then((value) => {
          if (active) apply(value);
        })
        .catch(() => {
          /* The section stays hidden until the setting loads. */
        });
    };
    refresh();
    window.addEventListener("outcomego:notification-preferences-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("outcomego:notification-preferences-changed", refresh);
    };
  }, []);
  if (preferences === null) return null;
  return (
    <>
      <SectionLabel>{t("Notifications")}</SectionLabel>
      <SettingsGroup>
        {preferences.botMessageLevel !== undefined ? (
          <SettingsRow
            title={t("Bot message alerts")}
            description={t(
              "Applies to desktop and mobile alerts. Choose whether every Bot message alerts you or only the final summary of each task."
            )}
            control={
              <Select
                disabled={saving}
                onValueChange={(value) => save({ botMessageLevel: value as BotMessageNotifyLevel })}
                value={preferences.botMessageLevel}
              >
                <SelectTrigger
                  aria-label={t("Bot message alerts")}
                  className={`${settingsSelect} w-auto`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SettingsSelectContent>
                  <SelectItem value="every_message">{t("Every message")}</SelectItem>
                  <SelectItem value="final_only">{t("Final summary only")}</SelectItem>
                </SettingsSelectContent>
              </Select>
            }
          />
        ) : null}
        <SettingsRow
          title={t("Pause mobile alerts while using this desktop")}
          description={t(
            "Alerts resume after 5 minutes of inactivity or when you open OutcomeGo on Mobile."
          )}
          control={
            <InteractiveSwitch
              label={t("Pause mobile alerts while using this desktop")}
              checked={preferences.smartEnabled}
              disabled={saving}
              onChange={(value) => save({ smartEnabled: value })}
            />
          }
        />
        {error && (
          <p role="alert" className="pb-3 text-xs text-destructive">
            {error}
          </p>
        )}
      </SettingsGroup>
    </>
  );
}
