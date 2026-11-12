import type { BusyBotsView } from "@outcomego/contracts";
import { isUpdateBusyMessage } from "@outcomego/contracts/server-updates";
import { CircleCheck, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { API_BASE } from "../../../client/http";
import { useServerUpdate } from "../../../hooks/use-server-update";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import {
  localizeServerUpdateFailure,
  localizeServerUpdateMessage,
  localizedStillWorking,
} from "../../../lib/server-update-message";
import { inSidebarOrder, useSidebarBotOrder } from "../../../lib/sidebar-bot-order";
import { SectionLabel, SettingsGroup, settingsSecondaryButton } from "./ui";
import { ServerUpdateProgressPanel } from "./server-update-progress";

const FAILED = "The server update failed. Try again.";
const BUSY_POLL_MS = 2_000;
const CONFIRM_RESET_MS = 3_000;

const button = settingsSecondaryButton;

/** A button that asks for a second click within 3 s before it acts, as the reference's settings do. */
export function ConfirmButton({
  label,
  pendingLabel,
  pending = false,
  disabled = false,
  onConfirm,
}: {
  label: string;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const reset = window.setTimeout(() => setArmed(false), CONFIRM_RESET_MS);
    return () => window.clearTimeout(reset);
  }, [armed]);
  const confirming = armed && !pending && !disabled;
  return (
    <button
      aria-label={confirming ? t("Click Again to Confirm: {label}", { label }) : label}
      className={cn(
        button,
        confirming && "bg-red-500/15 text-red-600 dark:bg-red-500/20 dark:text-red-400"
      )}
      data-confirming={confirming || undefined}
      disabled={pending || disabled}
      onClick={() => {
        if (pending || disabled) return;
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      type="button"
    >
      {pending && pendingLabel ? pendingLabel : confirming ? t("Click Again to Confirm") : label}
    </button>
  );
}

/** Updates the server, worker and computer together, once no bot is working. */
export function ServerUpdateSettings({
  update: serverUpdate,
}: {
  update: ReturnType<typeof useServerUpdate>;
}) {
  const {
    clientVersion,
    compatibility,
    server,
    serverLoading,
    serverReconnecting,
    serverStartedAt,
    serverObservedAt,
    serverTarget,
    serverNeedsUpdate,
    serverUpdating,
    updateServer,
  } = serverUpdate;
  const { t } = useI18n();
  const sidebarOrder = useSidebarBotOrder();
  const [busyBots, setBusyBots] = useState<BusyBotsView["bots"]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBusy = useCallback(async () => {
    const next = await api.busyBots().catch(() => null);
    if (next) setBusyBots(next.bots);
    return next?.bots ?? [];
  }, []);

  const pending = serverNeedsUpdate && !serverUpdating;
  useEffect(() => {
    if (!pending) return;
    void refreshBusy();
    const interval = window.setInterval(() => void refreshBusy(), BUSY_POLL_MS);
    return () => window.clearInterval(interval);
  }, [pending, refreshBusy]);

  const updating = starting || serverUpdating;
  const knownVersion = Boolean(server?.currentVersion);
  const state =
    !server || serverLoading
      ? "loading"
      : updating
        ? "updating"
        : serverReconnecting ||
            !knownVersion ||
            compatibility === "unknown" ||
            (serverNeedsUpdate && !server.updaterAvailable) ||
            (!serverNeedsUpdate && server.status === "error")
          ? "unavailable"
          : !serverNeedsUpdate && server.status !== "error"
            ? "up-to-date"
            : busyBots.length > 0
              ? "busy"
              : "ready";
  const busyInOrder = state === "busy" ? inSidebarOrder(busyBots, sidebarOrder) : [];
  const stopTarget = busyInOrder[0];

  const update = async () => {
    setError(null);
    setStarting(true);
    try {
      // The card can lag the server by a poll; never start over a turn that just began.
      if ((await refreshBusy()).length > 0) return;
      await updateServer();
    } catch (cause) {
      setError(localizeServerUpdateFailure(cause, t(FAILED)));
    } finally {
      setStarting(false);
    }
  };

  const stop = async (botId: string) => {
    setStopping(true);
    try {
      await api.stopBot(botId).catch(() => undefined);
      await refreshBusy();
    } finally {
      setStopping(false);
    }
  };

  const failure = error ?? (server?.status === "error" ? server.message : null);
  // Known pipeline text is translated; anything else stays as the server reported it.
  const failureText = failure ? (localizeServerUpdateMessage(failure) ?? failure) : null;
  const extraCopy =
    state === "loading" ? (
      t("Checking the connected server…")
    ) : state === "busy" ? (
      t("{status}. Update will be available when every agent is done.", {
        status: localizedStillWorking(busyInOrder.map((bot) => bot.name)),
      })
    ) : state === "updating" ? (
      (localizeServerUpdateMessage(server?.message) ?? t("Updating the server…"))
    ) : state === "unavailable" ? (
      serverReconnecting ? (
        t("Could not reach the server. Reconnecting automatically.")
      ) : (
        (localizeServerUpdateMessage(server?.message) ??
        t("Could not verify the server update status. Check for updates again."))
      )
    ) : failure && state !== "up-to-date" ? (
      isUpdateBusyMessage(failure) ? (
        (failureText ?? t(FAILED))
      ) : (
        <>
          {t(FAILED)}
          <span className="block text-foreground-tertiary">{failureText}</span>
        </>
      )
    ) : state === "ready" && serverTarget ? (
      t("Update to {version} is available.", { version: serverTarget })
    ) : null;

  const updateButton = (
    <ConfirmButton
      disabled={state !== "ready"}
      label={t("Update")}
      onConfirm={() => void update()}
      pending={state === "updating"}
      pendingLabel={t("Updating…")}
    />
  );

  return (
    <>
      <SectionLabel>{t("Connected server")}</SectionLabel>
      <SettingsGroup>
        <div
          className="min-h-[52px] py-2"
          data-settings-anchor="server-update"
          data-update-state={state}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Server aria-hidden className="size-4 shrink-0 self-start mt-1 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-5 text-foreground">
                {t("Server {version}", { version: server?.currentVersion ?? t("version unknown") })}
              </div>
              <div className="mt-px text-[12px] leading-4 text-foreground-secondary">
                {new URL(API_BASE).host}
              </div>
              {extraCopy && state !== "updating" ? (
                <div
                  aria-live="polite"
                  className="mt-px max-w-[440px] text-[12px] leading-4 text-foreground-secondary"
                >
                  {extraCopy}
                </div>
              ) : null}
              {state === "up-to-date" ? (
                <div
                  className="mt-2 flex items-center gap-1.5 text-[12px] text-foreground-secondary"
                  role="status"
                >
                  <CircleCheck aria-hidden className="size-3.5" />
                  {compatibility === "client-update-required"
                    ? t("Update the desktop app to match this server.")
                    : compatibility === "update-recommended"
                      ? t("This server is newer than the installed desktop.")
                      : t("Your server matches desktop {version}.", { version: clientVersion })}
                </div>
              ) : null}
            </div>
            {state === "up-to-date" || state === "updating" ? null : (
              <div className="flex shrink-0 items-center gap-2">
                {stopTarget ? (
                  <ConfirmButton
                    key={stopTarget.botId}
                    label={t("Stop {name}", { name: stopTarget.name })}
                    onConfirm={() => void stop(stopTarget.botId)}
                    pending={stopping}
                  />
                ) : null}
                {updateButton}
              </div>
            )}
          </div>
          {state === "updating" ? (
            <ServerUpdateProgressPanel
              phase={starting ? "checking" : (server?.phase ?? null)}
              message={server?.message ?? null}
              reconnecting={serverReconnecting}
              safeToClose={server?.safeToCloseDesktop ?? false}
              startedAt={serverStartedAt}
              observedAt={serverObservedAt}
            />
          ) : null}
        </div>
      </SettingsGroup>
    </>
  );
}
