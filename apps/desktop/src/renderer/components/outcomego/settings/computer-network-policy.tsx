import type {
  ComputerNetworkPolicyMode,
  ComputerNetworkPolicyRule,
  ComputerNetworkPolicyView,
} from "@outcomego/contracts";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { useI18n } from "../../../lib/i18n";
import type { TranslationValues } from "../../../lib/i18n-catalog";
import { LoadingOrb } from "../../ui/loading-orb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import {
  settingsInput,
  settingsPrimaryButton,
  settingsSecondaryButton,
  settingsSelect,
} from "./ui";

const MODE_DESCRIPTION: Record<ComputerNetworkPolicyMode, string> = {
  lan: "Allow private LAN TCP destinations. Public traffic still uses the managed exit.",
  allowlist: "Allow only the rules below and configured model endpoints.",
};

const runtimeLabel = (
  view: ComputerNetworkPolicyView | null,
  t: (value: string, values?: TranslationValues) => string
) => {
  if (!view) return t("Loading…");
  switch (view.runtime.state) {
    case "applied":
      return t("Applied revision {revision}", {
        revision: view.runtime.appliedRevision ?? "unknown",
      });
    case "applying":
      return t("Applying…");
    case "pending":
      return t("Waiting for Computer…");
    case "error":
      return view.runtime.error ?? t("Computer could not apply the policy");
    default:
      return t("Computer status unavailable");
  }
};

export function ComputerNetworkPolicyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<ComputerNetworkPolicyView | null>(null);
  const [mode, setMode] = useState<ComputerNetworkPolicyMode>("lan");
  const [rules, setRules] = useState<ComputerNetworkPolicyRule[]>([]);
  const [address, setAddress] = useState("");
  const [port, setPort] = useState("");
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const next = await api.computerNetworkPolicy();
    setView(next);
    setMode(next.policy.mode);
    setRules(next.policy.rules);
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    void api
      .computerNetworkPolicy()
      .then((next) => {
        if (!active) return;
        setView(next);
        setMode(next.policy.mode);
        setRules(next.policy.rules);
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : t("Could not load the network policy")));
    return () => {
      active = false;
    };
  }, [open, t]);

  useEffect(() => {
    if (!open || !view) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 2_000);
    return () => clearInterval(timer);
  }, [open, view?.policy.revision]);

  const editing = useMemo(
    () => (editingId ? rules.find((rule) => rule.id === editingId) ?? null : null),
    [editingId, rules]
  );

  const resetRuleForm = () => {
    setEditingId(null);
    setAddress("");
    setPort("");
    setLabel("");
  };

  const saveRule = () => {
    const nextPort = Number(port);
    if (!address.trim() || !Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) {
      setError(t("Enter a private IP address and a TCP port from 1 to 65535."));
      return;
    }
    const nextRule: ComputerNetworkPolicyRule = {
      id: editing?.id ?? `rule-${Date.now()}`,
      address: address.trim(),
      port: nextPort,
      label: label.trim() || null,
    };
    const duplicate = rules.some(
      (rule) => rule.id !== nextRule.id && rule.address === nextRule.address && rule.port === nextRule.port
    );
    if (duplicate) {
      setError(t("That address and port are already listed."));
      return;
    }
    setRules((current) =>
      editing ? current.map((rule) => (rule.id === nextRule.id ? nextRule : rule)) : [...current, nextRule]
    );
    setError(null);
    resetRuleForm();
  };

  const save = async () => {
    if (!view || busy) return;
    if (mode === "allowlist" && rules.length === 0) {
      setError(t("Add at least one rule or choose another mode."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await api.updateComputerNetworkPolicy({
        expectedRevision: view.policy.revision,
        mode,
        rules,
      });
      setView(next);
      setMode(next.policy.mode);
      setRules(next.policy.rules);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not save the network policy"));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(next) => !busy && onOpenChange(next)} open={open}>
      <DialogContent className="max-h-[82vh] max-w-[620px] gap-4 overflow-y-auto p-5">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{t("Computer network policy")}</DialogTitle>
          <DialogDescription className="text-[12px] leading-4">
            {t("Manage the cloud computer’s private LAN firewall policy. Public traffic continues to use the managed exit.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-[12px] text-foreground-secondary">{t("Private network mode")}</span>
            <select
              aria-label={t("Private network mode")}
              className={`${settingsSelect} w-full`}
              disabled={busy}
              onChange={(event) => setMode(event.target.value as ComputerNetworkPolicyMode)}
              value={mode}
            >
              <option value="lan">{t("LAN access")}</option>
              <option value="allowlist">{t("Allowlist")}</option>
            </select>
            <span className="text-[12px] leading-4 text-foreground-secondary">{t(MODE_DESCRIPTION[mode])}</span>
          </label>

          <div className="rounded-[10px] bg-black/[0.045] px-3 py-2 text-[12px] leading-4 dark:bg-white/[0.07]">
            <div className="flex items-center justify-between gap-3">
              <span>{t("Computer status")}</span>
              <span className="text-foreground-secondary">{runtimeLabel(view, t)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 text-foreground-secondary">
              <span>{t("Automatic model endpoint exceptions")}</span>
              <span>{view?.runtime.modelEndpointCount ?? "—"}</span>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-foreground-secondary">{t("Manual TCP rules")}</span>
              <span className="text-[12px] text-foreground-tertiary">{rules.length}/128</span>
            </div>
            {rules.map((rule) => (
              <div className="flex items-center gap-2 rounded-[9px] bg-black/[0.04] px-2.5 py-2 text-[12px] dark:bg-white/[0.06]" key={rule.id}>
                <span className="min-w-0 flex-1 font-mono">
                  {rule.address}:{rule.port}
                  {rule.label ? <span className="ml-2 font-sans text-foreground-secondary">{rule.label}</span> : null}
                </span>
                <button className={settingsSecondaryButton} disabled={busy} onClick={() => {
                  setEditingId(rule.id);
                  setAddress(rule.address);
                  setPort(String(rule.port));
                  setLabel(rule.label ?? "");
                }} type="button">
                  {t("Edit")}
                </button>
                <button className={settingsSecondaryButton} disabled={busy} onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))} type="button">
                  {t("Remove")}
                </button>
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
              <input aria-label={t("Private IP address")} className={`${settingsInput} font-mono`} disabled={busy} onChange={(event) => setAddress(event.target.value)} placeholder="10.0.0.10" value={address} />
              <input aria-label={t("TCP port")} className={`${settingsInput} font-mono`} disabled={busy} inputMode="numeric" onChange={(event) => setPort(event.target.value)} placeholder="3425" value={port} />
            </div>
            <div className="flex gap-2">
              <input aria-label={t("Rule label")} className={`${settingsInput} min-w-0 flex-1`} disabled={busy} onChange={(event) => setLabel(event.target.value)} placeholder={t("Optional label")} value={label} />
              <button className={settingsSecondaryButton} disabled={busy} onClick={saveRule} type="button">
                {editing ? t("Update rule") : t("Add rule")}
              </button>
              {editing ? <button className={settingsSecondaryButton} disabled={busy} onClick={resetRuleForm} type="button">{t("Cancel")}</button> : null}
            </div>
          </div>

          {error ? <div className="text-[12px] text-red-600 dark:text-red-400" role="alert">{error}</div> : null}
        </div>

        <DialogFooter className="mt-1 flex-row justify-end gap-2">
          <button className={settingsSecondaryButton} disabled={busy} onClick={() => onOpenChange(false)} type="button">{t("Close")}</button>
          <button className={settingsPrimaryButton} disabled={!view || busy} onClick={() => void save()} type="button">
            {busy ? <LoadingOrb aria-hidden size={14} /> : null}
            {busy ? t("Saving…") : t("Apply policy")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
