import { lazy, Suspense } from "react";
import { API_BASE } from "../../../client/http";
import { useServerUpdateStatus } from "../../../hooks/use-server-update-status";
import { AdvancedComputerSettings, MachineSettings } from "./machines";
import { TailscaleSettings } from "./tailscale";
import { ServerActivity } from "./server-activity";
import { AutomationWebhookPublicUrlSettings } from "./automation-webhook-url";
import { SectionLabel, SettingsGroup, SettingsLink, SettingsRow } from "./ui";
import { useI18n } from "../../../lib/i18n";

const BrowserNetworkSettings = lazy(() => import("./browser-network"));

export default function ServerSettings() {
  const { t } = useI18n();
  const { status: server, loading } = useServerUpdateStatus(window.aiteamos?.versions.app ?? null);
  return (
    <>
      <Suspense fallback={null}>
        <BrowserNetworkSettings />
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
