import {
  ArrowRightLeft,
  Check,
  Copy,
  FolderOpen,
  HardDrive,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  changeServer as forgetServer,
  clearAuthCredentialsForServerChange,
  testServerConnection,
} from "../../../client/auth";
import { API_BASE } from "../../../client/http";
import { saveConfiguredApiBase } from "../../../client/runtime-url";
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
import { ProxySection } from "./local-service/proxy-section";
import { ResourcesSection } from "./local-service/resources-section";
import { SectionLabel, SettingsGroup, SettingsRow, settingsInput, settingsSecondaryButton } from "./ui";

const engineKindLabel = (kind: string | undefined): string => {
  if (kind === "managed-wsl") return "Managed WSL 2";
  if (kind === "managed-lima") return "Managed Lima VM";
  if (kind === "external") return "External Docker Engine";
  return "Local container engine";
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

  const overviewMeta = [
    engineKind ? t(engineKindLabel(engineKind)) : null,
    snapshot?.version ? `v${snapshot.version}` : null,
    snapshot?.apiPort ? `${t("Port")} ${snapshot.apiPort}` : null,
    snapshot?.directory ? snapshot.directory : null,
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
        <SettingsRow
          title={t(local ? "On this computer" : "Remote server")}
          description={
            <div className="space-y-0.5">
              <div>{state ? t(serverStateLabel(state)) : t("Checking server…")}</div>
              {local && overviewMeta ? (
                <div className="truncate font-mono text-[11px] text-foreground-tertiary">
                  {overviewMeta}
                </div>
              ) : null}
            </div>
          }
          control={
            <button
              className={settingsSecondaryButton}
              disabled={working}
              onClick={() => setMode(mode === "switch" ? null : "switch")}
              type="button"
            >
              <ArrowRightLeft size={14} />
              {t("Switch server")}
            </button>
          }
        />
        {local && state && state !== "not-installed" ? (
          <SettingsRow
            title={t("Local services")}
            control={
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className={settingsSecondaryButton}
                  disabled={working}
                  onClick={() => void run(state === "running" ? bridge.stop : bridge.start)}
                  type="button"
                >
                  {state === "running" ? <Square size={14} /> : <Play size={14} />}
                  {t(state === "running" ? "Stop local services" : "Start local services")}
                </button>
                {bridge.restart ? (
                  <button
                    className={settingsSecondaryButton}
                    disabled={working || (state !== "running" && state !== "unhealthy")}
                    onClick={() => void run(() => bridge.restart!())}
                    type="button"
                  >
                    <RotateCw size={14} />
                    {t("Restart local services")}
                  </button>
                ) : null}
                {bridge.openLogsFolder ? (
                  <button
                    className={settingsSecondaryButton}
                    disabled={working}
                    onClick={() => void bridge.openLogsFolder?.()}
                    type="button"
                  >
                    <FolderOpen size={14} />
                    {t("Open logs folder")}
                  </button>
                ) : null}
                <button
                  className={settingsSecondaryButton}
                  disabled={working}
                  onClick={() => void copyDiagnostics()}
                  type="button"
                >
                  {copiedDiag ? <Check size={14} /> : <Copy size={14} />}
                  {t(copiedDiag ? "Copied" : "Copy diagnostics")}
                </button>
                <button
                  className={settingsSecondaryButton}
                  disabled={working}
                  onClick={() => {
                    setMode("remove");
                    setPermanent(false);
                    setWord("");
                  }}
                  type="button"
                >
                  <Trash2 size={14} />
                  {t("Remove local services")}
                </button>
              </div>
            }
          />
        ) : null}
      </SettingsGroup>

      {mode === "switch" ? (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void changeServer(address);
          }}
        >
          {!local && snapshot?.apiPort && snapshot.stack.state === "running" ? (
            <button
              className={settingsSecondaryButton}
              disabled={working}
              onClick={() => void changeServer(`http://127.0.0.1:${snapshot.apiPort}`)}
              type="button"
            >
              <HardDrive size={14} />
              {t("Use local server")}
            </button>
          ) : null}
          <input
            aria-label={t("Server address")}
            className={settingsInput}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="https://example.com"
            value={address}
          />
          <button
            className={settingsSecondaryButton}
            disabled={working || !address.trim()}
            type="submit"
          >
            {t("Connect")}
          </button>
        </form>
      ) : null}

      {mode === "remove" && local ? (
        <div className="mt-3 flex flex-col items-start gap-2">
          <button
            className={settingsSecondaryButton}
            disabled={working}
            onClick={() => void remove(false)}
            type="button"
          >
            {t("Remove services and keep data")}
          </button>
          <label>
            <input
              checked={permanent}
              onChange={(event) => setPermanent(event.target.checked)}
              type="checkbox"
            />{" "}
            {t("Permanently delete local data")}
          </label>
          {permanent ? (
            <>
              <label htmlFor="remove-local-confirmation">
                {t("This cannot be undone. Type DELETE to confirm.")}
              </label>
              <input
                className={settingsInput}
                id="remove-local-confirmation"
                onChange={(event) => setWord(event.target.value)}
                value={word}
              />
              <button
                className={settingsSecondaryButton}
                disabled={working || !canDeleteLocalData(permanent, word)}
                onClick={() => void remove(true)}
                type="button"
              >
                {t("Permanently delete local data")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {mode ? (
        <button
          className={`${settingsSecondaryButton} mt-2`}
          onClick={() => setMode(null)}
          type="button"
        >
          {t("Cancel")}
        </button>
      ) : null}

      {issue ? (
        <p className="mt-2 text-sm" role="alert">
          {t("The local service operation did not finish.")}
        </p>
      ) : null}

      {local && state && state !== "not-installed" ? (
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
