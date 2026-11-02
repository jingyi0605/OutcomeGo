import { useEffect, useRef, useState } from "react";
import { api } from "../../../client/openteam-api";
import { InteractiveSwitch, SectionLabel, SettingsGroup, SettingsRow } from "./ui";
import { settingsText, useSettingsLanguage } from "./language";

export function SmartNotificationSettings() {
  const { language } = useSettingsLanguage();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastResponse = useRef(-1);
  const apply = (value: { serverTime: number; smartEnabled: boolean }) => {
    if (value.serverTime < lastResponse.current) return;
    lastResponse.current = value.serverTime;
    setEnabled(value.smartEnabled);
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
    window.addEventListener("openteam:notification-preferences-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("openteam:notification-preferences-changed", refresh);
    };
  }, []);
  if (enabled === null) return null;
  return (
    <>
      <SectionLabel>{settingsText(language, "Notifications", "通知")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          title={settingsText(language, "Pause iPhone alerts while I’m using this Mac", "使用此 Mac 时暂停 iPhone 提醒")}
          description={settingsText(language, "Phone alerts stay quiet while you’re using your Mac, unless OpenTeam is open on your iPhone. They resume after five minutes of Mac inactivity.", "使用 Mac 时手机提醒会保持安静，除非 OpenTeam 正在 iPhone 上打开。Mac 闲置五分钟后会恢复提醒。")}
          control={
            <InteractiveSwitch
              label={settingsText(language, "Pause iPhone alerts while I’m using this Mac", "使用此 Mac 时暂停 iPhone 提醒")}
              checked={enabled}
              disabled={saving}
              onChange={(value) => {
                setSaving(true);
                setError(null);
                void api
                  .updateNotificationPreferences(value)
                  .then(apply)
                  .catch(() => setError("Couldn’t save notification settings. Try again."))
                  .finally(() => setSaving(false));
              }}
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
