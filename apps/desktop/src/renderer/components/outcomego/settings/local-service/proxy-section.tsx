import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  settingsInput,
  settingsPrimaryButton,
  settingsSecondaryButton,
  settingsSelect,
} from "../ui";

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

  const [confirmed, setConfirmed] = useState(false);
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
      setConfirmed(false);
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

  const usesLoopback = useMemo(() => {
    if (mode === "manual") return isLoopbackAddress(host);
    if (mode === "system") {
      return urlUsesLoopback(systemSnapshot?.httpsProxy) || urlUsesLoopback(systemSnapshot?.httpProxy);
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
    if (!bridge?.saveProxy || validationError || !confirmed || saving || busy) return;
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

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between px-2">
        <SectionLabel>{t("Proxy server")}</SectionLabel>
        <button
          className={settingsSecondaryButton}
          disabled={loading || saving}
          onClick={() => void loadConfig()}
          type="button"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} size={13} />
          {t("Refresh")}
        </button>
      </div>

      <SettingsGroup>
        <SettingsRow
          title={t("Proxy mode")}
          description={t(
            "Route local service outbound requests (AI models, web search, plugins) and managed engine image pulls through a proxy. Does not affect cloud computer browser egress."
          )}
          control={
            <div className="flex flex-wrap gap-1.5">
              {(["off", "system", "manual"] as const).map((option) => (
                <button
                  className={mode === option ? settingsPrimaryButton : settingsSecondaryButton}
                  disabled={saving || busy}
                  key={option}
                  onClick={() => {
                    setMode(option);
                    setTestResult(null);
                    setConfirmed(false);
                    setSavedNotice(null);
                  }}
                  type="button"
                >
                  {t(
                    option === "off"
                      ? "Direct"
                      : option === "system"
                        ? "Follow system proxy"
                        : "Manual proxy"
                  )}
                </button>
              ))}
            </div>
          }
        />

        {mode === "system" ? (
          <div className="border-t border-black/[0.065] py-3 text-[12px] dark:border-white/[0.07]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Globe size={14} />
                <span>{t("Detected system proxy")}</span>
              </div>
              <button
                className={settingsSecondaryButton}
                disabled={detecting}
                onClick={() => void detectSystem()}
                type="button"
              >
                <RefreshCw className={detecting ? "animate-spin" : ""} size={12} />
                {t("Detect again")}
              </button>
            </div>
            <div className="mt-2 space-y-1 font-mono text-[11px] text-foreground-secondary">
              <div>
                HTTPS: {systemSnapshot?.httpsProxy ?? t("None detected (direct)")}
              </div>
              <div>
                HTTP: {systemSnapshot?.httpProxy ?? t("None detected (direct)")}
              </div>
              {systemSnapshot?.noProxy ? (
                <div className="truncate">NO_PROXY: {systemSnapshot.noProxy}</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "manual" ? (
          <div className="space-y-3 border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">{t("Protocol")}</span>
                <select
                  className={settingsSelect}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setProtocol(e.target.value as ProxyProtocol);
                    setConfirmed(false);
                  }}
                  value={protocol}
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">{t("Proxy host")}</span>
                <input
                  className={settingsInput}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setHost(e.target.value);
                    setConfirmed(false);
                  }}
                  placeholder="127.0.0.1"
                  value={host}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">{t("Port")}</span>
                <input
                  className={settingsInput}
                  disabled={saving || busy}
                  max={65535}
                  min={1}
                  onChange={(e) => {
                    setPort(e.target.value);
                    setConfirmed(false);
                  }}
                  placeholder="7890"
                  type="number"
                  value={port}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">{t("Username (optional)")}</span>
                <input
                  className={settingsInput}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setConfirmed(false);
                  }}
                  value={username}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px]">
                <span className="text-foreground-secondary">
                  {t(savedConfig?.hasPassword ? "Password (saved)" : "Password (optional)")}
                </span>
                <input
                  className={settingsInput}
                  disabled={saving || busy || clearPassword}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setConfirmed(false);
                  }}
                  placeholder={
                    savedConfig?.hasPassword
                      ? t("Leave blank to keep saved password")
                      : ""
                  }
                  type="password"
                  value={password}
                />
              </label>
            </div>

            {savedConfig?.hasPassword ? (
              <label className="flex items-center gap-2 text-[12px] text-foreground-secondary">
                <input
                  checked={clearPassword}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setClearPassword(e.target.checked);
                    if (e.target.checked) setPassword("");
                    setConfirmed(false);
                  }}
                  type="checkbox"
                />
                <span>{t("Clear saved proxy password")}</span>
              </label>
            ) : null}
          </div>
        ) : null}

        {mode !== "off" ? (
          <div className="space-y-3 border-t border-black/[0.065] py-3 text-[12px] dark:border-white/[0.07]">
            <label className="flex flex-col gap-1">
              <span className="text-foreground-secondary">
                {t("Bypass proxy for (NO_PROXY, comma-separated)")}
              </span>
              <input
                className={settingsInput}
                disabled={saving || busy}
                onChange={(e) => {
                  setNoProxy(e.target.value);
                  setConfirmed(false);
                }}
                placeholder=".corp.local,internal.example.com"
                value={noProxy}
              />
            </label>
            <div className="flex items-start gap-1.5 text-[11px] text-foreground-tertiary">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t(
                  "Local intranet services (localhost, 127.0.0.1, postgres, server, worker, computer, private subnets, host.docker.internal) always bypass the proxy automatically."
                )}
              </span>
            </div>

            {usesLoopback ? (
              <div className="flex items-start gap-2 rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-2.5 text-[12px] text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-0.5">
                  <div>
                    {t(
                      "Loopback proxy detected: OutcomeGo automatically maps 127.0.0.1 / localhost to the host gateway reachable from containers."
                    )}
                    {savedConfig?.loopbackMappedHost ? (
                      <span className="ml-1 font-mono text-[11px]">
                        ({savedConfig.loopbackMappedHost})
                      </span>
                    ) : null}
                  </div>
                  <div className="text-foreground-secondary">
                    {t(
                      "Make sure your local proxy app (for example Clash or v2rayN) has 'Allow LAN' enabled and is allowed through the firewall."
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-foreground">
                <input
                  checked={applyToContainers}
                  disabled={saving || busy}
                  onChange={(e) => {
                    setApplyToContainers(e.target.checked);
                    setConfirmed(false);
                  }}
                  type="checkbox"
                />
                <span>{t("Apply to local service containers (AI models, web search, plugins)")}</span>
              </label>
              <label
                className={`flex items-start gap-2 ${isExternal ? "text-foreground-tertiary" : "text-foreground"}`}
              >
                <input
                  checked={!isExternal && applyToDockerDaemon}
                  disabled={saving || busy || isExternal}
                  onChange={(e) => {
                    setApplyToDockerDaemon(e.target.checked);
                    setConfirmed(false);
                  }}
                  type="checkbox"
                />
                <span>
                  {t("Apply to managed engine image pulls (Docker daemon)")}
                  {isExternal ? (
                    <span className="block text-[11px] text-foreground-tertiary">
                      {t(
                        "External engines manage Docker daemon proxy settings in Docker Desktop or OrbStack."
                      )}
                    </span>
                  ) : null}
                </span>
              </label>
            </div>
          </div>
        ) : null}

        <div className="space-y-2.5 border-t border-black/[0.065] py-3 dark:border-white/[0.07]">
          {validationError ? (
            <p className="text-[12px] text-red-600 dark:text-red-400" role="alert">
              {t(validationError)}
            </p>
          ) : null}

          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              checked={confirmed}
              disabled={saving || busy}
              onChange={(e) => setConfirmed(e.target.checked)}
              type="checkbox"
            />
            <span>
              {t("Applying proxy settings briefly restarts local services and interrupts running tasks.")}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {bridge.testProxy ? (
              <button
                className={settingsSecondaryButton}
                disabled={testing || saving || Boolean(validationError)}
                onClick={() => void handleTest()}
                type="button"
              >
                <RefreshCw className={testing ? "animate-spin" : ""} size={13} />
                {t(testing ? "Testing…" : "Test proxy connection")}
              </button>
            ) : null}
            <button
              className={settingsPrimaryButton}
              disabled={busy || saving || Boolean(validationError) || !confirmed}
              onClick={() => void handleSave()}
              type="button"
            >
              {t(saving ? "Applying…" : "Save and apply proxy")}
            </button>
          </div>

          {testResult ? (
            <div className="mt-2 space-y-2 rounded-[10px] border border-black/[0.08] bg-black/[0.03] p-3 text-[12px] dark:border-white/[0.08] dark:bg-black/30">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {t(testResult.ok ? "Proxy test passed" : "Proxy test found connectivity issues")}
                </span>
                {testResult.effectiveProxy ? (
                  <span className="truncate font-mono text-[11px] text-foreground-tertiary">
                    {testResult.effectiveProxy}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1.5">
                {testResult.checks.map((check) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 text-[12px]"
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
                      {check.statusCode ? <span>HTTP {check.statusCode}</span> : null}
                      {check.latencyMs !== null ? <span>{check.latencyMs} ms</span> : null}
                      {check.error ? (
                        <span className="max-w-[280px] truncate text-red-600 dark:text-red-400">
                          {check.error}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {!testResult.ok && usesLoopback ? (
                <p className="pt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {t(
                    "Tip: if your proxy runs on 127.0.0.1, enable 'Allow LAN' in your proxy client and allow the port in Windows Firewall."
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
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
