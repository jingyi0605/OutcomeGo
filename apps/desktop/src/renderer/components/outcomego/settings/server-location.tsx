import { ArrowRightLeft, HardDrive, MemoryStick, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { changeServer as forgetServer, clearAuthCredentialsForServerChange, testServerConnection } from "../../../client/auth";
import { API_BASE } from "../../../client/http";
import { saveConfiguredApiBase } from "../../../client/runtime-url";
import { useI18n } from "../../../lib/i18n";
import type { LocalServerStatus } from "../../../lib/local-deploy-contract";
import { canDeleteLocalData, isLocalServer, localMemoryChange, serverStateLabel } from "../../../lib/server-location";
import { serverAddressProblem } from "../../../lib/server-address";
import { reloadInto } from "../first-run-shell";
import { SectionLabel, SettingsGroup, SettingsRow, settingsInput, settingsSecondaryButton } from "./ui";

export default function ServerLocationSettings() {
  const { t } = useI18n();
  const bridge = window.outcomego?.localServer;
  const preferences = window.outcomego?.backgroundPreferences;
  const [snapshot, setSnapshot] = useState<LocalServerStatus>();
  const [stopOnQuit, setStopOnQuit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState(false);
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<"remove" | "memory" | "switch" | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [word, setWord] = useState("");
  const [computer, setComputer] = useState("");
  const [desktop, setDesktop] = useState("");
  const [memoryConfirmed, setMemoryConfirmed] = useState(false);
  useEffect(() => {
    let current = true;
    void bridge?.status?.().then(value => { if (current) setSnapshot(value); }).catch(() => { if (current) setIssue(true); });
    void preferences?.get().then(value => { if (current) setStopOnQuit(value.stopServiceOnQuit); }).catch(() => undefined);
    return () => { current = false; };
  }, [bridge, preferences]);
  if (!bridge?.status || !["win32", "darwin"].includes(window.outcomego?.platform ?? "")) return null;
  const local = isLocalServer(API_BASE, snapshot?.apiPort ?? null);
  const state = snapshot?.stack.state;
  const working = busy || state === "starting" || state === "removing" || state === "updating";
  const run = async (operation: () => Promise<LocalServerStatus>) => {
    if (working) return;
    setBusy(true);
    setIssue(false);
    try { setSnapshot(await operation()); setMode(null); }
    catch { setIssue(true); }
    finally { setBusy(false); }
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
    } catch { setIssue(true); }
    finally { setBusy(false); }
  };
  const guest = snapshot?.engine?.memoryBytes;
  const memory = localMemoryChange(computer, desktop, guest);
  const remove = (purgeData: boolean) => run(async () => {
    const next = await bridge.remove({ purgeData });
    await forgetServer();
    return next;
  });
  return <section aria-label={t("Server location")} className="my-7">
    <SectionLabel>{t("Server location")}</SectionLabel>
    <SettingsGroup>
      <SettingsRow title={t(local ? "On this computer" : "Remote server")}
        description={state ? t(serverStateLabel(state)) : t("Checking server…")}
        control={<button className={settingsSecondaryButton} disabled={working} onClick={() => setMode(mode === "switch" ? null : "switch")} type="button"><ArrowRightLeft size={14} />{t("Switch server")}</button>} />
      {local && state && state !== "not-installed" ? <SettingsRow title={t("Local services")} control={<div className="flex flex-wrap justify-end gap-2">
        <button className={settingsSecondaryButton} disabled={working} onClick={() => void run(state === "running" ? bridge.stop : bridge.start)} type="button">
          {state === "running" ? <Square size={14} /> : <Play size={14} />}{t(state === "running" ? "Stop local services" : "Start local services")}
        </button>
        <button className={settingsSecondaryButton} disabled={working} onClick={() => { setMode("memory"); setMemoryConfirmed(false); }} type="button"><MemoryStick size={14} />{t("Memory limits")}</button>
        <button className={settingsSecondaryButton} disabled={working} onClick={() => { setMode("remove"); setPermanent(false); setWord(""); }} type="button"><Trash2 size={14} />{t("Remove local services")}</button>
      </div>} /> : null}
      {local && preferences ? <SettingsRow title={t("Stop local services when quitting")} control={<input aria-label={t("Stop local services when quitting")} type="checkbox" checked={stopOnQuit}
        onChange={event => { const checked = event.target.checked; void preferences.set(checked).then(value => setStopOnQuit(value.stopServiceOnQuit)).catch(() => setIssue(true)); }} />} /> : null}
    </SettingsGroup>
    {mode === "switch" ? <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void changeServer(address); }}>
      {!local && snapshot?.apiPort && snapshot.stack.state === "running" ? <button className={settingsSecondaryButton} disabled={working} type="button" onClick={() => void changeServer(`http://127.0.0.1:${snapshot.apiPort}`)}><HardDrive size={14} />{t("Use local server")}</button> : null}
      <input aria-label={t("Server address")} placeholder="https://example.com" className={settingsInput} value={address} onChange={event => setAddress(event.target.value)} />
      <button className={settingsSecondaryButton} type="submit" disabled={working || !address.trim()}>{t("Connect")}</button>
    </form> : null}
    {mode === "remove" && local ? <div className="mt-3 flex flex-col items-start gap-2">
      <button className={settingsSecondaryButton} type="button" disabled={working} onClick={() => void remove(false)}>{t("Remove services and keep data")}</button>
      <label><input type="checkbox" checked={permanent} onChange={event => setPermanent(event.target.checked)} /> {t("Permanently delete local data")}</label>
      {permanent ? <>
        <label htmlFor="remove-local-confirmation">{t("This cannot be undone. Type DELETE to confirm.")}</label>
        <input id="remove-local-confirmation" className={settingsInput} value={word} onChange={event => setWord(event.target.value)} />
        <button className={settingsSecondaryButton} type="button" disabled={working || !canDeleteLocalData(permanent, word)} onClick={() => void remove(true)}>{t("Permanently delete local data")}</button>
      </> : null}
    </div> : null}
    {mode === "memory" && local ? <div className="mt-3 flex flex-col items-start gap-2">
      <label>{t("Computer memory limit")} <input className={settingsInput} placeholder="4g" value={computer} onChange={event => { setComputer(event.target.value); setMemoryConfirmed(false); }} /></label>
      <label>{t("Desktop memory limit")} <input className={settingsInput} placeholder="3g" value={desktop} onChange={event => { setDesktop(event.target.value); setMemoryConfirmed(false); }} /></label>
      {!memory ? <p>{t("Enter at least 1 GiB for each limit, for example 4g.")}</p> : null}
      {memory?.capped ? <p>{t("The engine will cap this value at 75% of its memory.")}</p> : null}
      <label><input type="checkbox" checked={memoryConfirmed} onChange={event => setMemoryConfirmed(event.target.checked)} /> {t("Changing memory limits interrupts running tasks.")}</label>
      <button className={settingsSecondaryButton} type="button" disabled={working || !memory || !memoryConfirmed} onClick={() => {
        if (memory && memoryConfirmed) void run(() => bridge.resources({ computerMemory: memory.computerMemory, desktopMemory: memory.desktopMemory }));
      }}>{t("Apply memory limits")}</button>
    </div> : null}
    {mode ? <button className={`${settingsSecondaryButton} mt-2`} type="button" onClick={() => setMode(null)}>{t("Cancel")}</button> : null}
    {issue ? <p className="mt-2 text-sm" role="alert">{t("The local service operation did not finish.")}</p> : null}
  </section>;
}
