import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Feather,
  Gauge,
  Infinity as InfinityIcon,
  Layers,
  MemoryStick,
  Monitor,
  RefreshCw,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../../../lib/cn";
import { useI18n } from "../../../../lib/i18n";
import type {
  LocalResourceSnapshot,
  LocalResourceUpdate,
} from "../../../../lib/local-deploy-contract";
import {
  computeResourcePresets,
  formatFriendlyBytes,
  formatMemoryGib,
  halfGibToCliMemory,
  memoryStringToHalfGib,
  validateLocalResourceForm,
  type ResourcePresetId,
} from "../../../../lib/server-location";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/tooltip";
import { InteractiveSwitch, SectionLabel, SettingsGroup } from "../ui";
import { IconActionButton } from "./icon-action-button";

const GIB = 1024 ** 3;

const formatGibLabel = (gib: number): string =>
  `${gib.toFixed(1).replace(/\.0$/, "")} GB`;

function SliderField({
  icon,
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  disabled,
  warn,
  warnTooltip,
  extraControl,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  warn?: boolean;
  warnTooltip?: string;
  extraControl?: React.ReactNode;
  onChange: (next: number) => void;
}) {
  const safeMax = Math.max(min, max);
  const clamped = Math.min(safeMax, Math.max(min, value));
  return (
    <div className="space-y-1.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-foreground">
          <span className="text-foreground-tertiary">{icon}</span>
          <span className="truncate">{label}</span>
          {warn && warnTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex text-amber-500">
                  <AlertTriangle className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{warnTooltip}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-[54px] text-right text-[12px] font-medium tabular-nums",
              warn ? "text-amber-600 dark:text-amber-400" : "text-foreground"
            )}
          >
            {valueLabel}
          </span>
          {extraControl}
        </div>
      </div>
      <input
        aria-label={label}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/[0.1] accent-foreground disabled:cursor-default disabled:opacity-45 dark:bg-white/[0.14]"
        disabled={disabled || safeMax <= min}
        max={safeMax}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={clamped}
      />
    </div>
  );
}

interface ResourceFormState {
  computerGib: number;
  desktopGib: number;
  cpuUnlimited: boolean;
  computerCpu: number;
  workerConcurrency: number;
  engineMemoryGib: number;
  engineCpu: number;
}

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
  const [initialForm, setInitialForm] = useState<ResourceFormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [preset, setPreset] = useState<ResourcePresetId>("custom");
  const [computerGib, setComputerGib] = useState(6);
  const [desktopGib, setDesktopGib] = useState(4);
  const [cpuUnlimited, setCpuUnlimited] = useState(true);
  const [computerCpu, setComputerCpu] = useState(4);
  const [workerConcurrency, setWorkerConcurrency] = useState(8);

  const [engineExpanded, setEngineExpanded] = useState(false);
  const [engineMemoryGib, setEngineMemoryGib] = useState(8);
  const [engineCpu, setEngineCpu] = useState(4);
  const [applyWslconfig, setApplyWslconfig] = useState(false);
  const [restartWsl, setRestartWsl] = useState(false);
  const [confirmingApply, setConfirmingApply] = useState(false);

  const hydrateFromSnapshot = useCallback((snap: LocalResourceSnapshot) => {
    setSnapshot(snap);
    const hostCores = Math.max(1, snap.host.cpuCores);
    const comp = Math.max(2, memoryStringToHalfGib(snap.containers.computerMemory, 6));
    const rawDesk = memoryStringToHalfGib(snap.containers.desktopMemory, Math.max(1, comp - 1));
    const desk = Math.max(1, Math.min(rawDesk, comp - 0.5));
    const unlimited = snap.containers.computerCpu === null;
    const cpu =
      snap.containers.computerCpu !== null
        ? Math.max(1, Math.min(hostCores, snap.containers.computerCpu))
        : Math.max(1, Math.min(4, Math.floor(hostCores / 2) || 1));
    const worker = Math.max(1, Math.min(16, snap.containers.workerConcurrency));

    const engMemRaw =
      snap.engine.configurable === "wslconfig" && snap.engine.wslConfig?.memory
        ? memoryStringToHalfGib(snap.engine.wslConfig.memory, 8)
        : snap.engine.memoryBytes
          ? Math.max(2, Math.round(snap.engine.memoryBytes / GIB))
          : Math.max(4, Math.round((snap.host.memoryBytes * 0.5) / GIB));
    const engMem = Math.max(2, Math.round(engMemRaw));
    const engCpu =
      snap.engine.configurable === "wslconfig" && snap.engine.wslConfig?.processors
        ? Math.max(1, Math.min(hostCores, snap.engine.wslConfig.processors))
        : snap.engine.cpuCores
          ? Math.max(1, Math.min(hostCores, snap.engine.cpuCores))
          : Math.max(1, Math.min(hostCores, Math.floor(hostCores / 2) || 1));

    const nextInitial: ResourceFormState = {
      computerGib: comp,
      desktopGib: desk,
      cpuUnlimited: unlimited,
      computerCpu: cpu,
      workerConcurrency: worker,
      engineMemoryGib: engMem,
      engineCpu: engCpu,
    };

    setInitialForm(nextInitial);
    setComputerGib(comp);
    setDesktopGib(desk);
    setCpuUnlimited(unlimited);
    setComputerCpu(cpu);
    setWorkerConcurrency(worker);
    setEngineMemoryGib(engMem);
    setEngineCpu(engCpu);
    setPreset("custom");
    setApplyWslconfig(false);
    setRestartWsl(false);
    setConfirmingApply(false);
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

  const engineChanged = Boolean(
    initialForm &&
      snapshot &&
      snapshot.engine.configurable !== "readonly" &&
      (engineMemoryGib !== initialForm.engineMemoryGib || engineCpu !== initialForm.engineCpu)
  );

  const containerChanged = Boolean(
    initialForm &&
      (computerGib !== initialForm.computerGib ||
        desktopGib !== initialForm.desktopGib ||
        cpuUnlimited !== initialForm.cpuUnlimited ||
        (!cpuUnlimited && computerCpu !== initialForm.computerCpu) ||
        workerConcurrency !== initialForm.workerConcurrency)
  );

  const isDirty = containerChanged || engineChanged;

  const effectiveEngineBytes = useMemo(() => {
    if (!snapshot) return null;
    if (engineChanged) return engineMemoryGib * GIB;
    return snapshot.engine.memoryBytes;
  }, [snapshot, engineChanged, engineMemoryGib]);

  const hostCores = Math.max(1, snapshot?.host.cpuCores ?? 4);
  const hostMemoryGib = Math.max(4, Math.floor((snapshot?.host.memoryBytes ?? 8 * GIB) / GIB));
  const maxComputerGib = useMemo(() => {
    const budgetBytes = effectiveEngineBytes ?? snapshot?.host.memoryBytes ?? 16 * GIB;
    return Math.max(2, Math.floor((budgetBytes / GIB) * 2) / 2);
  }, [effectiveEngineBytes, snapshot]);

  const presets = useMemo(() => {
    if (!snapshot) return null;
    return computeResourcePresets(
      snapshot.host.memoryBytes,
      snapshot.host.cpuCores,
      effectiveEngineBytes
    );
  }, [snapshot, effectiveEngineBytes]);

  const validation = useMemo(() => {
    if (!snapshot) return null;
    return validateLocalResourceForm({
      computerMemory: halfGibToCliMemory(computerGib),
      desktopMemory: halfGibToCliMemory(desktopGib),
      computerCpu: cpuUnlimited ? "" : String(computerCpu),
      workerConcurrency: String(workerConcurrency),
      engineMemory: halfGibToCliMemory(engineMemoryGib),
      engineCpu: String(engineCpu),
      modifyEngine: engineChanged,
      snapshot: {
        ...snapshot,
        engine: {
          ...snapshot.engine,
          memoryBytes: effectiveEngineBytes,
        },
      },
    });
  }, [
    snapshot,
    computerGib,
    desktopGib,
    cpuUnlimited,
    computerCpu,
    workerConcurrency,
    engineMemoryGib,
    engineCpu,
    engineChanged,
    effectiveEngineBytes,
  ]);

  const applyPreset = (id: Exclude<ResourcePresetId, "custom">) => {
    if (!presets) return;
    const p = presets[id];
    const comp = Math.max(2, memoryStringToHalfGib(p.computerMemory, 6));
    const desk = Math.max(1, Math.min(memoryStringToHalfGib(p.desktopMemory, comp - 1), comp - 0.5));
    setPreset(id);
    setComputerGib(comp);
    setDesktopGib(desk);
    if (p.computerCpu === null) {
      setCpuUnlimited(true);
    } else {
      setCpuUnlimited(false);
      setComputerCpu(Math.max(1, Math.min(hostCores, p.computerCpu)));
    }
    setWorkerConcurrency(p.workerConcurrency);
    setConfirmingApply(false);
    setSavedNotice(null);
  };

  const resetForm = () => {
    if (!initialForm) return;
    setComputerGib(initialForm.computerGib);
    setDesktopGib(initialForm.desktopGib);
    setCpuUnlimited(initialForm.cpuUnlimited);
    setComputerCpu(initialForm.computerCpu);
    setWorkerConcurrency(initialForm.workerConcurrency);
    setEngineMemoryGib(initialForm.engineMemoryGib);
    setEngineCpu(initialForm.engineCpu);
    setPreset("custom");
    setApplyWslconfig(false);
    setRestartWsl(false);
    setConfirmingApply(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!bridge?.updateResources || !snapshot || !validation?.valid || saving || busy) {
      return;
    }
    if (snapshot.engine.configurable === "wslconfig" && engineChanged && !applyWslconfig) {
      setError(t("Please confirm updating Windows .wslconfig before applying engine limits."));
      return;
    }
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const payload: LocalResourceUpdate = {
        computerMemory: halfGibToCliMemory(computerGib),
        desktopMemory: halfGibToCliMemory(desktopGib),
        computerCpu: validation.parsedComputerCpu,
        workerConcurrency: validation.parsedWorkerConcurrency ?? workerConcurrency,
      };
      if (engineChanged && snapshot.engine.configurable !== "readonly") {
        payload.engineMemory = halfGibToCliMemory(engineMemoryGib);
        if (validation.parsedEngineCpu !== null) payload.engineCpu = validation.parsedEngineCpu;
        if (snapshot.engine.configurable === "wslconfig") {
          payload.applyWslconfig = true;
          payload.restartWsl = restartWsl;
        }
      }
      const next = await bridge.updateResources(payload);
      hydrateFromSnapshot(next);
      setSavedNotice(
        snapshot.engine.configurable === "wslconfig" && engineChanged && !restartWsl
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

  const hardwareTooltip = snapshot
    ? [
        `${t("Host hardware")}: ${formatFriendlyBytes(snapshot.host.memoryBytes)} · ${snapshot.host.cpuCores} ${t("cores")}`,
        snapshot.engine.memoryBytes
          ? `${t("Engine")}: ${formatFriendlyBytes(snapshot.engine.memoryBytes)}${snapshot.engine.cpuCores ? ` · ${snapshot.engine.cpuCores} ${t("cores")}` : ""}`
          : null,
        snapshot.host.diskAvailableBytes !== null
          ? `${t("Free disk")}: ${formatFriendlyBytes(snapshot.host.diskAvailableBytes)}`
          : null,
      ]
        .filter(Boolean)
        .join(" / ")
    : "";

  const tierMeta = presets
    ? ([
        {
          id: "light" as const,
          label: "Light",
          icon: <Feather size={13} />,
          summary: `${formatMemoryGib(presets.light.computerMemory)} · ${presets.light.computerCpu ?? hostCores}${t("C")}`,
        },
        {
          id: "balanced" as const,
          label: "Balanced",
          icon: <Gauge size={13} />,
          summary: `${formatMemoryGib(presets.balanced.computerMemory)} · ${presets.balanced.computerCpu ?? hostCores}${t("C")}`,
        },
        {
          id: "performance" as const,
          label: "Performance",
          icon: <Zap size={13} />,
          summary: `${formatMemoryGib(presets.performance.computerMemory)} · ${t("Unlimited")}`,
        },
      ] as const)
    : [];

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <SectionLabel>{t("Performance and resources")}</SectionLabel>
        <div className="flex items-center gap-2">
          {snapshot ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default rounded-md bg-black/[0.045] px-2 py-1 text-[11px] tabular-nums text-foreground-secondary dark:bg-white/[0.07]">
                  {formatFriendlyBytes(snapshot.host.memoryBytes)} · {snapshot.host.cpuCores}{t("C")}
                </span>
              </TooltipTrigger>
              <TooltipContent>{hardwareTooltip}</TooltipContent>
            </Tooltip>
          ) : null}
          <IconActionButton
            disabled={loading || saving}
            icon={<RefreshCw className={loading ? "animate-spin" : ""} size={13} />}
            label={t("Refresh")}
            onClick={() => void loadSnapshot()}
          />
        </div>
      </div>

      <SettingsGroup>
        {!snapshot ? (
          <div className="py-3.5 text-[12px] text-foreground-secondary">
            {loading ? t("Loading resource configuration…") : t("Resource information is currently unavailable.")}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 py-3">
              {tierMeta.map((tier) => {
                const selected = preset === tier.id;
                return (
                  <button
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-[10px] border px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
                      selected
                        ? "border-foreground/30 bg-background text-foreground shadow-xs"
                        : "border-transparent bg-black/[0.035] text-foreground-secondary hover:bg-black/[0.06] hover:text-foreground dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                    )}
                    disabled={saving || busy}
                    key={tier.id}
                    onClick={() => applyPreset(tier.id)}
                    type="button"
                  >
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                      {tier.icon}
                      {t(tier.label)}
                    </span>
                    <span className="text-[11px] tabular-nums text-foreground-tertiary">
                      {tier.summary}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="divide-y divide-black/[0.06] border-t border-black/[0.065] dark:divide-white/[0.06] dark:border-white/[0.07]">
              <SliderField
                disabled={saving || busy}
                icon={<MemoryStick size={13} />}
                label={t("Computer memory limit")}
                max={maxComputerGib}
                min={2}
                onChange={(next) => {
                  setComputerGib(next);
                  if (desktopGib >= next) {
                    setDesktopGib(Math.max(1, next - 0.5));
                  }
                  setPreset("custom");
                  setConfirmingApply(false);
                  setSavedNotice(null);
                }}
                step={0.5}
                value={computerGib}
                valueLabel={formatGibLabel(computerGib)}
                warn={Boolean(validation?.warning)}
                warnTooltip={validation?.warning ? t(validation.warning) : undefined}
              />

              <SliderField
                disabled={saving || busy}
                icon={<Monitor size={13} />}
                label={t("Desktop memory limit")}
                max={Math.max(1, computerGib - 0.5)}
                min={1}
                onChange={(next) => {
                  setDesktopGib(next);
                  setPreset("custom");
                  setConfirmingApply(false);
                  setSavedNotice(null);
                }}
                step={0.5}
                value={desktopGib}
                valueLabel={formatGibLabel(desktopGib)}
              />

              <SliderField
                disabled={saving || busy || cpuUnlimited}
                extraControl={
                  <IconActionButton
                    active={cpuUnlimited}
                    className="size-6"
                    disabled={saving || busy}
                    icon={<InfinityIcon size={12} />}
                    label={t("Unlimited")}
                    onClick={() => {
                      setCpuUnlimited((prev) => !prev);
                      setPreset("custom");
                      setConfirmingApply(false);
                      setSavedNotice(null);
                    }}
                  />
                }
                icon={<Cpu size={13} />}
                label={t("Computer CPU limit")}
                max={hostCores}
                min={1}
                onChange={(next) => {
                  setComputerCpu(next);
                  setCpuUnlimited(false);
                  setPreset("custom");
                  setConfirmingApply(false);
                  setSavedNotice(null);
                }}
                step={1}
                value={cpuUnlimited ? hostCores : computerCpu}
                valueLabel={cpuUnlimited ? t("Unlimited") : `${computerCpu} ${t("cores")}`}
              />

              <SliderField
                disabled={saving || busy}
                icon={<Layers size={13} />}
                label={t("Worker concurrency")}
                max={16}
                min={1}
                onChange={(next) => {
                  setWorkerConcurrency(next);
                  setPreset("custom");
                  setConfirmingApply(false);
                  setSavedNotice(null);
                }}
                step={1}
                value={workerConcurrency}
                valueLabel={String(workerConcurrency)}
              />
            </div>

            {snapshot.engine.configurable === "readonly" ? (
              <div className="border-t border-black/[0.065] py-2.5 text-[11px] text-foreground-tertiary dark:border-white/[0.07]">
                {t("External container engine manages VM limits in Docker Desktop or OrbStack.")}
              </div>
            ) : (
              <div className="border-t border-black/[0.065] py-2 dark:border-white/[0.07]">
                <button
                  className="flex w-full items-center justify-between gap-2 py-1 text-left text-[12px] text-foreground-secondary hover:text-foreground"
                  onClick={() => setEngineExpanded((prev) => !prev)}
                  type="button"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {engineExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>
                      {snapshot.engine.configurable === "direct"
                        ? t("Virtual machine limits")
                        : t("WSL2 global limits")}
                    </span>
                  </span>
                  <span className="tabular-nums text-[11px] text-foreground-tertiary">
                    {formatGibLabel(engineMemoryGib)} · {engineCpu} {t("cores")}
                  </span>
                </button>

                {engineExpanded ? (
                  <div className="mt-1 space-y-1 pl-5">
                    <SliderField
                      disabled={saving || busy}
                      icon={<MemoryStick size={13} />}
                      label={t("Engine memory limit")}
                      max={hostMemoryGib}
                      min={2}
                      onChange={(next) => {
                        setEngineMemoryGib(next);
                        setConfirmingApply(false);
                        setSavedNotice(null);
                      }}
                      step={1}
                      value={engineMemoryGib}
                      valueLabel={formatGibLabel(engineMemoryGib)}
                    />
                    <SliderField
                      disabled={saving || busy}
                      icon={<Cpu size={13} />}
                      label={t("Engine CPU cores")}
                      max={hostCores}
                      min={1}
                      onChange={(next) => {
                        setEngineCpu(next);
                        setConfirmingApply(false);
                        setSavedNotice(null);
                      }}
                      step={1}
                      value={engineCpu}
                      valueLabel={`${engineCpu} ${t("cores")}`}
                    />
                    {snapshot.engine.configurable === "wslconfig" && engineChanged ? (
                      <div className="space-y-2 rounded-[10px] border border-amber-500/25 bg-amber-500/10 p-2.5 text-[12px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground">{t("Update global .wslconfig")}</span>
                          <InteractiveSwitch
                            checked={applyWslconfig}
                            disabled={saving || busy}
                            label="Update global .wslconfig"
                            onChange={setApplyWslconfig}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground-secondary">{t("Restart WSL2 now")}</span>
                          <InteractiveSwitch
                            checked={restartWsl}
                            disabled={saving || busy || !applyWslconfig}
                            label="Restart WSL2 now"
                            onChange={setRestartWsl}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            {isDirty || validation?.error ? (
              <div className="flex items-center justify-between gap-3 border-t border-black/[0.065] py-2.5 text-[12px] dark:border-white/[0.07]">
                <div className="min-w-0 flex-1">
                  {validation?.error ? (
                    <span className="text-red-600 dark:text-red-400" role="alert">
                      {t(validation.error)}
                    </span>
                  ) : confirmingApply ? (
                    <span className="text-amber-700 dark:text-amber-300">
                      {t("Confirm applying and restarting affected services?")}
                    </span>
                  ) : (
                    <span className="text-foreground-secondary">
                      {t("Applying restarts affected local services.")}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {confirmingApply ? (
                    <>
                      <IconActionButton
                        disabled={
                          busy ||
                          saving ||
                          !validation?.valid ||
                          (snapshot.engine.configurable === "wslconfig" &&
                            engineChanged &&
                            !applyWslconfig)
                        }
                        icon={<Check size={13} />}
                        label={t(saving ? "Applying…" : "Confirm apply")}
                        onClick={() => void handleSave()}
                        variant="primary"
                      />
                      <IconActionButton
                        disabled={saving}
                        icon={<X size={13} />}
                        label={t("Cancel")}
                        onClick={() => setConfirmingApply(false)}
                      />
                    </>
                  ) : (
                    <>
                      <IconActionButton
                        disabled={saving || busy}
                        icon={<RotateCcw size={13} />}
                        label={t("Reset changes")}
                        onClick={resetForm}
                      />
                      <IconActionButton
                        disabled={
                          busy ||
                          saving ||
                          !validation?.valid ||
                          (snapshot.engine.configurable === "wslconfig" &&
                            engineChanged &&
                            !applyWslconfig)
                        }
                        icon={<Check size={13} />}
                        label={t("Save and apply resources")}
                        onClick={() => setConfirmingApply(true)}
                        variant="primary"
                      />
                    </>
                  )}
                </div>
              </div>
            ) : null}
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
