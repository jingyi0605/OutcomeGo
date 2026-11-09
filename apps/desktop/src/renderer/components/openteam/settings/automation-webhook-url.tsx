import type {
  AutomationWebhookPublicUrlCheck,
  AutomationWebhookPublicUrlView,
} from "@openteam/contracts/automation-webhooks";
import { clientErrorMessage } from "@openteam/product-core/redaction";
import { useEffect, useState } from "react";
import { api } from "../../../client/openteam-api";
import {
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  settingsInput,
  settingsPrimaryButton,
  settingsSecondaryButton,
} from "./ui";

const describeSource = (source: AutomationWebhookPublicUrlView["source"]) => {
  if (source === "settings") return "Saved in OpenTeam settings.";
  if (source === "environment") return "Using the server environment value.";
  return "No public webhook URL is configured.";
};

export function AutomationWebhookPublicUrlSettings() {
  const [view, setView] = useState<AutomationWebhookPublicUrlView | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | "check" | null>("load");
  const [check, setCheck] = useState<AutomationWebhookPublicUrlCheck | null>(null);
  const [message, setMessage] = useState("");
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
        if (active) setError(clientErrorMessage(cause, "Could not load webhook settings."));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const test = async () => {
    setBusy("check");
    setError("");
    setMessage("");
    setCheck(null);
    try {
      const result = await api.checkAutomationWebhookPublicUrl(draft.trim());
      setCheck(result);
      if (result.ok) setMessage(result.message);
      else setError(result.message);
    } catch (cause) {
      setError(clientErrorMessage(cause, "Could not test the public webhook URL."));
    } finally {
      setBusy(null);
    }
  };

  const save = async (publicUrl = draft.trim()) => {
    setBusy("save");
    setError("");
    setMessage("");
    setCheck(null);
    try {
      const next = await api.updateAutomationWebhookPublicUrl(publicUrl);
      setView(next);
      setDraft(next.publicUrl ?? "");
      setMessage(
        next.updatedWebhooks
          ? `Saved and applied immediately. Updated ${next.updatedWebhooks} existing routine webhook${next.updatedWebhooks === 1 ? "" : "s"}.`
          : "Saved and applied immediately. New routine webhooks will use this address."
      );
    } catch (cause) {
      setError(clientErrorMessage(cause, "Could not save the public webhook URL."));
    } finally {
      setBusy(null);
    }
  };

  const configured = view?.valid && Boolean(view.publicUrl);
  return (
    <>
      <SectionLabel>Automation webhooks</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          title="Public webhook URL"
          description={
            <div className="space-y-1">
              <p>
                The HTTPS address that external services use to reach webhook routines created by
                your bots.
              </p>
              <p>{view ? describeSource(view.source) : "Loading…"}</p>
            </div>
          }
          control={
            <div className="flex max-w-[520px] flex-wrap items-center justify-end gap-2">
              <input
                aria-label="Public webhook URL"
                className={`${settingsInput} w-[320px] max-w-full`}
                disabled={busy !== null}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setCheck(null);
                  setMessage("");
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
                {busy === "check" ? "Testing…" : "Test"}
              </button>
              <button
                className={settingsPrimaryButton}
                disabled={busy !== null || !draft.trim() || draft.trim() === view?.publicUrl}
                onClick={() => void save()}
                type="button"
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            </div>
          }
          stackControl
        />
        {view?.source === "settings" ? (
          <SettingsRow
            title="Clear saved override"
            description="Remove the value saved in Settings. If OPENTEAM_PUBLIC_URL exists on the server, OpenTeam will use that environment value instead."
            control={
              <button
                className={settingsSecondaryButton}
                disabled={busy !== null}
                onClick={() => void save("")}
                type="button"
              >
                Clear
              </button>
            }
          />
        ) : null}
        <SettingsRow
          title="Connectivity"
          description={
            check
              ? check.message
              : configured
                ? "Use Test to check this address from the OpenTeam server."
                : "Set a public HTTPS address, then test it before creating a webhook routine."
          }
        />
      </SettingsGroup>
      {busy === "load" ? (
        <p className="px-2 text-xs text-foreground-secondary" role="status">
          Loading webhook settings…
        </p>
      ) : null}
      {error || (view && !view.valid && view.error) ? (
        <p className="px-2 text-xs text-destructive" role="alert">
          {error || view?.error}
        </p>
      ) : null}
      {message ? (
        <p className="px-2 text-xs text-foreground-secondary" role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}
