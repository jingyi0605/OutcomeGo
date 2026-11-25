import { lazy, Suspense } from "react";
import { useState } from "react";
import { API_BASE } from "../../../client/http";
import { useServerUpdateStatus } from "../../../hooks/use-server-update-status";
import { AdvancedComputerSettings, MachineSettings } from "./machines";
import { TailscaleSettings } from "./tailscale";
import { ServerActivity } from "./server-activity";
import { AutomationWebhookPublicUrlSettings } from "./automation-webhook-url";
import { SectionLabel, SettingsGroup, SettingsLink, SettingsRow } from "./ui";
import { settingsSecondaryButton } from "./ui";
import { useI18n } from "../../../lib/i18n";

const BrowserNetworkSettings = lazy(() => import("./browser-network"));
const ServerLocationSettings = lazy(() => import("./server-location"));
const ComputerNetworkPolicyDialog = lazy(() =>
  import("./computer-network-policy").then((module) => ({ default: module.ComputerNetworkPolicyDialog }))
);

export default function ServerSettings() {
  const { t } = useI18n();
  const [policyOpen, setPolicyOpen] = useState(false);
  const { status: server, loading } = useServerUpdateStatus(window.outcomego?.versions.app ?? null);
  return (
    <>
      <Suspense fallback={null}><ServerLocationSettings /></Suspense>
      <Suspense fallback={null}>
        <BrowserNetworkSettings />
      </Suspense>
      <section aria-label={t("Cloud computer firewall")} className="my-7">
        <SectionLabel>{t("Cloud computer firewall")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            title={t("Private network access")}
            description={t("Choose whether the cloud computer can reach LAN services and manage TCP exceptions.")}
            control={
              <button className={settingsSecondaryButton} onClick={() => setPolicyOpen(true)} type="button">
                {t("Manage")}
              </button>
            }
          />
        </SettingsGroup>
      </section>
      <Suspense fallback={null}>
        <ComputerNetworkPolicyDialog open={policyOpen} onOpenChange={setPolicyOpen} />
      </Suspense>
      <section aria-label={t("Connected server")} className="my-7">
        <SectionLabel>{t("Connected server")}</SectionLabel>
        <SettingsGroup>
          <SettingsRow
            title={
              loading ? t("Checking server…") : t("Server {version}", { version: server?.currentVersion ?? t("version unknown") })
            }
            description={new URL(API_BASE).host}
            control={<SettingsLink anchor="server-update">{t("View updates")}</SettingsLink>}
          />
        </SettingsGroup>
      </section>
      <ServerActivity />
      <AutomationWebhookPublicUrlSettings />
      <TailscaleSettings />
      <MachineSettings />
      <AdvancedComputerSettings />
    </>
  );
}
