import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../../../lib/cn";
import { useI18n } from "../../../../lib/i18n";
import type {
  EngineKind,
  LocalProxyConfig,
  LocalProxyTestResult,
  LocalProxyUpdate,
  ProxyMode,
  ProxyProtocol,
  SystemProxySnapshot,
} from "../../../../lib/local-deploy-contract";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/tooltip";
import {
  InteractiveSwitch,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  settingsInput,
  settingsSelect,
} from "../ui";
import { IconActionButton } from "./icon-action-button";

const isLoopbackAddress = (host: string): boolean => {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "127.0.0.1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
  );
};

const urlUsesLoopback = (raw: string | null | undefined): boolean => {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return isLoopbackAddress(parsed.hostname);
  } catch {
    return false;
  }
};

const checkTargetLabel = (
  target: "proxy-tcp" | "model-api" | "github" | "registry"
): string => {
  if (target === "proxy-tcp") return "Proxy server TCP";
  if (target === "model-api") return "Model API (DeepSeek)";
  if (target === "github") return "GitHub";
  return "Container Registry (ghcr.io)";
};

export function ProxySection({
  engineKind,
  busy,
  onApplied,
}: {
  engineKind: EngineKind | string | undefined;
  busy: boolean;
  onApplied: () => void;
}) {
  const { t } = useI18n();
  const bridge = window.outcomego?.localServer;
  const isExternal = engineKind === "external";

  const [savedConfig, setSavedConfig] = useState<LocalProxyConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [mode, setMode] = useState<ProxyMode>("off");
  const [protocol, setProtocol] = useState<ProxyProtocol>("http");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("7890");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [noProxy, setNoProxy] = useState("");
  const [applyToContainers, setApplyToContainers] = useState(true);
  const [applyToDockerDaemon, setApplyToDockerDaemon] = useState(!isExternal);
  const [systemSnapshot, setSystemSnapshot] = useState<SystemProxySnapshot | null>(null);

  const [confirmingSave, setConfirmingSave] = useState(false);
  const [testResult, setTestResult] = useState<LocalProxyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const hydrate = useCallback(
    (config: LocalProxyConfig) => {
      setSavedConfig(config);
      setMode(config.mode);
      setProtocol(config.protocol ?? "http");
      setHost(config.host ?? "");
      setPort(config.port ? String(config.port) : "7890");
      setUsername(config.username ?? "");
      setPassword("");
      setClearPassword(false);
      setNoProxy(config.noProxy ?? "");
      setApplyToContainers(config.applyToContainers);
      setApplyToDockerDaemon(isExternal ? false : config.applyToDockerDaemon);
      if (config.systemResolved) setSystemSnapshot(config.systemResolved);
      setConfirmingSave(false);
    },
    [isExternal]
  );

  const loadConfig = useCallback(async () => {
    if (!bridge?.proxyStatus) return;
    setLoading(true);
    setError(null);
    try {
      const cfg = await bridge.proxyStatus();
      hydrate(cfg);
    } catch {
      setError(t("Unable to load local proxy configuration."));
    } finally {
      setLoading(false);
    }
  }, [bridge, hydrate, t]);

  const detectSystem = useCallback(async () => {
    if (!bridge?.detectSystemProxy) return;
    setDetecting(true);
    try {
      const snap = await bridge.detectSystemProxy();
      setSystemSnapshot(snap);
    } catch {
      setSystemSnapshot({ httpProxy: null, httpsProxy: null, noProxy: null });
    } finally {
      setDetecting(false);
    }
  }, [bridge]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (mode === "system" && !systemSnapshot) {
      void detectSystem();
    }
  }, [mode, systemSnapshot, detectSystem]);

  const validationError = useMemo((): string | null => {
    if (mode !== "manual") return null;
    const h = host.trim();
    if (!h) return "Enter a proxy host or IP address.";
    if (/[\s/\\@#?\r\n\0]/.test(h)) return "Proxy host contains invalid characters.";
    const p = Number(port.trim());
    if (!/^\d+$/.test(port.trim()) || !Number.isInteger(p) || p < 1 || p > 65535) {
      return "Proxy port must be an integer between 1 and 65535.";
    }
    return null;
  }, [mode, host, port]);

  const isDirty = useMemo(() => {
    if (!savedConfig) return false;
    if (mode !== savedConfig.mode) return true;
    if (noProxy.trim() !== (savedConfig.noProxy ?? "").trim()) return true;
    if (applyToContainers !== savedConfig.applyToContainers) return true;
    if (!isExternal && applyToDockerDaemon !== savedConfig.applyToDockerDaemon) return true;
    if (mode === "manual") {
      if (protocol !== (savedConfig.protocol ?? "http")) return true;
      if (host.trim() !== (savedConfig.host ?? "")) return true;
      if (port.trim() !== (savedConfig.port ? String(savedConfig.port) : "7890")) return true;
      if (username.trim() !== (savedConfig.username ?? "")) return true;
      if (password.length > 0 || clearPassword) return true;
    }
    return false;
  }, [
    savedConfig,
    mode,
    protocol,
    host,
    port,
    username,
    password,
    clearPassword,
    noProxy,
    applyToContainers,
    applyToDockerDaemon,
    isExternal,
  ]);

  const usesLoopback = useMemo(() => {
    if (mode === "manual") return isLoopbackAddress(host);
    if (mode === "system") {
      return (
        urlUsesLoopback(systemSnapshot?.httpsProxy) || urlUsesLoopback(systemSnapshot?.httpProxy)
      );
    }
    return false;
  }, [mode, host, systemSnapshot]);

  const buildPayload = (): LocalProxyUpdate => {
    if (mode === "off") {
      return {
        mode: "off",
        noProxy: noProxy.trim(),
        applyToContainers,
        applyToDockerDaemon: isExternal ? false : applyToDockerDaemon,
      };
    }
    if (mode === "system") {
      return {
        mode: "system",
        noProxy: noProxy.trim(),
        applyToContainers,
        applyToDockerDaemon: isExternal ? false : applyToDockerDaemon,
        systemResolved: systemSnapshot,
      };
    }
    return {
      mode: "manual",
      protocol,
      host: host.trim(),
      port: Number(port.trim()),
      username: username.trim() || null,
      ...(clearPassword
        ? { clearPassword: true }
        : password.length > 0
          ? { password }
          : {}),
      noProxy: noProxy.trim(),
      applyToContainers,
      applyToDockerDaemon: isExternal ? false : applyToDockerDaemon,
    };
  };

  const handleTest = async () => {
    if (!bridge?.testProxy || validationError || testing) return;
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await bridge.testProxy(buildPayload());
      setTestResult(result);
    } catch {
      setError(t("Proxy connectivity test failed to run."));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!bridge?.saveProxy || validationError || saving || busy) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const updated = await bridge.saveProxy(buildPayload());
      hydrate(updated);
      setSavedNotice(t("Proxy settings saved and applied to local services."));
      onApplied();
    } catch {
      setError(
        t("Failed to apply proxy settings. Previous configuration has been restored automatically.")
      );
    } finally {
      setSaving(false);
    }
  };

  if (!bridge?.proxyStatus) return null;

  const detectedProxyLine =
    systemSnapshot?.httpsProxy ?? systemSnapshot?.httpProxy ?? null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between px-2">
        <SectionLabel>{t("Proxy server")}</SectionLabel>
        <div className="flex items-center gap-1.5">
          {bridge.testProxy ? (
            <IconActionButton
              disabled={testing || saving || Boolean(validationError)}
              icon={<Activity className={testing ? "animate-pulse" : ""} size={13} />}
              label={t(testing ? "Testing…" : "Test proxy connection")}
              onClick={() => void handleTest()}
            />
          ) : null}
          <IconActionButton
            disabled={loading || saving}
            icon={<RefreshCw className={loading ? "animate-spin" : ""} size={13} />}
            label={t("Refresh")}
            onClick={() => void loadConfig()}
          />
        </div>
      </div>

      <SettingsGroup>
        <SettingsRow
          control={
            <div className="inline-flex rounded-[8px] bg-black/[0.06] p-0.5 dark:bg-white/[0.08]">
              {(["off", "system", "manual"] as const).map((option) => (
                <button
                  className={cn(
                    "h-6 rounded-[6px] px-2.5 text-[12px] transition-colors outline-none disabled:opacity-50",
                    mode === option
                      ? "bg-background font-medium text-foreground shadow-xs"
                      : "text-foreground-secondary hover:text-foreground"
                  )}
                  disabled={saving || busy}
                  key={option}
                  onClick={() => {
                    setMode(option);
                    setConfirmingSave(false);
                    setSavedNotice(null);
                  }}
                  type="button"
                >
                  {t(option === "off" ? "Off" : option === "system" ? "System" : "Manual")}
                </button>
              ))}
            </div>
          }
          title={t("Proxy mode")}
        />

        {mode === "system" ? (
          <div className="flex items-center justify-between gap-2 border-t border-black/[0.065] py-2.5 text-[12px] dark:border-white/[0.07]">
            <span className="truncate font-mono text-[11px] text-foreground-secondary">
              {detectedProxyLine ?? t("None detected (direct)")}
            </span>
            <IconActionButton
              disabled={detecting}
              icon={<RefreshCw className={detecting ? "animate-spin" : ""} size={12} />}
              label={t("Detect again")}
              onClick={() => void detectSystem()}
            />
          </div>
        ) : null}

        {mode === "manual" ? (
          <div className="space-y-2.5 border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
            <div className="grid grid-cols-[92px_minmax(0,1fr)_84px] gap-2">
              <select
                aria-label={t("Protocol")}
                className={settingsSelect}
                disabled={saving || busy}
                onChange={(e) => {
                  setProtocol(e.target.value as ProxyProtocol);
                  setConfirmingSave(false);
                }}
                value={protocol}
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
              <input
                aria-label={t("Proxy host")}
                className={settingsInput}
                disabled={saving || busy}
                onChange={(e) => {
                  setHost(e.target.value);
                  setConfirmingSave(false);
                }}
                placeholder="127.0.0.1"
                value={host}
              />
              <input
                aria-label={t("Port")}
                className={settingsInput}
                disabled={saving || busy}
                max={65535}
                min={1}
                onChange={(e) => {
                  setPort(e.target.value);
                  setConfirmingSave(false);
                }}
                placeholder="7890"
                type="number"
                value={port}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                aria-label={t("Username (optional)")}
                className={settingsInput}
                disabled={saving || busy}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setConfirmingSave(false);
                }}
                placeholder={t("Username (optional)")}
                value={username}
              />
              <div className="flex items-center gap-1.5">
                <input
                  aria-label={t(
                    savedConfig?.hasPassword ? "Password (saved)" : "Password (optional)"
                  )}
                  className={`${settingsInput} flex-1`}
                  disabled={saving || busy || clearPassword}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setConfirmingSave(false);
                  }}
                  placeholder={t(
                    clearPassword
                      ? "Password will be cleared"
                      : savedConfig?.hasPassword
                        ? "Password (saved)"
                        : "Password (optional)"
                  )}
                  type="password"
                  value={password}
                />
                {savedConfig?.hasPassword ? (
                  <IconActionButton
                    active={clearPassword}
                    disabled={saving || busy}
                    icon={<Trash2 size={12} />}
                    label={t("Clear saved proxy password")}
                    onClick={() => {
                      setClearPassword((prev) => {
                        const next = !prev;
                        if (next) setPassword("");
                        return next;
                      });
                      setConfirmingSave(false);
                    }}
                    variant="danger"
                  />
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {mode !== "off" ? (
          <div className="space-y-2.5 border-t border-black/[0.065] py-3 text-[12px] dark:border-white/[0.07]">
            <div className="flex items-center gap-2">
              <input
                aria-label={t("Bypass proxy for (NO_PROXY, comma-separated)")}
                className={`${settingsInput} flex-1`}
                disabled={saving || busy}
                onChange={(e) => {
                  setNoProxy(e.target.value);
                  setConfirmingSave(false);
                }}
                placeholder={t("NO_PROXY (e.g. .corp.local)")}
                value={noProxy}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex text-foreground-tertiary">
                    <ShieldCheck className="size-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t(
                    "Local intranet services (localhost, 127.0.0.1, postgres, server, worker, computer, private subnets, host.docker.internal) always bypass the proxy automatically."
                  )}
                </TooltipContent>
              </Tooltip>
            </div>

            {usesLoopback ? (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  {t("Loopback proxy mapped automatically; enable 'Allow LAN' in your proxy app.")}
                </span>
              </div>
            ) : null}

            <div className="space-y-2 pt-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-foreground">{t("Apply to local containers")}</span>
                <InteractiveSwitch
                  checked={applyToContainers}
                  disabled={saving || busy}
                  label="Apply to local containers"
                  onChange={(checked) => {
                    setApplyToContainers(checked);
                    setConfirmingSave(false);
                  }}
                />
              </div>
              {!isExternal ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-foreground">{t("Apply to image pulls")}</span>
                  <InteractiveSwitch
                    checked={applyToDockerDaemon}
                    disabled={saving || busy}
                    label="Apply to image pulls"
                    onChange={(checked) => {
                      setApplyToDockerDaemon(checked);
                      setConfirmingSave(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isDirty || validationError ? (
          <div className="flex items-center justify-between gap-3 border-t border-black/[0.065] py-2.5 text-[12px] dark:border-white/[0.07]">
            <div className="min-w-0 flex-1">
              {validationError ? (
                <span className="text-red-600 dark:text-red-400" role="alert">
                  {t(validationError)}
                </span>
              ) : confirmingSave ? (
                <span className="text-amber-700 dark:text-amber-300">
                  {t("Confirm applying and restarting local services?")}
                </span>
              ) : (
                <span className="text-foreground-secondary">
                  {t("Applying briefly restarts local services.")}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {confirmingSave ? (
                <>
                  <IconActionButton
                    disabled={busy || saving || Boolean(validationError)}
                    icon={<Check size={13} />}
                    label={t(saving ? "Applying…" : "Confirm apply")}
                    onClick={() => void handleSave()}
                    variant="primary"
                  />
                  <IconActionButton
                    disabled={saving}
                    icon={<X size={13} />}
                    label={t("Cancel")}
                    onClick={() => setConfirmingSave(false)}
                  />
                </>
              ) : (
                <>
                  <IconActionButton
                    disabled={saving || busy}
                    icon={<RotateCcw size={13} />}
                    label={t("Reset changes")}
                    onClick={() => {
                      if (savedConfig) hydrate(savedConfig);
                    }}
                  />
                  <IconActionButton
                    disabled={busy || saving || Boolean(validationError)}
                    icon={<Check size={13} />}
                    label={t("Save and apply proxy")}
                    onClick={() => setConfirmingSave(true)}
                    variant="primary"
                  />
                </>
              )}
            </div>
          </div>
        ) : null}

        {testResult ? (
          <div className="space-y-1.5 border-t border-black/[0.065] py-2.5 text-[12px] dark:border-white/[0.07]">
            {testResult.checks.map((check) => (
              <div
                className="flex items-center justify-between gap-2 text-[12px]"
                key={check.target}
              >
                <div className="flex items-center gap-1.5">
                  {check.ok ? (
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="size-3.5 text-red-500" />
                  )}
                  <span className="text-foreground">{t(checkTargetLabel(check.target))}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] text-foreground-secondary">
                  {check.latencyMs !== null ? <span>{check.latencyMs} ms</span> : null}
                  {check.error ? (
                    <span className="max-w-[220px] truncate text-red-600 dark:text-red-400">
                      {check.error}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
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
