import type { DingTalkActionInput, DingTalkStatus } from "@outcomego/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { useI18n } from "../../../lib/i18n";
import { clientErrorMessage } from "@outcomego/product-core/redaction";
import { LoadingOrb } from "../../ui/loading-orb";

const button = "inline-flex min-h-8 items-center justify-center gap-2 rounded-full bg-foreground/[0.07] px-3 text-[12px] hover:bg-foreground/[0.12] disabled:cursor-wait disabled:opacity-45";
const defaultDomains = new Set(["chat", "contact", "doc", "drive", "todo"]);

export function DingTalkSetup({
  onStatusChange,
}: {
  onStatusChange?: (status: DingTalkStatus) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<DingTalkStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const mounted = useRef(false);
  const fetching = useRef(false);
  const opened = useRef(new Set<string>());
  const operation = status?.operation;
  const running = operation?.status === "running";
  const authorization = running ? operation.authorization : undefined;
  const prompt = running ? operation.prompt : undefined;
  const organizationAccess = operation?.organizationAccess;

  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const next = await api.dingTalkStatus();
      if (mounted.current) {
        setStatus(next);
        onStatusChange?.(next);
        setError("");
      }
    } catch (cause) {
      if (mounted.current) setError(clientErrorMessage(cause, "Could not read DingTalk status."));
    } finally { fetching.current = false; }
  }, [onStatusChange]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { mounted.current = false; window.removeEventListener("focus", refresh); };
  }, [refresh]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [running, refresh]);
  useEffect(() => {
    if (!authorization || opened.current.has(authorization.url)) return;
    opened.current.add(authorization.url);
    window.open(authorization.url, "_blank", "noopener,noreferrer");
  }, [authorization?.url]);
  useEffect(() => {
    if (!prompt) return;
    setSelection(prompt.kind === "scope" ? [prompt.options[0]!.value] : prompt.options
      .filter((option) => defaultDomains.has(option.label.split(/\s+/)[0]!)).map((option) => option.value));
  }, [prompt?.id]);

  const act = async (input: DingTalkActionInput) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.dingTalkAction(input);
      if (mounted.current) {
        setStatus(next);
        onStatusChange?.(next);
      }
    } catch (cause) {
      if (mounted.current) setError(clientErrorMessage(cause, "DingTalk operation failed."));
    } finally { if (mounted.current) setBusy(false); }
  };

  return (
    <section className="mt-6 rounded-[12px] border border-foreground/10 p-4" aria-label={t("DingTalk connection")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium">{t("DingTalk connection")}</h3>
        <span role="status" className={status?.connection === "connected" && !running ? "text-[12px] text-emerald-600 dark:text-emerald-400" : "text-[12px] text-foreground-secondary"}>
          {running ? operation.kind === "install" ? t("Installing DWS…") : operation.kind === "upgrade" ? t("Upgrading DWS…") : t("Awaiting DingTalk authorization…")
            : !status ? t("Checking DWS…") : status.connection === "connected" ? t("Connected") : status.connection === "disconnected" ? t("Not connected") : t("Status unavailable")}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-foreground-secondary">{t("DWS and your DingTalk login belong to the Bot Computer. Bots using this Computer share the login.")}</p>
      {status?.installed ? <p className="mt-2 text-[12px]">
        {t("DWS version")}: <code>{status.version ?? t("Unknown")}</code>
        {status.latestVersion ? <span className="text-foreground-secondary"> · {t("Latest")}: <code>{status.latestVersion}</code></span> : null}
      </p> : null}
      {status?.account ? <p className="mt-1 text-[12px]">{status.account.userName} · {status.account.corpName}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {status && !status.installed ? <button className={button} type="button" disabled={busy || running} onClick={() => void act({ action: "install" })}>{t("Install DWS")}</button> : null}
        {status?.installed ? <>
          {status.updateAvailable ? <button className={button} type="button" disabled={busy || running} onClick={() => void act({ action: "upgrade" })}>{t("Upgrade DWS")}</button> : null}
          <button className={button} type="button" disabled={busy || running} onClick={() => void act({ action: "authenticate" })}>{status.connection === "connected" ? t("Reconnect") : t("Authenticate DingTalk")}</button>
        </> : null}
        <button className={button} type="button" disabled={busy || running} onClick={() => void refresh()}>{t("Refresh status")}</button>
        {running ? <button className={button} type="button" disabled={busy} onClick={() => void act({ action: "cancel", operationId: operation.id })}>{t("Cancel")}</button> : null}
        {busy || running ? <LoadingOrb aria-hidden size={14} /> : null}
      </div>
      {authorization ? <div className="mt-3 space-y-2 text-[12px]">
        <p>{authorization.stage === "pat" ? t("Complete the additional permission authorization in DingTalk.") : t("Approve the DingTalk sign-in in your browser.")}</p>
        {authorization.userCode ? <p>{t("Authorization code")}: <code className="select-all">{authorization.userCode}</code></p> : null}
        <a className="underline" href={authorization.url} target="_blank" rel="noopener noreferrer">{t("Open authorization page")}</a>
      </div> : null}
      {prompt ? <form className="mt-3 space-y-2 text-[12px]" onSubmit={(event) => {
        event.preventDefault();
        void act({ action: "respond", operationId: operation!.id, promptId: prompt.id, values: selection });
      }}>
        <p>{prompt.kind === "scope" ? t("Choose the DingTalk authorization scope.") : t("Choose the business domains to authorize. Only the workspace domains are selected by default.")}</p>
        <div className="grid gap-2 sm:grid-cols-2">{prompt.options.map((option) => <label className="flex items-start gap-2" key={option.value}>
          <input type={prompt.kind === "scope" ? "radio" : "checkbox"} name="dingtalk-scope" checked={selection.includes(option.value)} disabled={busy}
            onChange={(event) => setSelection((current) => prompt.kind === "scope" ? [option.value] : event.target.checked ? [...current, option.value] : current.filter((value) => value !== option.value))} />
          <span>{option.label}</span>
        </label>)}</div>
        <button className={button} disabled={busy || !selection.length} type="submit">{t("Continue")}</button>
      </form> : null}
      {organizationAccess ? <div role="alert" className="mt-3 rounded-[10px] border border-amber-500/25 bg-amber-500/[0.08] p-3 text-[12px] leading-5">
        <p className="font-medium">{t("DingTalk CLI access is not enabled for this organization.")}</p>
        <p className="mt-1 text-foreground-secondary">{t("Ask an enterprise administrator to enable CLI access in Developer Platform → CLI Access Management, then authenticate DingTalk again.")}</p>
        <a className={`${button} mt-2`} href={organizationAccess.documentationUrl} target="_blank" rel="noopener noreferrer">
          {t("Open the official DingTalk CLI access guide")}
        </a>
      </div> : null}
      {!organizationAccess && (error || status?.error || operation?.error) ? <p role="alert" className="mt-3 text-[12px] text-red-600 dark:text-red-400">{error || status?.error || operation?.error}</p> : null}
      {status?.updateError ? <p className="mt-2 text-[12px] text-foreground-secondary">{t("Could not check for DWS updates. Refresh status to try again.")}</p> : null}
      {operation?.status === "succeeded" && operation.kind !== "authenticate" ? <p className="mt-2 text-[12px] text-foreground-secondary">{t("DWS is ready. The version above was read from the Computer.")}</p> : null}
    </section>
  );
}
