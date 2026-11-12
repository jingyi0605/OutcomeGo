import { TriangleAlert } from "lucide-react";
import { clientErrorMessage } from "@outcomego/product-core/redaction";
import { useState } from "react";
import { useServerUpdate } from "../../../hooks/use-server-update";
import { requestDesktopUpdateRestart } from "../../../lib/desktop-update";
import { LoadingOrb } from "../../ui/loading-orb";
import { ServerUpdateSettings } from "./server-update";
import { useI18n } from "../../../lib/i18n";
import { localizeDesktopUpdateMessage } from "../../../lib/server-update-message";
import {
  SectionLabel,
  SettingsGroup,
  SettingsLink,
  SettingsRow,
  settingsPrimaryButton,
  settingsSecondaryButton,
} from "./ui";

const primaryButton = settingsPrimaryButton;
const secondaryButton = settingsSecondaryButton;

type Translate = (key: string, values?: Record<string, string | number>) => string;

const clientUpdateFailure = (status: OutcomeGoUpdateStatus, t: Translate): string => {
  const summary =
    status.failureKind === "signature-invalid"
      ? t("The downloaded update failed signature verification and was not installed.")
      : status.failureKind === "feed-malformed"
        ? t("The update server returned an invalid release manifest.")
        : status.failureKind === "feed-http-status"
          ? t("The update server refused the request.")
          : status.failureKind === "service-unavailable"
            ? t("The update service is currently unreachable.")
            : status.failureKind === "download-failed"
              ? t("The update could not be downloaded.")
              : status.failureKind === "apply-unsupported"
                ? t("The downloaded update cannot be installed on this platform.")
                : t("The desktop update failed.");
  // The main process reports an English technical cause; translate the known copy and keep it.
  const detail = localizeDesktopUpdateMessage(status.message);
  return detail && detail !== summary
    ? t("{summary} {message}", { summary, message: detail })
    : summary;
};

export default function UpdatesSettings() {
  const { t } = useI18n();
  const update = useServerUpdate();
  const {
    clientVersion,
    clientUpdate,
    setClientUpdate,
    server,
    serverLoading,
    refreshServer,
    compatibility,
  } = update;
  const [actionError, setActionError] = useState<string | null>(null);

  const clientNeedsUpdate =
    compatibility === "client-update-required" ||
    ["available", "downloading", "downloaded", "installing"].includes(clientUpdate?.status ?? "");

  const check = async () => {
    setActionError(null);
    setClientUpdate((current) =>
      current ? { ...current, status: "checking", message: null } : current
    );
    try {
      const next = await window.outcomego?.updates.check();
      if (next) setClientUpdate(next);
      await refreshServer();
    } catch (error) {
      const message = clientErrorMessage(error, t("Could not check for updates"));
      setActionError(localizeDesktopUpdateMessage(message) ?? message);
    }
  };

  const updateClient = async () => {
    setActionError(null);
    try {
      if (clientUpdate?.status === "downloaded") {
        requestDesktopUpdateRestart(clientUpdate);
        return;
      }
      if (["downloading", "installing"].includes(clientUpdate?.status ?? "")) return;
      let next = clientUpdate;
      if (next?.status !== "available") {
        next = (await window.outcomego?.updates.check()) ?? next;
        if (next) setClientUpdate(next);
      }
      if (next?.status === "available") await window.outcomego?.updates.openDownload();
      else throw new Error(t("No newer desktop release is currently published"));
    } catch (error) {
      const message = clientErrorMessage(error, t("Could not open the client update"));
      setActionError(localizeDesktopUpdateMessage(message) ?? message);
    }
  };

  const mismatchMessage =
    compatibility === "server-update-required"
      ? t("Server {server} cannot support desktop {desktop}. Update the connected server below.", {
          server: server?.currentVersion ?? "",
          desktop: clientVersion,
        })
      : compatibility === "client-update-required"
        ? t(
            "Desktop {desktop} is outside server {server}'s supported range. Update the desktop app.",
            { desktop: clientVersion, server: server?.currentVersion ?? "" }
          )
        : compatibility === "unknown" && !serverLoading
          ? t(
              "OutcomeGo could not verify that the desktop and server releases match. Update the server first if it does not report a version."
            )
          : null;

  return (
    <>
      {mismatchMessage ? (
        <div
          className="mb-6 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3.5 py-3 text-[12.5px] text-amber-950 dark:text-amber-100"
          role="alert"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{mismatchMessage}</span>
        </div>
      ) : null}

      {compatibility === "update-recommended" ? (
        <p className="mb-4 px-2 text-[12.5px] text-muted-foreground">
          {update.serverNeedsUpdate
            ? t("Server update available. You can keep working.")
            : t("Your server is newer than this desktop.")}{" "}
          <SettingsLink anchor={update.serverNeedsUpdate ? "server-update" : "update-status"}>
            {t("View update")}
          </SettingsLink>
        </p>
      ) : null}

      <SectionLabel>{t("OutcomeGo Updates")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          anchors={["update-status", "automatic-updates"]}
          control={
            clientNeedsUpdate ? (
              <button
                className={primaryButton}
                disabled={["downloading", "installing"].includes(clientUpdate?.status ?? "")}
                onClick={() => void updateClient()}
                type="button"
              >
                {["downloading", "installing"].includes(clientUpdate?.status ?? "") ? (
                  <LoadingOrb aria-hidden size={14} />
                ) : null}
                {clientUpdate?.status === "downloaded"
                  ? t("Restart to update")
                  : clientUpdate?.status === "downloading"
                    ? t("Downloading {percent}%", {
                        percent: Math.round(clientUpdate.progress ?? 0),
                      })
                    : clientUpdate?.status === "installing"
                      ? t("Restarting…")
                      : t("Update desktop")}
              </button>
            ) : (
              <button
                className={secondaryButton}
                disabled={clientUpdate?.status === "checking"}
                onClick={() => void check()}
                type="button"
              >
                {clientUpdate?.status === "checking" ? <LoadingOrb aria-hidden size={14} /> : null}
                {clientUpdate?.status === "checking" ? t("Checking…") : t("Check for Updates")}
              </button>
            )
          }
          description={
            clientUpdate?.status === "available"
              ? (localizeDesktopUpdateMessage(clientUpdate.message) ??
                t("Desktop {version} is available", { version: clientUpdate.latestVersion }))
              : clientUpdate?.status === "up-to-date"
                ? (localizeDesktopUpdateMessage(clientUpdate.message) ?? t("You’re up to date"))
                : ["downloading", "downloaded", "installing"].includes(clientUpdate?.status ?? "")
                  ? (localizeDesktopUpdateMessage(clientUpdate?.message) ??
                    (clientUpdate?.status === "downloaded"
                      ? t("Restart to update")
                      : t("Downloading update")))
                  : clientUpdate?.status === "error"
                    ? clientUpdateFailure(clientUpdate, t)
                    : t("Check for a newer desktop version.")
          }
          title={t("Desktop app {version}", { version: clientVersion })}
        />
      </SettingsGroup>
      {actionError ? (
        <p className="mt-3 px-2 text-[12.5px] text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}
      <ServerUpdateSettings update={update} />
    </>
  );
}
