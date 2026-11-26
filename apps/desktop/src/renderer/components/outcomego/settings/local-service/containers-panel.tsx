import {
  ChevronDown,
  ChevronRight,
  FileText,
  Play,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../../lib/cn";
import { useI18n } from "../../../../lib/i18n";
import type {
  LocalContainerInfo,
  LocalContainersSnapshot,
} from "../../../../lib/local-deploy-contract";
import { SectionLabel, SettingsGroup, settingsSecondaryButton } from "../ui";
import { ContainerLogsDialog } from "./container-logs-dialog";

const POLL_INTERVAL_MS = 5_000;

export const formatCompactBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const gib = 1024 ** 3;
  const mib = 1024 ** 2;
  const kib = 1024;
  if (bytes >= gib) return `${(bytes / gib).toFixed(bytes >= 10 * gib ? 1 : 2)} GiB`;
  if (bytes >= mib) return `${(bytes / mib).toFixed(bytes >= 100 * mib ? 0 : 1)} MiB`;
  if (bytes >= kib) return `${Math.round(bytes / kib)} KiB`;
  return `${bytes} B`;
};

const statusDotClass = (container: LocalContainerInfo): string => {
  if (container.state === "running") {
    if (container.health === "unhealthy") return "bg-red-500";
    if (container.health === "starting") return "bg-amber-500";
    return "bg-emerald-500";
  }
  if (container.state === "restarting") return "bg-amber-500";
  if (container.state === "exited" && container.exitCode === 0) return "bg-foreground-tertiary";
  return "bg-red-500";
};

export function ContainersPanel({
  stackState,
  busy,
  onStartStack,
  onAfterRestart,
}: {
  stackState: string | undefined;
  busy: boolean;
  onStartStack: () => void;
  onAfterRestart: () => void;
}) {
  const { t } = useI18n();
  const bridge = window.outcomego?.localServer;
  const [snapshot, setSnapshot] = useState<LocalContainersSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [restartingService, setRestartingService] = useState<string | null>(null);
  const [confirmComputerRestart, setConfirmComputerRestart] = useState(false);
  const [showInit, setShowInit] = useState(false);
  const [logsService, setLogsService] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const loadContainers = useCallback(
    async (withFastFirstPass: boolean) => {
      if (!bridge?.containers || inFlightRef.current) return;
      inFlightRef.current = true;
      setError(null);
      try {
        if (withFastFirstPass) {
          setLoading(true);
          const basic = await bridge.containers({ includeStats: false });
          if (!mountedRef.current) return;
          setSnapshot(basic);
          setLoading(false);
          if (!basic.engineRunning || basic.containers.length === 0) return;
        }
        setStatsLoading(true);
        const full = await bridge.containers({ includeStats: true });
        if (!mountedRef.current) return;
        setSnapshot(full);
      } catch {
        if (mountedRef.current) {
          setError(t("Unable to inspect local containers."));
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setStatsLoading(false);
        }
        inFlightRef.current = false;
      }
    },
    [bridge, t]
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadContainers(true);
    return () => {
      mountedRef.current = false;
    };
  }, [loadContainers, stackState]);

  useEffect(() => {
    const shouldPoll = stackState === "running" || stackState === "starting" || stackState === "unhealthy";
    if (!shouldPoll || !bridge?.containers) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const stopTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const startTimer = () => {
      stopTimer();
      if (document.visibilityState !== "visible") return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible" && !restartingService) {
          void loadContainers(false);
        }
      }, POLL_INTERVAL_MS);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadContainers(false);
        startTimer();
      } else {
        stopTimer();
      }
    };

    startTimer();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [bridge, loadContainers, restartingService, stackState]);

  const coreContainers = useMemo(
    () => (snapshot?.containers ?? []).filter((item) => item.role === "core"),
    [snapshot]
  );
  const initContainers = useMemo(
    () => (snapshot?.containers ?? []).filter((item) => item.role === "init"),
    [snapshot]
  );

  const executeRestart = async (service: string) => {
    if (!bridge?.restart || restartingService || busy) return;
    setConfirmComputerRestart(false);
    setRestartingService(service);
    setError(null);
    try {
      await bridge.restart(service);
      onAfterRestart();
      await loadContainers(false);
    } catch {
      setError(t("Failed to restart {service}.", { service }));
    } finally {
      if (mountedRef.current) setRestartingService(null);
    }
  };

  if (!bridge?.containers) return null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between px-2">
        <SectionLabel>{t("Containers")}</SectionLabel>
        <button
          className={settingsSecondaryButton}
          disabled={loading || statsLoading}
          onClick={() => void loadContainers(false)}
          type="button"
        >
          <RefreshCw className={loading || statsLoading ? "animate-spin" : ""} size={13} />
          {t("Refresh")}
        </button>
      </div>

      <SettingsGroup>
        {loading && !snapshot ? (
          <div className="py-4 text-[12px] text-foreground-secondary">
            {t("Inspecting local containers…")}
          </div>
        ) : snapshot && !snapshot.engineRunning ? (
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="text-[12px] text-foreground-secondary">
              {t("The local container engine is stopped. Start local services to view container metrics and logs.")}
            </div>
            <button
              className={settingsSecondaryButton}
              disabled={busy}
              onClick={onStartStack}
              type="button"
            >
              <Play size={13} />
              {t("Start local services")}
            </button>
          </div>
        ) : coreContainers.length === 0 ? (
          <div className="py-4 text-[12px] text-foreground-secondary">
            {t("No OutcomeGo containers are currently created.")}
          </div>
        ) : (
          <div className="divide-y divide-black/[0.065] dark:divide-white/[0.07]">
            {coreContainers.map((item) => {
              const isRestartingThis = restartingService === item.service;
              return (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={item.containerName}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("size-2 shrink-0 rounded-full", statusDotClass(item))} />
                      <span className="text-[13px] font-medium text-foreground">{item.service}</span>
                      <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[11px] text-foreground-secondary dark:bg-white/[0.09]">
                        {item.state}
                      </span>
                      {item.health !== "none" ? (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[11px]",
                            item.health === "healthy"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : item.health === "unhealthy"
                                ? "bg-red-500/15 text-red-700 dark:text-red-300"
                                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          )}
                        >
                          {item.health}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-foreground-secondary">
                      <span>{item.statusText}</span>
                      {item.stats ? (
                        <span className="font-mono">
                          CPU {item.stats.cpuPercent.toFixed(1)}% · {t("Memory")}{" "}
                          {formatCompactBytes(item.stats.memoryUsageBytes)} /{" "}
                          {formatCompactBytes(item.stats.memoryLimitBytes)} (
                          {item.stats.memoryPercent.toFixed(1)}%)
                        </span>
                      ) : item.state === "running" && statsLoading ? (
                        <span>{t("Loading metrics…")}</span>
                      ) : null}
                    </div>
                    {item.image ? (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-foreground-tertiary">
                        {item.image}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.restartable && bridge.restart ? (
                      <button
                        className={settingsSecondaryButton}
                        disabled={busy || Boolean(restartingService)}
                        onClick={() => {
                          if (item.service === "computer") {
                            setConfirmComputerRestart(true);
                          } else {
                            void executeRestart(item.service);
                          }
                        }}
                        type="button"
                      >
                        <RotateCw className={isRestartingThis ? "animate-spin" : ""} size={13} />
                        {t(isRestartingThis ? "Restarting…" : "Restart")}
                      </button>
                    ) : null}
                    {bridge.logs ? (
                      <button
                        className={settingsSecondaryButton}
                        onClick={() => setLogsService(item.service)}
                        type="button"
                      >
                        <FileText size={13} />
                        {t("View logs")}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {confirmComputerRestart ? (
          <div className="border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
            <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3 text-[12px]">
              <p className="text-foreground">
                {t(
                  "Restarting computer will also recreate computer-memory-init and interrupt any active tasks or browser sessions."
                )}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  className={settingsSecondaryButton}
                  disabled={busy || Boolean(restartingService)}
                  onClick={() => void executeRestart("computer")}
                  type="button"
                >
                  {t("Confirm restart")}
                </button>
                <button
                  className={settingsSecondaryButton}
                  onClick={() => setConfirmComputerRestart(false)}
                  type="button"
                >
                  {t("Cancel")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {initContainers.length > 0 ? (
          <div className="border-t border-black/[0.065] py-2 dark:border-white/[0.07]">
            <button
              className="flex w-full items-center gap-1.5 py-1 text-left text-[12px] text-foreground-secondary hover:text-foreground"
              onClick={() => setShowInit((prev) => !prev)}
              type="button"
            >
              {showInit ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>
                {t("One-time initialization tasks ({count})", { count: initContainers.length })}
              </span>
            </button>
            {showInit ? (
              <div className="mt-1 divide-y divide-black/[0.05] pl-4 dark:divide-white/[0.05]">
                {initContainers.map((item) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]"
                    key={item.containerName}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("size-1.5 rounded-full", statusDotClass(item))} />
                        <span className="font-medium text-foreground">{item.service}</span>
                        <span className="text-[11px] text-foreground-secondary">
                          {item.statusText}
                          {item.exitCode !== null ? ` (exit ${item.exitCode})` : ""}
                        </span>
                      </div>
                    </div>
                    {bridge.logs ? (
                      <button
                        className={settingsSecondaryButton}
                        onClick={() => setLogsService(item.service)}
                        type="button"
                      >
                        <FileText size={13} />
                        {t("View logs")}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsGroup>

      {error ? (
        <p className="mt-2 px-2 text-[12px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <ContainerLogsDialog
        onOpenChange={(open) => {
          if (!open) setLogsService(null);
        }}
        open={logsService !== null}
        service={logsService}
      />
    </div>
  );
}
