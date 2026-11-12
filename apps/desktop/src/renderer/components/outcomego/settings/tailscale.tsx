import type { DesktopTailscaleStatus } from "@outcomego/contracts/tailscale";
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../../client/http";
import { useI18n } from "../../../lib/i18n";
import {
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  settingsInput,
  settingsSecondaryButton,
} from "./ui";

export function TailscaleSettings() {
  const { t } = useI18n();
  const [result, setResult] = useState<DesktopTailscaleStatus | null>(null);
  const [port, setPort] = useState("443");
  const [busy, setBusy] = useState<string | null>(t("Checking Tailscale…"));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await window.outcomego?.tailscale?.request({
        serverUrl: API_BASE,
        action: "status",
      });
      setResult(
        next ?? {
          canManage: false,
          status: null,
          message: t("Run these commands on your OutcomeGo server host."),
        }
      );
      if (next?.status) setPort(next.status.httpsPort);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [t]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const change = async (action: "enable" | "disable") => {
    setBusy(
      action === "enable" ? t("Configuring and verifying HTTPS…") : t("Switching to local access…")
    );
    setError(null);
    setNotice(null);
    try {
      const request = window.outcomego?.tailscale?.request;
      if (!request) throw new Error(t("Tailscale is unavailable."));
      const next = await request({
        serverUrl: API_BASE,
        action,
        httpsPort: port,
      });
      setResult(next);
      setNotice(
        t("Server address: {url}.\nReconnect your apps using this address.\n{followUp}", {
          url: next.status?.publicUrl ?? API_BASE,
          followUp:
            action === "disable"
              ? t("User-managed Serve mappings were preserved.")
              : t("Keep Tailscale connected on your devices."),
        })
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  const status = result?.status;
  const validPort = /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535;
  const buttonClass = settingsSecondaryButton;
  return (
    <>
      <SectionLabel>{t("Remote access")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          title={t("Tailscale HTTPS")}
          anchors={["tailscale-https"]}
          description={t(
            "Use HTTPS to connect devices privately.\nTailscale must run on the server and each device."
          )}
          control={
            <button
              className={buttonClass}
              disabled={!!busy}
              onClick={() => {
                setBusy(t("Checking Tailscale…"));
                void refresh();
              }}
              type="button"
            >
              {t("Refresh")}
            </button>
          }
        />
        <SettingsRow title={t("Server address")} description={status?.publicUrl || API_BASE} />
        {result?.canManage ? (
          <>
            <SettingsRow
              title={t("HTTPS port")}
              description={t("Default: 443.\nChoose another port if needed.")}
              control={
                <input
                  aria-label={t("Tailscale HTTPS port")}
                  className={`${settingsInput} w-24`}
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  disabled={!!busy}
                  onChange={(event) => setPort(event.target.value)}
                />
              }
            />
            <SettingsRow
              title={t("HTTPS address")}
              description={
                status?.hostname && validPort
                  ? `https://${status.hostname}${Number(port) === 443 ? "" : `:${Number(port)}`}`
                  : t("Start Tailscale on the host to detect its HTTPS address.")
              }
            />
            <SettingsRow
              title={
                status?.enabled ? t("Tailscale HTTPS configured") : t("Enable Tailscale HTTPS")
              }
              description={
                status?.enabled
                  ? status.verified
                    ? status.ownership === "outcomego"
                      ? t("HTTPS endpoint verified.\nManaged by OutcomeGo.")
                      : status.ownership === "external"
                        ? t("HTTPS endpoint verified.\nUses an existing user-managed route.")
                        : t("HTTPS endpoint verified.")
                    : t("This connection needs attention.")
                  : t(
                      "Creates or reuses a private HTTPS route.\nHTTPS must be enabled for your tailnet."
                    )
              }
              control={
                <button
                  className={buttonClass}
                  disabled={!!busy || !validPort}
                  onClick={() => void change("enable")}
                  type="button"
                >
                  {status?.enabled ? t("Apply / repair") : t("Enable")}
                </button>
              }
            />
            {(status?.enabled || !!status?.managedRoutes) && (
              <SettingsRow
                title={t("Disable Tailscale HTTPS")}
                description={t(
                  "Switches to local access and restarts the server.\nRemote devices will disconnect."
                )}
                control={
                  <button
                    className={buttonClass}
                    disabled={!!busy}
                    onClick={() => void change("disable")}
                    type="button"
                  >
                    {t("Disable")}
                  </button>
                }
              />
            )}
          </>
        ) : (
          <SettingsRow
            title={t("Configure on the server")}
            description={
              <div className="space-y-2 py-2">
                <p>{result?.message || t("Tailscale is managed on the server host.")}</p>
                <code className="block select-all">outcomego tailscale enable --https-port 443</code>
                <code className="block select-all">outcomego tailscale status</code>
                <code className="block select-all">outcomego tailscale disable</code>
                <p>
                  {t("You can also choose Tailscale HTTPS in")} <code>outcomego setup</code>.
                </p>
              </div>
            }
          />
        )}
      </SettingsGroup>
      {result?.canManage && !validPort && (
        <p className="px-2 text-xs text-destructive" role="alert">
          {t("Enter an HTTPS port from 1 to 65535.")}
        </p>
      )}
      {busy && (
        <p className="px-2 text-xs text-foreground-secondary" role="status">
          {busy}
        </p>
      )}
      {(error || status?.issue) && (
        <p className="px-2 text-xs text-destructive" role="alert">
          {error || status?.issue}
        </p>
      )}
      {notice && (
        <p className="px-2 text-xs text-foreground-secondary" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
