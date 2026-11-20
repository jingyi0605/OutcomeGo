import { useEffect, useState } from "react";
import { useI18n } from "../../../lib/i18n";
import { InteractiveSwitch, SettingsRow, settingsSecondaryButton } from "./ui";

function BotDockAccessibility({
  check,
  openSettings,
}: {
  check: () => Promise<boolean>;
  openSettings: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [permission, setPermission] = useState<"checking" | "enabled" | "disabled" | "error">(
    "checking"
  );
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);

  useEffect(() => {
    let active = true;
    let checking = false;
    const refresh = async () => {
      if (checking) return;
      checking = true;
      try {
        const enabled = await check();
        if (active) setPermission(enabled ? "enabled" : "disabled");
      } catch {
        if (active) setPermission("error");
      } finally {
        checking = false;
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [check]);

  const enable = async () => {
    setOpening(true);
    setOpenError(false);
    try {
      await openSettings();
    } catch {
      setOpenError(true);
    } finally {
      setOpening(false);
    }
  };

  return (
    <SettingsRow
      stackControl
      title={t("Accessibility permission")}
      description={
        openError && permission !== "enabled"
          ? t("Could not open system settings. Open Accessibility settings and allow OutcomeGo.")
          : permission === "error"
            ? t("Could not check accessibility access. Open System Settings to review it.")
            : t(
                "Required for global file drag detection. Allows the floating window to detect when you start dragging files from anywhere."
              )
      }
      control={
        permission === "checking" || permission === "enabled" ? (
          <span
            className="inline-flex items-center gap-1.5 text-[12px] text-foreground-secondary"
            role="status"
          >
            {permission === "enabled" && (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
            )}
            {permission === "enabled" ? t("Enabled") : t("Checking…")}
          </span>
        ) : (
          <button
            className={settingsSecondaryButton}
            disabled={opening}
            onClick={() => void enable()}
            type="button"
          >
            {t("Enable accessibility")}
          </button>
        )
      }
    />
  );
}

export default function BotDockSettings() {
  const { t } = useI18n();
  const dock = window.outcomego?.botDock;
  const accessibility =
    window.outcomego?.platform === "darwin" ? window.outcomego.accessibility : undefined;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "save" | null>(null);

  useEffect(() => {
    if (!dock) return;
    let active = true;
    let receivedChange = false;
    const unsubscribe = dock.onEnabledChange((enabled) => {
      receivedChange = true;
      setEnabled(enabled);
      setError(null);
    });
    void dock.getEnabled().then(
      (enabled) => {
        if (active && !receivedChange) setEnabled(enabled);
      },
      () => {
        if (active && !receivedChange) setError("load");
      }
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [dock]);

  if (!dock) return null;

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await dock.setEnabled(enabled);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  };
  const label = t("Enable bot floating window");

  return (
    <>
      <SettingsRow
        title={label}
        description={t(
          "Shows a small floating window that displays unread messages and pending goals. Allows quick file drops to bots."
        )}
        control={
          <InteractiveSwitch
            label={label}
            checked={enabled === true}
            disabled={enabled === null || saving}
            onChange={(value) => void toggle(value)}
          />
        }
      />
      {error && (
        <p role="alert" className="pb-3 text-xs text-destructive">
          {error === "load"
            ? t("Couldn’t load this setting.")
            : t("Couldn't save this setting. Try again.")}
        </p>
      )}
      {enabled && accessibility && (
        <BotDockAccessibility check={accessibility.check} openSettings={accessibility.openSettings} />
      )}
    </>
  );
}
