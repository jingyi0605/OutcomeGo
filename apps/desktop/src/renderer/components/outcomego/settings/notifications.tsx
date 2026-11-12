import { SectionLabel, SettingsGroup, SettingsRow } from "./ui";
import { useI18n } from "../../../lib/i18n";

export interface NotificationSettingsProps {
  permission: "allowed" | "blocked";
  onEnable: () => void;
}

export function NotificationSettings({ permission, onEnable }: NotificationSettingsProps) {
  const { t } = useI18n();
  const allowed = permission === "allowed";

  return (
    <>
      <SectionLabel>{t("Notifications")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          title={t("Desktop alerts")}
          control={
            <div className="flex items-center gap-3">
              <span
                aria-label={t("Desktop alerts {status}", {
                  status: t(allowed ? "Allowed" : "Blocked").toLowerCase(),
                })}
                className="inline-flex items-center gap-1.5 text-[12px] text-foreground-secondary"
                role="status"
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${allowed ? "bg-emerald-500" : "bg-foreground-tertiary"}`}
                />
                {allowed ? t("Allowed") : t("Blocked")}
              </span>
              {!allowed ? (
                <button
                  className="inline-flex h-7 items-center rounded-[8px] border border-black/[0.055] bg-black/[0.035] px-2.5 text-[12px] hover:bg-black/[0.065] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-white/[0.07] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]"
                  onClick={onEnable}
                  type="button"
                >
                  {t("Enable notifications")}
                </button>
              ) : null}
            </div>
          }
        />
      </SettingsGroup>
    </>
  );
}
