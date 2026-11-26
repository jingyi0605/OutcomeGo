import { AlertTriangle, Cpu, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import type {
  LocalResourceSnapshot,
  LocalResourceUpdate,
} from "../../../../lib/local-deploy-contract";
import {
  computeResourcePresets,
  validateLocalResourceForm,
  type ResourcePresetId,
} from "../../../../lib/server-location";
import {
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  settingsInput,
  settingsPrimaryButton,
  settingsSecondaryButton,
} from "../ui";
import { formatCompactBytes } from "./containers-panel";

export function ResourcesSection({
  busy,
  onApplied,
}: {
  busy: boolean;
  onApplied: () => void;
}) {
  const { t } = useI18n();
  const bridge = window.outcomego?.localServer;

  const [snapshot, setSnapshot] = useState<LocalResourceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [preset, setPreset] = useState<ResourcePresetId>("custom");
  const [computerMemory, setComputerMemory] = useState("");
  const [desktopMemory, setDesktopMemory] = useState("");
  const [computerCpu, setComputerCpu] = useState("");
  const [workerConcurrency, setWorkerConcurrency] = useState("8");

  const [modifyEngine, setModifyEngine] = useState(false);
  const [engineMemory, setEngineMemory] = useState("");
  const [engineCpu, setEngineCpu] = useState("");
  const [applyWslconfig, setApplyWslconfig] = useState(false);
  const [restartWsl, setRestartWsl] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const hydrateFromSnapshot = useCallback((snap: LocalResourceSnapshot) => {
    setSnapshot(snap);
    setComputerMemory(snap.containers.computerMemory);
    setDesktopMemory(snap.containers.desktopMemory);
    setComputerCpu(snap.containers.computerCpu === null ? "" : String(snap.containers.computerCpu));
    setWorkerConcurrency(String(snap.containers.workerConcurrency));
    if (snap.engine.configurable === "wslconfig") {
      setEngineMemory(
        snap.engine.wslConfig?.memory?.replace(/gb$/i, "g").replace(/mb$/i, "m") ??
          (snap.engine.memoryBytes ? `${Math.round(snap.engine.memoryBytes / 1024 ** 3)}g` : "")
      );
      setEngineCpu(
        snap.engine.wslConfig?.processors
          ? String(snap.engine.wslConfig.processors)
          : snap.engine.cpuCores
            ? String(snap.engine.cpuCores)
            : ""
      );
    } else {
      setEngineMemory(
        snap.engine.memoryBytes ? `${Math.round(snap.engine.memoryBytes / 1024 ** 3)}g` : ""
      );
      setEngineCpu(snap.engine.cpuCores ? String(snap.engine.cpuCores) : "");
    }
    setPreset("custom");
    setModifyEngine(false);
    setApplyWslconfig(false);
    setRestartWsl(false);
    setConfirmed(false);
  }, []);

  const loadSnapshot = useCallback(async () => {
    if (!bridge?.resourcesStatus) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await bridge.resourcesStatus();
      hydrateFromSnapshot(snap);
    } catch {
      setError(t("Unable to read local resource configuration."));
    } finally {
      setLoading(false);
    }
  }, [bridge, hydrateFromSnapshot, t]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const presets = useMemo(() => {
    if (!snapshot) return null;
    return computeResourcePresets(
      snapshot.host.memoryBytes,
      snapshot.host.cpuCores,
      snapshot.engine.memoryBytes
    );
  }, [snapshot]);

  const validation = useMemo(() => {
    if (!snapshot) return null;
    return validateLocalResourceForm({
      computerMemory,
      desktopMemory,
      computerCpu,
      workerConcurrency,
      engineMemory,
      engineCpu,
      modifyEngine,
      snapshot,
    });
  }, [
    snapshot,
    computerMemory,
    desktopMemory,
    computerCpu,
    workerConcurrency,
    engineMemory,
    engineCpu,
    modifyEngine,
  ]);

  const applyPreset = (id: Exclude<ResourcePresetId, "custom">) => {
    if (!presets) return;
    const p = presets[id];
    setPreset(id);
    setComputerMemory(p.computerMemory);
    setDesktopMemory(p.desktopMemory);
    setComputerCpu(p.computerCpu === null ? "" : String(p.computerCpu));
    setWorkerConcurrency(String(p.workerConcurrency));
    setConfirmed(false);
    setSavedNotice(null);
  };

  const handleSave = async () => {
    if (!bridge?.updateResources || !snapshot || !validation?.valid || !confirmed || saving || busy) {
      return;
    }
    if (snapshot.engine.configurable === "wslconfig" && modifyEngine && !applyWslconfig) {
      setError(t("Please confirm updating Windows .wslconfig before applying engine limits."));
      return;
    }
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const payload: LocalResourceUpdate = {
        computerMemory: computerMemory.trim(),
        desktopMemory: desktopMemory.trim(),
        computerCpu: validation.parsedComputerCpu,
        workerConcurrency: validation.parsedWorkerConcurrency ?? snapshot.containers.workerConcurrency,
      };
      if (modifyEngine && snapshot.engine.configurable !== "readonly") {
        if (engineMemory.trim()) payload.engineMemory = engineMemory.trim();
        if (validation.parsedEngineCpu !== null) payload.engineCpu = validation.parsedEngineCpu;
        if (snapshot.engine.configurable === "wslconfig") {
          payload.applyWslconfig = true;
          payload.restartWsl = restartWsl;
        }
      }
      const next = await bridge.updateResources(payload);
      hydrateFromSnapshot(next);
      setSavedNotice(
        snapshot.engine.configurable === "wslconfig" && modifyEngine && !restartWsl
          ? t("Resource settings saved. Restart WSL2 or reboot Windows for .wslconfig changes to take effect.")
          : t("Resource settings applied.")
      );
      onApplied();
    } catch {
      setError(t("Failed to apply resource settings. Previous configuration was preserved."));
    } finally {
      setSaving(false);
    }
  };

  if (!bridge?.resourcesStatus) return null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between px-2">
        <SectionLabel>{t("Performance and resources")}</SectionLabel>
        <button
          className={settingsSecondaryButton}
          disabled={loading || saving}
          onClick={() => void loadSnapshot()}
          type="button"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} size={13} />
          {t("Refresh")}
        </button>
      </div>

      <SettingsGroup>
        {!snapshot ? (
          <div className="py-4 text-[12px] text-foreground-secondary">
            {loading ? t("Loading resource configuration…") : t("Resource information is currently unavailable.")}
          </div>
        ) : (
          <>
            <SettingsRow
              title={t("Host hardware")}
              description={t(
                "Total memory {memory} · {cores} CPU cores · Free disk {disk}",
                {
                  memory: formatCompactBytes(snapshot.host.memoryBytes),
                  cores: snapshot.host.cpuCores,
                  disk:
                    snapshot.host.diskAvailableBytes !== null
                      ? formatCompactBytes(snapshot.host.diskAvailableBytes)
                      : t("Unknown"),
                }
              )}
              control={
                <span className="inline-flex items-center gap-1 text-[12px] text-foreground-secondary">
                  <Cpu size={14} />
                  {snapshot.engine.memoryBytes
                    ? `${t("Engine")}: ${formatCompactBytes(snapshot.engine.memoryBytes)}${
                        snapshot.engine.cpuCores ? ` / ${snapshot.engine.cpuCores}C` : ""
                      }`
                    : t("Engine info unavailable")}
                </span>
              }
            />

            <SettingsRow
              title={t("Performance preset")}
              description={t("Choose a recommended tier or customize individual container limits below.")}
              control={
                <div className="flex flex-wrap gap-1.5">
                  {(["light", "balanced", "performance"] as const).map((tier) => (
                    <button
                      className={
                        preset === tier ? settingsPrimaryButton : settingsSecondaryButton
                      }
                      disabled={saving || busy}
                      key={tier}
                      onClick={() => applyPreset(tier)}
                      type="button"
                    >
                      {t(
                        tier === "light"
                          ? "Light"
                          : tier === "balanced"
                            ? "Balanced"
                            : "Performance"
                      )}
                    </button>
                  ))}
                </div>
              }
            />

            <SettingsRow
              title={t("Container limits")}
              description={t(
                "Current: Computer {computerMem}, Desktop {desktopMem}, CPU {cpu}, Worker {worker}.",
                {
                  computerMem: snapshot.containers.computerMemory,
                  desktopMem: snapshot.containers.desktopMemory,
                  cpu:
                    snapshot.containers.computerCpu !== null
                      ? `${snapshot.containers.computerCpu}C`
                      : t("Unlimited"),
                  worker: snapshot.containers.workerConcurrency,
                }
              )}
              descriptionBelow
              control={null}
            />

            <div className="grid grid-cols-1 gap-3 border-t border-black/[0.065] py-3 sm:grid-cols-2 dark:border-white/[0.07]">
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">{t("Computer memory limit")}</span>
                <input
                  className={settingsInput}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setComputerMemory(e.target.value);
                    setPreset("custom");
                    setConfirmed(false);
                  }}
                  placeholder="8g"
                  value={computerMemory}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">{t("Desktop memory limit")}</span>
                <input
                  className={settingsInput}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setDesktopMemory(e.target.value);
                    setPreset("custom");
                    setConfirmed(false);
                  }}
                  placeholder="6g"
                  value={desktopMemory}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">
                  {t("Computer CPU limit (blank for unlimited)")}
                </span>
                <input
                  className={settingsInput}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setComputerCpu(e.target.value);
                    setPreset("custom");
                    setConfirmed(false);
                  }}
                  placeholder={t("Unlimited")}
                  value={computerCpu}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">{t("Worker concurrency (1–16)")}</span>
                <input
                  className={settingsInput}
                  disabled={saving || busy}
                  max={64}
                  min={1}
                  onChange={(e) => {
                    setWorkerConcurrency(e.target.value);
                    setPreset("custom");
                    setConfirmed(false);
                  }}
                  type="number"
                  value={workerConcurrency}
                />
              </label>
            </div>

            {snapshot.engine.configurable === "readonly" ? (
              <SettingsRow
                title={t("Container engine allocation")}
                description={t(
                  "Your external container engine manages its own VM CPU and memory limits. Adjust them in Docker Desktop or OrbStack settings."
                )}
              />
            ) : (
              <div className="border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] text-foreground">
                      {snapshot.engine.configurable === "direct"
                        ? t("Managed Lima VM resources")
                        : t("Windows WSL2 global resources (.wslconfig)")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-foreground-secondary">
                      {snapshot.engine.configurable === "direct"
                        ? t("Changing Lima VM memory or CPU restarts the managed virtual machine and all local services.")
                        : t(
                            "WSL2 memory and processor limits are stored in %USERPROFILE%\\.wslconfig and affect all WSL2 distributions on this PC."
                          )}
                    </div>
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-foreground">
                    <input
                      checked={modifyEngine}
                      disabled={saving || busy}
                      onChange={(e) => {
                        setModifyEngine(e.target.checked);
                        setConfirmed(false);
                      }}
                      type="checkbox"
                    />
                    {t("Edit engine limits")}
                  </label>
                </div>

                {snapshot.engine.configurable === "wslconfig" && snapshot.engine.wslConfig ? (
                  <div className="mt-2 font-mono text-[11px] text-foreground-tertiary">
                    {snapshot.engine.wslConfig.path} (
                    {snapshot.engine.wslConfig.exists
                      ? `memory=${snapshot.engine.wslConfig.memory ?? "default"}, processors=${snapshot.engine.wslConfig.processors ?? "default"}`
                      : t("not created yet")}
                    )
                  </div>
                ) : null}

                {modifyEngine ? (
                  <div className="mt-3 space-y-2.5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-[12px]">
                        <span className="text-foreground-secondary">{t("Engine memory limit")}</span>
                        <input
                          className={settingsInput}
                          disabled={saving || busy}
                          onChange={(e) => {
                            setEngineMemory(e.target.value);
                            setConfirmed(false);
                          }}
                          placeholder="8g"
                          value={engineMemory}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[12px]">
                        <span className="text-foreground-secondary">{t("Engine CPU cores")}</span>
                        <input
                          className={settingsInput}
                          disabled={saving || busy}
                          max={snapshot.host.cpuCores}
                          min={1}
                          onChange={(e) => {
                            setEngineCpu(e.target.value);
                            setConfirmed(false);
                          }}
                          type="number"
                          value={engineCpu}
                        />
                      </label>
                    </div>
                    {snapshot.engine.configurable === "wslconfig" ? (
                      <div className="space-y-1.5 rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-2.5 text-[12px]">
                        <label className="flex items-start gap-2">
                          <input
                            checked={applyWslconfig}
                            disabled={saving || busy}
                            onChange={(e) => setApplyWslconfig(e.target.checked)}
                            type="checkbox"
                          />
                          <span>
                            {t(
                              "I understand this updates global Windows .wslconfig (a backup will be saved to .wslconfig.outcomego.bak)."
                            )}
                          </span>
                        </label>
                        <label className="flex items-start gap-2 text-foreground-secondary">
                          <input
                            checked={restartWsl}
                            disabled={saving || busy || !applyWslconfig}
                            onChange={(e) => setRestartWsl(e.target.checked)}
                            type="checkbox"
                          />
                          <span>
                            {t(
                              "Restart all WSL2 instances now (runs wsl --shutdown and interrupts other WSL2 distributions)."
                            )}
                          </span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-2 border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
              {validation?.error ? (
                <p className="text-[12px] text-red-600 dark:text-red-400" role="alert">
                  {t(validation.error)}
                </p>
              ) : null}
              {validation?.warning ? (
                <div className="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t(validation.warning)}</span>
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-[12px] text-foreground">
                <input
                  checked={confirmed}
                  disabled={saving || busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  type="checkbox"
                />
                <span>
                  {t("Applying resource changes restarts affected local services and interrupts running tasks.")}
                </span>
              </label>
              <div className="flex items-center gap-2 pt-1">
                <button
                  className={settingsPrimaryButton}
                  disabled={
                    busy ||
                    saving ||
                    !validation?.valid ||
                    !confirmed ||
                    (snapshot.engine.configurable === "wslconfig" && modifyEngine && !applyWslconfig)
                  }
                  onClick={() => void handleSave()}
                  type="button"
                >
                  {t(saving ? "Applying…" : "Save and apply resources")}
                </button>
              </div>
            </div>
          </>
        )}
      </SettingsGroup>

      {savedNotice ? (
        <p className="mt-2 px-2 text-[12px] text-emerald-600 dark:text-emerald-400">{savedNotice}</p>
      ) : null}
      {error ? (
        <p className="mt-2 px-2 text-[12px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
