import { Boxes, Check, Container, RefreshCw } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { EngineProbe, EngineProbes } from "../../lib/local-deploy-contract";
import type { EngineKind, EngineOption } from "../../lib/local-deploy-flow";
import "./setup/local-deploy.css";

const unknown: EngineProbe = { state: "unknown", reasons: [] };

/**
 * A read-only look at the container engines this computer could use, asked for on arrival and
 * again on request. A look that can't be made leaves both as "unknown" so the choice still works.
 */
export function useEngineProbes(enabled: boolean) {
  const [probes, setProbes] = useState<EngineProbes | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const bridge = window.outcomego?.localDeploy;
    const failed: EngineProbes = { external: unknown, managed: unknown };
    if (!bridge?.engines) {
      setProbes(failed);
      return;
    }
    let live = true;
    setProbes(null);
    bridge.engines().then((next) => live && setProbes(next)).catch(() => live && setProbes(failed));
    return () => {
      live = false;
    };
  }, [enabled, round]);
  return { probes, recheck: useCallback(() => setRound((count) => count + 1), []) };
}

const TITLES: Record<EngineKind, string> = {
  external: "Use an existing container engine",
  managed: "Use the OutcomeGo managed engine",
};

/** Where to deploy: the engine already on this computer, or the one OutcomeGo sets up itself. */
export function EnginePicker({
  options,
  selected,
  onSelect,
  onRecheck,
  disabled,
}: {
  options: readonly EngineOption[];
  selected: EngineKind | null;
  onSelect: (kind: EngineKind) => void;
  onRecheck: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const checking = options.some((option) => option.tone === "checking");
  const nothingToUse = !checking && options.every((option) => !option.selectable);
  return (
    <fieldset className="deploy-engines" disabled={disabled}>
      <legend className="sr-only">{t("Container engine")}</legend>
      <div className="deploy-engines-head">
        <span aria-hidden="true" className="setup-label">
          {t("Container engine")}
        </span>
        <button className="deploy-recheck" disabled={checking || disabled} onClick={onRecheck} type="button">
          <RefreshCw aria-hidden="true" className="size-3" data-spin={checking || undefined} />
          {t(checking ? "Checking…" : "Check again")}
        </button>
      </div>
      <div className="deploy-engine-list">
        {options.map((option, index) => (
          <label
            className="deploy-engine"
            data-disabled={!option.selectable || undefined}
            data-kind={option.kind}
            data-selected={selected === option.kind || undefined}
            data-tone={option.tone}
            key={option.kind}
            style={{ "--i": index } as CSSProperties}
          >
            <input
              checked={selected === option.kind}
              disabled={!option.selectable}
              name="deploy-engine"
              onChange={() => onSelect(option.kind)}
              type="radio"
              value={option.kind}
            />
            <span aria-hidden="true" className="deploy-engine-tile">
              {option.kind === "external" ? (
                <Container className="size-[18px]" strokeWidth={2} />
              ) : (
                <Boxes className="size-[18px]" strokeWidth={2} />
              )}
            </span>
            <span className="deploy-engine-body">
              <strong>{t(TITLES[option.kind])}</strong>
              <span className="deploy-engine-sub">
                <small>{t(option.about)}</small>
                {option.recommended ? <span className="deploy-engine-badge">{t("Recommended")}</span> : null}
              </span>
              <span className="deploy-engine-status" data-tone={option.tone} key={`${option.tone}:${option.status}`}>
                <i aria-hidden="true" />
                <b>
                  {t(option.status)}
                  {option.meta ? <em> · {option.meta}</em> : null}
                </b>
                <span>{t(option.detail)}</span>
              </span>
            </span>
            <span aria-hidden="true" className="deploy-engine-radio">
              <Check className="size-3" strokeWidth={3.2} />
            </span>
          </label>
        ))}
      </div>
      {nothingToUse ? (
        <p className="setup-note" data-tone="error" role="alert">
          {t("Neither engine can run here. Install a Docker-compatible engine, or connect to an existing server.")}
        </p>
      ) : selected === null && !checking ? (
        <p className="setup-note">{t("OutcomeGo picks the engine for you when you deploy.")}</p>
      ) : null}
    </fieldset>
  );
}
