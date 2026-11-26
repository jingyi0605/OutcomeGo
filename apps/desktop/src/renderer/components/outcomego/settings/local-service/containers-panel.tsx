import {
  Check,
  FileText,
  Play,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../../lib/cn";
import { useI18n } from "../../../../lib/i18n";
import type {
  LocalContainerInfo,
  LocalContainersSnapshot,
} from "../../../../lib/local-deploy-contract";
import {
  formatFriendlyBytes,
  formatGigabytes,
  formatMegabytes,
} from "../../../../lib/server-location";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/tooltip";
import { SectionLabel, SettingsGroup } from "../ui";
import { ContainerLogsDialog } from "./container-logs-dialog";
import { IconActionButton } from "./icon-action-button";

const POLL_INTERVAL_MS = 5_000;

export const formatCompactBytes = formatFriendlyBytes;

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

const containerStateLabel = (state: LocalContainerInfo["state"]): string => {
  if (state === "running") return "Running";
  if (state === "restarting") return "Restarting";
  if (state === "exited") return "Stopped";
  if (state === "paused") return "Paused";
  if (state === "created") return "Not started";
  if (state === "dead") return "Container error";
  return "Unknown";
};

const containerHealthLabel = (health: LocalContainerInfo["health"]): string | null => {
  if (health === "healthy") return "Healthy";
  if (health === "unhealthy") return "Unhealthy";
  if (health === "starting") return "Starting";
  return null;
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
  const [logsService, setLogsService] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadContainers = useCallback(
    async (allowFastFirstPass: boolean) => {
      if (!bridge?.containers || inFlightRef.current) return;
      inFlightRef.current = true;
      setError(null);
      try {
        if (allowFastFirstPass && !hasSnapshotRef.current) {
          setLoading(true);
          const basic = await bridge.containers({ includeStats: false });
          if (!mountedRef.current) return;
          hasSnapshotRef.current = true;
          setSnapshot(basic);
          setLoading(false);
          if (!basic.engineRunning || basic.containers.length === 0) return;
        }
        setStatsLoading(true);
        const full = await bridge.containers({ includeStats: true });
        if (!mountedRef.current) return;
        hasSnapshotRef.current = true;
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
    void loadContainers(!hasSnapshotRef.current);
  }, [loadContainers, stackState]);

  useEffect(() => {
    const shouldPoll =
      stackState === "running" || stackState === "starting" || stackState === "unhealthy";
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

  const summary = useMemo(() => {
    let cpuPercent = 0;
    let memoryUsageBytes = 0;
    let diskUsageBytes = 0;
    let hasStats = false;
    let hasDisk = false;
    for (const item of coreContainers) {
      if (item.stats) {
        hasStats = true;
        cpuPercent += item.stats.cpuPercent;
        memoryUsageBytes += item.stats.memoryUsageBytes;
      }
      if (typeof item.diskUsageBytes === "number") {
        hasDisk = true;
        diskUsageBytes += item.diskUsageBytes;
      }
    }
    return { cpuPercent, memoryUsageBytes, diskUsageBytes, hasStats, hasDisk };
  }, [coreContainers]);

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
        <IconActionButton
          disabled={loading || statsLoading}
          icon={<RefreshCw className={loading || statsLoading ? "animate-spin" : ""} size={13} />}
          label={t("Refresh")}
          onClick={() => void loadContainers(false)}
        />
      </div>

      <SettingsGroup>
        {loading && !snapshot ? (
          <div className="py-3.5 text-[12px] text-foreground-secondary">
            {t("Inspecting local containers…")}
          </div>
        ) : snapshot && !snapshot.engineRunning ? (
          <div className="flex items-center justify-between gap-3 py-3">
            <span className="text-[12px] text-foreground-secondary">{t("Stopped")}</span>
            <IconActionButton
              disabled={busy}
              icon={<Play size={13} />}
              label={t("Start local services")}
              onClick={onStartStack}
              variant="primary"
            />
          </div>
        ) : coreContainers.length === 0 ? (
          <div className="py-3.5 text-[12px] text-foreground-secondary">
            {t("No OutcomeGo containers are currently created.")}
          </div>
        ) : (
          <>
            <div className="divide-y divide-black/[0.065] dark:divide-white/[0.07]">
              {coreContainers.map((item) => {
                const isRestartingThis = restartingService === item.service;
                const healthLabel = containerHealthLabel(item.health);
                const memPercent = item.stats
                  ? Math.max(0, Math.min(100, item.stats.memoryPercent))
                  : 0;
                const cpuText = item.stats ? `${item.stats.cpuPercent.toFixed(1)}%` : "--";
                const memText = item.stats ? formatMegabytes(item.stats.memoryUsageBytes) : "--";
                const diskText =
                  typeof item.diskUsageBytes === "number"
                    ? formatGigabytes(item.diskUsageBytes)
                    : "--";

                return (
                  <div
                    className="flex items-center justify-between gap-3 py-2.5"
                    key={item.containerName}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className={cn("size-2 shrink-0 rounded-full", statusDotClass(item))} />
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {item.service}
                      </span>
                      <span className="shrink-0 rounded-md bg-black/[0.055] px-1.5 py-0.5 text-[11px] text-foreground-secondary dark:bg-white/[0.08]">
                        {t(containerStateLabel(item.state))}
                      </span>
                      {healthLabel ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-md px-1.5 py-0.5 text-[11px]",
                            item.health === "healthy"
                              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                              : item.health === "unhealthy"
                                ? "bg-red-500/12 text-red-700 dark:text-red-300"
                                : "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                          )}
                        >
                          {t(healthLabel)}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="flex items-center gap-2.5 text-[11px] tabular-nums">
                        <span className="w-[66px] text-right">
                          <span className="text-foreground-tertiary">{t("CPU")} </span>
                          <span className="text-foreground-secondary">{cpuText}</span>
                        </span>

                        {item.stats ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="w-[82px] cursor-default text-right">
                                <span className="text-foreground-tertiary">{t("Memory")} </span>
                                <span className="text-foreground-secondary">{memText}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("Memory")}: {formatMegabytes(item.stats.memoryUsageBytes)} /{" "}
                              {formatFriendlyBytes(item.stats.memoryLimitBytes)} (
                              {memPercent.toFixed(1)}%)
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="w-[82px] text-right">
                            <span className="text-foreground-tertiary">{t("Memory")} </span>
                            <span className="text-foreground-secondary">{memText}</span>
                          </span>
                        )}

                        <span className="w-[84px] text-right">
                          <span className="text-foreground-tertiary">{t("Disk")} </span>
                          <span className="text-foreground-secondary">{diskText}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {item.restartable && bridge.restart ? (
                          <IconActionButton
                            disabled={busy || Boolean(restartingService)}
                            icon={
                              <RotateCw className={isRestartingThis ? "animate-spin" : ""} size={13} />
                            }
                            label={t(isRestartingThis ? "Restarting…" : "Restart")}
                            onClick={() => {
                              if (item.service === "computer") {
                                setConfirmComputerRestart(true);
                              } else {
                                void executeRestart(item.service);
                              }
                            }}
                          />
                        ) : null}
                        {bridge.logs ? (
                          <IconActionButton
                            icon={<FileText size={13} />}
                            label={t("View logs")}
                            onClick={() => setLogsService(item.service)}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-black/[0.065] py-2 text-[11px] tabular-nums dark:border-white/[0.07]">
              <span className="pl-4 font-medium text-foreground-secondary">{t("Total")}</span>
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-[66px] text-right">
                    <span className="text-foreground-tertiary">{t("CPU")} </span>
                    <span className="font-medium text-foreground">
                      {summary.hasStats ? `${summary.cpuPercent.toFixed(1)}%` : "--"}
                    </span>
                  </span>
                  <span className="w-[82px] text-right">
                    <span className="text-foreground-tertiary">{t("Memory")} </span>
                    <span className="font-medium text-foreground">
                      {summary.hasStats ? formatMegabytes(summary.memoryUsageBytes) : "--"}
                    </span>
                  </span>
                  <span className="w-[84px] text-right">
                    <span className="text-foreground-tertiary">{t("Disk")} </span>
                    <span className="font-medium text-foreground">
                      {summary.hasDisk ? formatGigabytes(summary.diskUsageBytes) : "--"}
                    </span>
                  </span>
                </div>
                <div aria-hidden="true" className="w-[62px] shrink-0" />
              </div>
            </div>
          </>
        )}

        {confirmComputerRestart ? (
          <div className="flex items-center justify-between gap-3 border-t border-black/[0.065] py-2.5 text-[12px] dark:border-white/[0.07]">
            <span className="text-amber-700 dark:text-amber-300">
              {t("Restarting computer will interrupt active tasks.")}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <IconActionButton
                disabled={busy || Boolean(restartingService)}
                icon={<Check size={13} />}
                label={t("Confirm restart")}
                onClick={() => void executeRestart("computer")}
                variant="primary"
              />
              <IconActionButton
                icon={<X size={13} />}
                label={t("Cancel")}
                onClick={() => setConfirmComputerRestart(false)}
              />
            </div>
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
        open={Boolean(logsService)}
        service={logsService}
      />
    </div>
  );
}
