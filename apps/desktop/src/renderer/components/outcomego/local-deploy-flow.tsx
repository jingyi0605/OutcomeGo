import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { codes, type DeploymentResult, type DeployProgress } from "../../lib/local-deploy-contract";
import { deployIssue, deployProgress, emptyProgress, engineAdvice, engineOptions, type EngineKind, suggestedEngine } from "../../lib/local-deploy-flow";
import { EnginePicker, useEngineProbes } from "./local-deploy-engines";
import { EngineGuideVisual } from "./local-deploy-guide";
import { DeployProgressPanel } from "./local-deploy-progress";
import { DeployShowcaseVisual } from "./local-deploy-showcase-visual";
import { SetupLayout, SetupLink, SetupPrimary, useCopied } from "./setup/setup-layout";

export default function LocalDeployFlow({ onBack, onConnect }: {
  onBack(): void;
  onConnect(result: DeploymentResult, password: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [apiPort, setApiPort] = useState("");
  const [resuming, setResuming] = useState(false);
  // The engine the person clicked; until then, the one suggested from what was found.
  const [chosen, setChosen] = useState<EngineKind | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const platform = window.outcomego?.platform;
  const choosesEngine = platform === "win32" || platform === "darwin";
  const { probes, recheck } = useEngineProbes(choosesEngine);
  const [progress, setProgress] = useState<ReturnType<typeof emptyProgress> | null>(null);
  const [loginError, setLoginError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, copy] = useCopied();
  const active = useRef(false);
  const cancelPending = useRef(false);
  const id = useRef<string | null>(null);
  const started = useRef(0);
  const receive = useRef<(event: DeployProgress) => void>(() => undefined);
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const clearPassword = () => { setPassword(""); setConfirmation(""); };
  const showCode = (code: typeof codes[number], action?: "elevate" | "reboot") => {
    setProgress(deployProgress(emptyProgress(), { schemaVersion: 1, deployId: "", ts: new Date().toISOString(), stage: "detect", type: "error", code, retryable: true,
      ...(action ? { action: { kind: action } } : {}) }));
  };
  useEffect(() => {
    let mounted = true;
    const server = window.outcomego?.localServer;
    if (server?.status) void server.status().then((status) => {
      if (!mounted) return;
      setResuming(Boolean(status.awaiting));
      if (status.ownerUsername) setUsername(current => current || status.ownerUsername!);
      if (status.awaiting && platform === "win32") setChosen("managed");
      if (status.awaiting === "elevation" && platform === "win32") showCode("WSL_NOT_ENABLED", "elevate");
    }).catch(() => undefined);
    return () => {
      mounted = false;
      active.current = false;
      unsubscribe.current?.();
      if (id.current) void window.outcomego?.localDeploy?.cancel(id.current).catch(() => undefined);
    };
  }, [platform]);
  useEffect(() => {
    if (!progress?.busy) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [progress?.busy]);
  useEffect(() => {
    if (progress?.issue?.field) document.getElementById(`deploy-${progress.issue.field}`)?.focus();
  }, [progress?.issue?.field]);

  receive.current = (event) => {
    setProgress(previous => deployProgress(previous ?? emptyProgress(), event));
    if (event.type !== "error" && event.type !== "result") return;
    id.current = null;
    unsubscribe.current?.();
    if (event.type === "error") {
      active.current = false;
      if (event.code === "CANCELLED" || event.action?.kind === "elevate" || event.action?.kind === "reboot") clearPassword();
      return;
    }
    const login = onConnect(event.result, password);
    clearPassword();
    void login.then(() => setProgress(null)).catch(() => {
      setLoginError(true);
      setProgress(null);
    }).finally(() => { active.current = false; });
  };

  const start = async (acceptLowMemory = false) => {
    const bridge = window.outcomego?.localDeploy;
    if (!bridge || active.current || authorizing || !username.trim() || !password || password !== confirmation) return;
    active.current = true;
    cancelPending.current = false;
    setLoginError(false);
    setProgress(emptyProgress());
    setElapsed(0);
    started.current = Date.now();
    const early: DeployProgress[] = [];
    const stop = bridge.onProgress(event => {
      if (id.current === event.deployId) receive.current(event);
      else if (!id.current && early.length < 32) early.push(event);
    });
    unsubscribe.current = stop;
    try {
      const { deployId } = await bridge.start({ username, password, engine: requestEngine, ...(apiPort ? { apiPort: Number(apiPort) } : {}), acceptLowMemory });
      if (!active.current) {
        await bridge.cancel(deployId);
        return;
      }
      id.current = deployId;
      if (cancelPending.current) void bridge.cancel(deployId).catch(() => undefined);
      for (const event of early) if (id.current === event.deployId) receive.current(event);
    } catch (error) {
      stop();
      active.current = false;
      const code = codes.find(item => error instanceof Error && error.message.endsWith(item)) ?? "UNKNOWN";
      showCode(code);
    }
  };
  const enableWsl = async () => {
    const bridge = window.outcomego?.localDeploy;
    if (!bridge?.enableWsl || active.current || authorizing || platform !== "win32") return;
    setAuthorizing(true);
    clearPassword();
    try {
      const { code } = await bridge.enableWsl(true);
      if (!code) { setProgress(null); setResuming(true); recheck(); }
      else showCode(code, code === "REBOOT_REQUIRED" ? "reboot" : "elevate");
    } catch { showCode("ENGINE_START_FAILED", "elevate"); }
    finally { setAuthorizing(false); }
  };
  const busy = Boolean(progress?.busy);
  const field = progress?.issue?.field;
  const canStart = Boolean(username.trim() && password && password === confirmation);
  const options = engineOptions(probes, platform, resuming);
  const suggested = suggestedEngine(options);
  const selected = chosen && options.find(option => option.kind === chosen)?.selectable ? chosen : suggested;
  // Without a choice or a suggestion (nothing found, or the look failed), the command line decides.
  const requestEngine: "auto" | EngineKind = choosesEngine ? selected ?? "auto" : "auto";
  const canEnable = platform === "win32" && progress?.action?.kind === "elevate" && requestEngine !== "external";
  // The right side explains the two choices while one is being made; while it deploys, the
  // posters take over (local-deploy-showcase.tsx).
  const guide = choosesEngine && !busy
    ? <EngineGuideVisual advice={engineAdvice(options, resuming)} options={options} platform={platform} selected={selected} />
    : undefined;
  const issueLabel = progress?.issue ? t(deployIssue(progress.issue.code)) : "";
  const issueDetail = progress?.issue?.message ?? progress?.action?.detail;
  return (
    <SetupLayout title={t("Deploy on this computer")} screenKey="local-deploy" stage={0}
      body={t(busy ? "You can cancel at any time." : "Your data stays on this computer.")}
      onBack={busy ? undefined : onBack} onSubmit={() => void start()}
      visual={busy ? <DeployShowcaseVisual /> : guide} visualInteractive={busy}
      footer={busy ? <SetupLink onClick={() => {
        cancelPending.current = true;
        if (id.current) void window.outcomego?.localDeploy?.cancel(id.current).catch(() => undefined);
      }}>{t("Cancel")}</SetupLink> : <>
        <SetupPrimary disabled={!canStart || authorizing}>{t(progress?.issue ? "Retry" : "Deploy locally")}</SetupPrimary>
        {canEnable && !authorizing ? <SetupLink onClick={() => void enableWsl()}>{t("Authorize WSL setup")}</SetupLink> : null}
        {progress?.action?.kind === "confirm-low-memory" && canStart ? <SetupLink onClick={() => void start(true)}>{t("Continue anyway")}</SetupLink> : null}
        {progress?.issue ? <SetupLink onClick={() => void window.outcomego?.localServer?.diagnostics().then(copy).catch(() => undefined)}>{t(copied ? "Copied" : "Copy diagnostics")}</SetupLink> : null}
      </>}>
      {busy && progress ? <DeployProgressPanel progress={progress} platform={platform} engine={requestEngine} elapsed={elapsed} />
      : <div className="flex flex-col gap-2">
        {resuming ? <p className="setup-note">{t("Continue deployment by entering your password again.")}</p> : null}
        {choosesEngine ? <EnginePicker options={options} selected={selected} disabled={authorizing} onRecheck={recheck}
          onSelect={kind => { setChosen(kind); setProgress(null); }} /> : null}
        <label className="setup-label" htmlFor="deploy-username">{t("Username")}</label>
        <input id="deploy-username" className="setup-input" autoComplete="username" aria-invalid={field === "username"} value={username} onChange={event => setUsername(event.target.value)} />
        <label className="setup-label" htmlFor="deploy-password">{t("Password")}</label>
        <input id="deploy-password" className="setup-input" type="password" autoComplete="new-password" aria-invalid={field === "password"} value={password} onChange={event => setPassword(event.target.value)} />
        <label className="setup-label" htmlFor="deploy-confirmation">{t("Confirm owner password")}</label>
        <input id="deploy-confirmation" className="setup-input" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        {progress?.issue?.code === "PORT_IN_USE" || field === "apiPort" ? <>
          <label className="setup-label" htmlFor="deploy-apiPort">{t("Local API port")}</label>
          <input id="deploy-apiPort" className="setup-input" type="number" min={1} max={65535} placeholder="8787" value={apiPort} onChange={event => setApiPort(event.target.value)} />
        </> : null}
        {progress?.issue ? <p className="setup-note" data-tone="error" role="alert">{issueLabel}{issueDetail && issueDetail !== issueLabel ? ` ${issueDetail}` : ""}</p> : null}
        {canEnable || authorizing ? <p className="setup-note">{t("Administrator approval is required to enable WSL and Virtual Machine Platform.")}</p> : null}
        {platform === "win32" && requestEngine !== "external" && progress?.issue?.code === "MEMORY_LOW" ?
          <p className="setup-note">{t("To give WSL more memory, edit .wslconfig manually and restart WSL.")}</p> : null}
        {loginError ? <p className="setup-note" data-tone="error" role="alert">{t("Could not sign in to OutcomeGo")}</p> : null}
      </div>}
    </SetupLayout>
  );
}
