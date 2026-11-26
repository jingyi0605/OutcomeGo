import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  HardDrive,
  Play,
  RotateCw,
  ScrollText,
  Square,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  changeServer as forgetServer,
  clearAuthCredentialsForServerChange,
  testServerConnection,
} from "../../../client/auth";
import { API_BASE } from "../../../client/http";
import { saveConfiguredApiBase } from "../../../client/runtime-url";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import type { LocalServerStatus } from "../../../lib/local-deploy-contract";
import {
  canDeleteLocalData,
  isLocalServer,
  serverStateLabel,
} from "../../../lib/server-location";
import { serverAddressProblem } from "../../../lib/server-address";
import { reloadInto } from "../first-run-shell";
import { AutostartSection } from "./local-service/autostart-section";
import { ContainersPanel } from "./local-service/containers-panel";
import { IconActionButton } from "./local-service/icon-action-button";
import { ProxySection } from "./local-service/proxy-section";
import { ResourcesSection } from "./local-service/resources-section";
import { SectionLabel, SettingsGroup, settingsInput, settingsSecondaryButton } from "./ui";

const engineKindLabel = (kind: string | undefined): string => {
  if (kind === "managed-wsl") return "Managed WSL 2";
  if (kind === "managed-lima") return "Managed Lima VM";
  if (kind === "external") return "External Docker Engine";
  return "Local container engine";
};

const stackDotClass = (state: LocalServerStatus["stack"]["state"] | undefined): string => {
  if (state === "running") return "bg-emerald-500";
  if (state === "starting" || state === "updating") return "bg-amber-500";
  if (state === "unhealthy") return "bg-red-500";
  return "bg-foreground-tertiary";
};

export default function ServerLocationSettings() {
  const { t } = useI18n();
  const bridge = window.outcomego?.localServer;
  const [snapshot, setSnapshot] = useState<LocalServerStatus>();
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<"remove" | "switch" | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [word, setWord] = useState("");

  const refreshStatus = useCallback(async () => {
    if (!bridge?.status) return;
    try {
      const value = await bridge.status();
      setSnapshot(value);
    } catch {
      setIssue(true);
    }
  }, [bridge]);

  useEffect(() => {
    let current = true;
    void bridge?.status?.().then((value) => {
      if (current) setSnapshot(value);
    }).catch(() => {
      if (current) setIssue(true);
    });
    return () => {
      current = false;
    };
  }, [bridge]);

  if (!bridge?.status || !["win32", "darwin"].includes(window.outcomego?.platform ?? "")) return null;
  const local = isLocalServer(API_BASE, snapshot?.apiPort ?? null);
  const state = snapshot?.stack.state;
  const working = busy || state === "starting" || state === "removing" || state === "updating";
  const engineKind = snapshot?.engine?.engine?.kind;
  const installed = Boolean(local && state && state !== "not-installed");

  const run = async (operation: () => Promise<LocalServerStatus>) => {
    if (working) return;
    setBusy(true);
    setIssue(false);
    try {
      setSnapshot(await operation());
      setMode(null);
    } catch {
      setIssue(true);
    } finally {
      setBusy(false);
    }
  };

  const changeServer = async (value: string) => {
    if (working || !value.trim()) return;
    setBusy(true);
    setIssue(false);
    try {
      if (serverAddressProblem(value)) throw new Error();
      const connection = await testServerConnection(value);
      await clearAuthCredentialsForServerChange();
      saveConfiguredApiBase(localStorage, connection.baseUrl);
      reloadInto(connection.baseUrl);
    } catch {
      setIssue(true);
    } finally {
      setBusy(false);
    }
  };

  const copyDiagnostics = async () => {
    if (!bridge.diagnostics) return;
    try {
      const text = await bridge.diagnostics();
      await navigator.clipboard.writeText(text);
      setCopiedDiag(true);
      setTimeout(() => setCopiedDiag(false), 2000);
    } catch {
      setIssue(true);
    }
  };

  const remove = (purgeData: boolean) =>
    run(async () => {
      const next = await bridge.remove({ purgeData });
      await forgetServer();
      return next;
    });

  const subtitle = [
    state ? t(serverStateLabel(state)) : t("Checking server…"),
    local && engineKind ? t(engineKindLabel(engineKind)) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label={t(local ? "Local service management" : "Server location")}
      className="my-7"
      data-settings-anchor="local-services"
    >
      <SectionLabel>{t(local ? "Local service management" : "Server location")}</SectionLabel>
      <SettingsGroup>
        <div className="flex min-h-[54px] items-center justify-between gap-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", stackDotClass(state))} />
              <span className="truncate text-[13px] font-medium text-foreground">
                {t(local ? "On this computer" : "Remote server")}
              </span>
            </div>
            <div className="mt-0.5 truncate pl-4 text-[12px] text-foreground-secondary">
              {subtitle}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {installed ? (
              <>
                <IconActionButton
                  disabled={working}
                  icon={
                    state === "running" ? (
                      <Square className="fill-current" size={11} />
                    ) : (
                      <Play className="fill-current" size={12} />
                    )
                  }
                  label={t(state === "running" ? "Stop local services" : "Start local services")}
                  onClick={() => void run(state === "running" ? bridge.stop : bridge.start)}
                  variant={state === "running" ? "danger" : "default"}
                />
                {bridge.restart ? (
                  <IconActionButton
                    disabled={working || (state !== "running" && state !== "unhealthy")}
                    icon={<RotateCw className={working ? "animate-spin" : ""} size={14} />}
                    label={t("Restart local services")}
                    onClick={() => void run(() => bridge.restart!())}
                  />
                ) : null}
                {bridge.openLogsFolder ? (
                  <IconActionButton
                    disabled={working}
                    icon={<ScrollText size={14} />}
                    label={t("Open logs folder")}
                    onClick={() => void bridge.openLogsFolder?.()}
                  />
                ) : null}
                <IconActionButton
                  disabled={working}
                  icon={copiedDiag ? <Check size={14} /> : <Stethoscope size={14} />}
                  label={t(copiedDiag ? "Copied" : "Copy diagnostics")}
                  onClick={() => void copyDiagnostics()}
                />
              </>
            ) : null}

            <IconActionButton
              active={mode === "switch"}
              disabled={working}
              icon={<ArrowRightLeft size={14} />}
              label={t("Switch server")}
              onClick={() => setMode(mode === "switch" ? null : "switch")}
            />

            {installed ? (
              <IconActionButton
                active={mode === "remove"}
                disabled={working}
                icon={<Trash2 size={14} />}
                label={t("Remove local services")}
                onClick={() => {
                  setMode(mode === "remove" ? null : "remove");
                  setPermanent(false);
                  setWord("");
                }}
                variant="danger"
              />
            ) : null}
          </div>
        </div>

        {mode === "switch" ? (
          <form
            className="flex items-center gap-2 border-t border-black/[0.065] py-2.5 dark:border-white/[0.07]"
            onSubmit={(event) => {
              event.preventDefault();
              void changeServer(address);
            }}
          >
            {!local && snapshot?.apiPort && snapshot.stack.state === "running" ? (
              <IconActionButton
                disabled={working}
                icon={<HardDrive size={13} />}
                label={t("Use local server")}
                onClick={() => void changeServer(`http://127.0.0.1:${snapshot.apiPort}`)}
              />
            ) : null}
            <input
              aria-label={t("Server address")}
              className={`${settingsInput} flex-1`}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://example.com"
              value={address}
            />
            <IconActionButton
              disabled={working || !address.trim()}
              icon={<ArrowRight size={13} />}
              label={t("Connect")}
              type="submit"
              variant="primary"
            />
            <IconActionButton
              icon={<X size={13} />}
              label={t("Cancel")}
              onClick={() => setMode(null)}
            />
          </form>
        ) : null}

        {mode === "remove" && local ? (
          <div className="space-y-2.5 border-t border-black/[0.065] py-3 text-[12px] dark:border-white/[0.07]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-foreground-secondary">
                <input
                  checked={permanent}
                  onChange={(event) => setPermanent(event.target.checked)}
                  type="checkbox"
                />
                <span>{t("Permanently delete local data")}</span>
              </label>
              <div className="flex items-center gap-1.5">
                {!permanent ? (
                  <button
                    className={settingsSecondaryButton}
                    disabled={working}
                    onClick={() => void remove(false)}
                    type="button"
                  >
                    {t("Remove services and keep data")}
                  </button>
                ) : null}
                <IconActionButton
                  icon={<X size={13} />}
                  label={t("Cancel")}
                  onClick={() => setMode(null)}
                />
              </div>
            </div>
            {permanent ? (
              <div className="flex items-center gap-2">
                <input
                  aria-label={t("This cannot be undone. Type DELETE to confirm.")}
                  className={`${settingsInput} flex-1`}
                  id="remove-local-confirmation"
                  onChange={(event) => setWord(event.target.value)}
                  placeholder={t("This cannot be undone. Type DELETE to confirm.")}
                  value={word}
                />
                <IconActionButton
                  disabled={working || !canDeleteLocalData(permanent, word)}
                  icon={<Trash2 size={13} />}
                  label={t("Permanently delete local data")}
                  onClick={() => void remove(true)}
                  variant="danger"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsGroup>

      {issue ? (
        <p className="mt-2 px-2 text-[12px] text-red-600 dark:text-red-400" role="alert">
          {t("The local service operation did not finish.")}
        </p>
      ) : null}

      {installed ? (
        <>
          <ContainersPanel
            busy={working}
            onAfterRestart={() => void refreshStatus()}
            onStartStack={() => void run(bridge.start)}
            stackState={state}
          />
          <AutostartSection busy={working} />
          <ResourcesSection busy={working} onApplied={() => void refreshStatus()} />
          <ProxySection
            busy={working}
            engineKind={engineKind}
            onApplied={() => void refreshStatus()}
          />
        </>
      ) : null}
    </section>
  );
}
