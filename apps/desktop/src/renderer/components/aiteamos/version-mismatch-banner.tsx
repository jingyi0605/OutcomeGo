import { aiTeamOSCompatibility } from "@aiteamos/contracts/version-compatibility";
import { clientErrorMessage } from "@aiteamos/product-core/redaction";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useServerUpdateStatus } from "../../hooks/use-server-update-status";
import { AITEAMOS_DEEP_LINK_EVENT } from "../../lib/app-deep-links";
import { useI18n } from "../../lib/i18n";
import { requestDesktopUpdateRestart } from "../../lib/desktop-update";

export const VERSION_MISMATCH_TOAST_ID = "aiteamos-version-mismatch";

export function VersionMismatchBanner({ showReview = true }: { showReview?: boolean }) {
  const { t } = useI18n();
  const clientVersion = window.aiteamos?.versions.app ?? "0.0.0";
  const { status, loading, refresh, updateServer } = useServerUpdateStatus(clientVersion);
  const [clientUpdate, setClientUpdate] = useState<AiTeamOSUpdateStatus | null>(null);
  const acting = useRef(false);

  // Toasts outlive their React owner unless explicitly dismissed on sign-out.
  useEffect(
    () => () => {
      toast.dismiss(VERSION_MISMATCH_TOAST_ID);
    },
    []
  );

  useEffect(() => {
    let active = true;
    void window.aiteamos?.updates
      .status()
      .then((next) => active && setClientUpdate(next))
      .catch(() => undefined);
    const unsubscribe = window.aiteamos?.updates.onClientProgress((next) => {
      if (active) setClientUpdate(next);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const compatibility = status
    ? aiTeamOSCompatibility(clientVersion, status.currentVersion, status.apiProtocolVersion, {
        minimumClientVersion: status.minimumClientVersion,
        maximumClientVersionExclusive: status.maximumClientVersionExclusive,
        recommendedClientVersion: status.recommendedClientVersion,
      })
    : null;

  const openUpdates = useCallback(() => {
    const anchor = compatibility === "client-update-required" ? "update-status" : "server-update";
    window.dispatchEvent(
      new CustomEvent(AITEAMOS_DEEP_LINK_EVENT, {
        detail: { url: `aiteamos://app/v1/settings?id=${anchor}` },
      })
    );
  }, [compatibility]);

  const updateDesktop = useCallback(async () => {
    if (!window.aiteamos) throw new Error(t("Desktop updates are unavailable"));
    let update = clientUpdate ?? (await window.aiteamos.updates.status());
    if (update.status === "downloaded") {
      requestDesktopUpdateRestart(update);
      return;
    }
    if (update.status !== "available") {
      update = await window.aiteamos.updates.check();
      setClientUpdate(update);
    }
    if (update.status !== "available") {
      throw new Error(update.message || t("No compatible desktop release is currently published"));
    }
    await window.aiteamos.updates.openDownload();
  }, [clientUpdate, t]);

  const runDirectAction = useCallback(async () => {
    if (!status || !compatibility || compatibility === "unknown" || acting.current) return;
    if (status.status === "updating") {
      openUpdates();
      return;
    }
    acting.current = true;
    toast.loading(t("Starting the compatibility update…"), {
      id: VERSION_MISMATCH_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
    });
    try {
      if (compatibility === "client-update-required") {
        await updateDesktop();
      } else if (status.updaterAvailable) {
        await updateServer(clientVersion);
        await refresh();
      } else {
        const command =
          compatibility === "server-update-required"
            ? `aiteamos update --version ${clientVersion}`
            : "aiteamos update";
        await navigator.clipboard.writeText(command);
        toast.success(t("Server update command copied"), { id: VERSION_MISMATCH_TOAST_ID });
        return;
      }
      toast.success(t("Update started"), { id: VERSION_MISMATCH_TOAST_ID });
    } catch (error) {
      toast.error(t("The update could not be started"), {
        id: VERSION_MISMATCH_TOAST_ID,
        description: clientErrorMessage(error, t("Try again from Update settings")),
        action: { label: t("View updates"), onClick: openUpdates },
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      acting.current = false;
    }
  }, [clientVersion, compatibility, refresh, status, updateDesktop, updateServer, openUpdates, t]);

  useEffect(() => {
    if (loading || !status || !compatibility) return;
    // A local installation version without a live protocol response cannot
    // establish incompatibility. Keep unknown status in Update settings only.
    if (
      compatibility === "unknown" ||
      compatibility === "compatible" ||
      compatibility === "update-recommended"
    ) {
      toast.dismiss(VERSION_MISMATCH_TOAST_ID);
      return;
    }

    const title =
      status.status === "updating"
        ? t("Server update in progress")
        : compatibility === "server-update-required"
          ? t("Server update required")
          : compatibility === "client-update-required"
            ? t("Desktop update required")
            : t("Version compatibility warning");
    const guidance =
      status.status === "updating"
        ? t("{message} The update continues if Desktop closes.", {
            message: status.message ?? t("aiTeamOS is updating the server."),
          })
        : compatibility === "server-update-required"
          ? t(
              "This server cannot support the installed Desktop version. Update the server to continue."
            )
          : compatibility === "client-update-required"
            ? t(
                "This Desktop version is outside the range supported by the server. Update Desktop to continue."
              )
            : t(
                "Desktop could not verify compatibility with this server. Review the available updates."
              );
    const versions = t("Desktop {client} · Server {server}", {
      client: clientVersion,
      server: status.currentVersion ?? t("not reported"),
    });
    const actionLabel =
      status.status === "updating"
        ? t("View progress")
        : compatibility === "client-update-required"
          ? t("Update Desktop")
          : status.updaterAvailable
            ? t("Update server")
            : t("Copy command");

    toast.warning(title, {
      id: VERSION_MISMATCH_TOAST_ID,
      description: `${guidance} ${versions}`,
      duration: Number.POSITIVE_INFINITY,
      action: { label: actionLabel, onClick: () => void runDirectAction() },
      ...(showReview ? { cancel: { label: t("Details"), onClick: openUpdates } } : {}),
    });
  }, [clientVersion, compatibility, loading, runDirectAction, showReview, status, openUpdates, t]);

  return null;
}
