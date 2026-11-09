import type {
  AutomationWebhookPublicUrlCheck,
  AutomationWebhookPublicUrlView,
} from "@aiteamos/contracts/automation-webhooks";
import { clientErrorMessage } from "@aiteamos/product-core/redaction";
import { useEffect, useState } from "react";
import { api } from "../../../client/aiteamos-api";
import { useI18n } from "../../../lib/i18n";
import {
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  settingsInput,
  settingsPrimaryButton,
  settingsSecondaryButton,
} from "./ui";

export function AutomationWebhookPublicUrlSettings() {
  const { t } = useI18n();
  const [view, setView] = useState<AutomationWebhookPublicUrlView | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | "check" | null>("load");
  const [check, setCheck] = useState<AutomationWebhookPublicUrlCheck | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api
      .automationWebhookPublicUrl()
      .then((next) => {
        if (!active) return;
        setView(next);
        setDraft(next.publicUrl ?? "");
      })
      .catch((cause) => {
        if (active) setError(clientErrorMessage(cause, t("Could not load webhook settings.")));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const test = async () => {
    setBusy("check");
    setError("");
    setCheck(null);
    try {
      const result = await api.checkAutomationWebhookPublicUrl(draft.trim());
      setCheck(result);
      if (!result.ok) setError(result.message);
    } catch (cause) {
      setError(clientErrorMessage(cause, t("Could not test the public webhook URL.")));
    } finally {
      setBusy(null);
    }
  };

  const save = async (publicUrl = draft.trim()) => {
    setBusy("save");
    setError("");
    setCheck(null);
    try {
      const next = await api.updateAutomationWebhookPublicUrl(publicUrl);
      setView(next);
      setDraft(next.publicUrl ?? "");
    } catch (cause) {
      setError(clientErrorMessage(cause, t("Could not save the public webhook URL.")));
    } finally {
      setBusy(null);
    }
  };

  const configured = view?.valid && Boolean(view.publicUrl);
  const statusLabel = check ? (check.ok ? t("Reachable") : t("Not reachable")) : t("Not tested");
  return (
    <>
      <SectionLabel>{t("Automation webhooks")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          title={t("Public webhook URL")}
          description={t("HTTPS endpoint for webhook routines.")}
          control={
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <input
                aria-label={t("Public webhook URL")}
                className={`${settingsInput} min-w-[220px] flex-1 basis-[240px]`}
                disabled={busy !== null}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setCheck(null);
                  setError("");
                }}
                placeholder="https://hooks.example.com"
                type="url"
                value={draft}
              />
              <button
                className={settingsSecondaryButton}
                disabled={busy !== null || !draft.trim()}
                onClick={() => void test()}
                type="button"
              >
                {busy === "check" ? t("Testing…") : t("Test")}
              </button>
              <button
                className={settingsPrimaryButton}
                disabled={busy !== null || !draft.trim() || draft.trim() === view?.publicUrl}
                onClick={() => void save()}
                type="button"
              >
                {busy === "save" ? t("Saving…") : t("Save")}
              </button>
              <button
                className={settingsSecondaryButton}
                disabled={busy !== null || view?.source !== "settings"}
                onClick={() => void save("")}
                type="button"
              >
                {t("Clear")}
              </button>
            </div>
          }
          stackControl
          descriptionBelow
        />
        <SettingsRow
          title={t("Connectivity")}
          description={
            check?.message ?? (configured ? t("Not tested") : t("Set a public HTTPS address."))
          }
          control={
            <span
              aria-label={statusLabel}
              className={`inline-flex items-center gap-1.5 text-[12px] ${check ? (check.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : "text-foreground-tertiary"}`}
              role="status"
              title={statusLabel}
            >
              <span className="size-2 rounded-full bg-current" />
            </span>
          }
        />
      </SettingsGroup>
      {busy === "load" ? (
        <p className="px-2 text-xs text-foreground-secondary" role="status">
          {t("Loading webhook settings…")}
        </p>
      ) : null}
      {error || (view && !view.valid && view.error) ? (
        <p className="px-2 text-xs text-destructive" role="alert">
          {error || view?.error}
        </p>
      ) : null}
    </>
  );
}
