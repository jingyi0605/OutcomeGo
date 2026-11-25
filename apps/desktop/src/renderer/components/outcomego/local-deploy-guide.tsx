import {
  AlertTriangle,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  Container,
  Cpu,
  Gauge,
  HardDrive,
  Laptop,
  MemoryStick,
  Minus,
  Network,
  XCircle,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../lib/i18n";
import type {
  EngineAdvice,
  EngineKind,
  EngineOption,
  HostResourceReport,
  ResourceCheckItem,
} from "../../lib/local-deploy-flow";
import "./setup/local-deploy.css";

// The picture beside the engine choice: the two ways to run OutcomeGo side by side, each drawn
// as the layers it stacks on this computer, followed by live local resource checks against the
// server's requirements and a clear recommendation.

type Fact = { text: string; kind: "plus" | "minus" };
const FACTS: Record<EngineKind, readonly Fact[]> = {
  external: [
    { text: "Uses the engine you already have", kind: "plus" },
    { text: "Images follow your engine's own settings", kind: "plus" },
    { text: "Needs a running, compatible engine", kind: "minus" },
  ],
  managed: [
    { text: "Set up automatically on first deploy", kind: "plus" },
    { text: "Tests image sources and picks the fastest", kind: "plus" },
    { text: "Takes its own memory and disk", kind: "minus" },
  ],
};
const TITLES: Record<EngineKind, string> = { external: "Your container engine", managed: "OutcomeGo engine" };

const ResourceIcon = ({ id }: { id: ResourceCheckItem["id"] }) => {
  switch (id) {
    case "memory":
      return <MemoryStick className="size-4" strokeWidth={2} />;
    case "disk":
      return <HardDrive className="size-4" strokeWidth={2} />;
    case "cpu":
      return <Cpu className="size-4" strokeWidth={2} />;
    case "port":
      return <Network className="size-4" strokeWidth={2} />;
  }
};

const SummaryIcon = ({ tone }: { tone: HostResourceReport["tone"] }) => {
  switch (tone) {
    case "pass":
      return <CheckCircle2 aria-hidden="true" className="size-3.5" strokeWidth={2.4} />;
    case "warn":
      return <AlertTriangle aria-hidden="true" className="size-3.5" strokeWidth={2.4} />;
    case "fail":
      return <XCircle aria-hidden="true" className="size-3.5" strokeWidth={2.4} />;
    default:
      return <i aria-hidden="true" className="deploy-summary-dot" />;
  }
};

export function EngineGuideVisual({
  options,
  selected,
  advice,
  resources,
  platform,
  onSelect,
  busy = false,
}: {
  options: readonly EngineOption[];
  selected: EngineKind | null;
  advice: EngineAdvice;
  resources: HostResourceReport;
  platform: string | undefined;
  onSelect?: (kind: EngineKind) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const hostTag = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : undefined;

  return (
    <div className="deploy-guide" data-busy={busy || undefined}>
      <div className="deploy-guide-lanes">
        {options.map((option, index) => {
          const managed = option.kind === "managed";
          const isSelected = selected === option.kind;
          const isDisabled = !option.selectable;
          const interactive = Boolean(onSelect && option.selectable);
          // A detected engine is named as it reported itself; the OutcomeGo engine is a virtual
          // machine on macOS and a WSL 2 distribution on Windows.
          const engineName = managed
            ? platform === "darwin" ? t("OutcomeGo virtual machine") : "OutcomeGo WSL 2"
            : option.meta ?? t("Docker-compatible engine");
          return (
            <section
              className="deploy-lane"
              data-disabled={isDisabled || undefined}
              data-interactive={interactive || undefined}
              data-kind={option.kind}
              data-recommended={option.recommended || undefined}
              data-selected={isSelected || undefined}
              data-tone={option.tone}
              key={option.kind}
              onClick={interactive ? () => onSelect?.(option.kind) : undefined}
              style={{ "--i": index } as CSSProperties}
            >
              <span aria-hidden="true" className="deploy-lane-sheen" />
              <header>
                <span aria-hidden="true" className="deploy-lane-icon">
                  {managed ? <Boxes className="size-4" strokeWidth={2.1} /> : <Container className="size-4" strokeWidth={2.1} />}
                </span>
                <strong>{t(TITLES[option.kind])}</strong>
                {option.recommended ? (
                  <span className="deploy-engine-badge">{t("Recommended")}</span>
                ) : isDisabled ? (
                  <span className="deploy-engine-badge" data-tone="unavailable">{t("Not available")}</span>
                ) : null}
              </header>
              <div aria-hidden="true" className="deploy-stack">
                <div className="deploy-layer" data-layer="apps">
                  <Bot className="size-4" strokeWidth={2} />
                  <span>{t("OutcomeGo server and bots")}</span>
                  {isSelected && !isDisabled ? <i className="deploy-layer-live" /> : null}
                </div>
                <span className="deploy-link">
                  <i />
                  <i />
                </span>
                <div className="deploy-layer" data-layer="engine" data-tone={option.tone}>
                  {managed ? <Boxes className="size-4" strokeWidth={2} /> : <Container className="size-4" strokeWidth={2} />}
                  <span>{engineName}</span>
                  <em data-tone={option.tone}>
                    <i />
                    {t(option.status)}
                  </em>
                </div>
                <span className="deploy-link">
                  <i />
                  <i />
                </span>
                <div className="deploy-layer" data-layer="host">
                  <Laptop className="size-4" strokeWidth={2} />
                  <span>{t("This computer")}</span>
                  {hostTag ? <kbd className="deploy-host-tag">{hostTag}</kbd> : null}
                </div>
                <small className="deploy-apart">
                  {t(managed ? "Separate from your own Docker" : "Runs next to your other containers")}
                </small>
              </div>
              <ul className="deploy-facts">
                {FACTS[option.kind].map((fact) => (
                  <li data-kind={fact.kind} key={fact.text}>
                    <span aria-hidden="true" className="deploy-fact-mark">
                      {fact.kind === "plus" ? (
                        <Check className="size-3" strokeWidth={3} />
                      ) : (
                        <Minus className="size-3" strokeWidth={3} />
                      )}
                    </span>
                    <span>{t(fact.text)}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section aria-label={t("System requirements & check")} className="deploy-resources" data-tone={resources.tone}>
        <header className="deploy-resources-head">
          <div className="deploy-resources-title">
            <span aria-hidden="true" className="deploy-resources-icon">
              <Gauge className="size-4" strokeWidth={2.1} />
            </span>
            <div>
              <strong>{t("System requirements & check")}</strong>
              <small>{t("Local resources required to run OutcomeGo server and bots")}</small>
            </div>
          </div>
          <span className="deploy-resources-summary" data-tone={resources.tone} key={`${resources.tone}:${resources.summary}`}>
            <SummaryIcon tone={resources.tone} />
            <span>{t(resources.summary)}</span>
          </span>
        </header>

        <div className="deploy-resource-grid">
          {resources.items.map((item, index) => (
            <div
              className="deploy-resource"
              data-id={item.id}
              data-tone={item.tone}
              key={item.id}
              style={{ "--i": index } as CSSProperties}
            >
              <div className="deploy-resource-top">
                <span aria-hidden="true" className="deploy-resource-icon">
                  <ResourceIcon id={item.id} />
                </span>
                <span className="deploy-resource-label">{t(item.label)}</span>
                <span className="deploy-resource-badge" data-tone={item.tone} key={`${item.tone}:${item.status}`}>
                  <i aria-hidden="true" />
                  {t(item.status)}
                </span>
              </div>

              <div className="deploy-resource-value">
                {item.tone === "checking" ? (
                  <span aria-hidden="true" className="deploy-resource-skeleton" />
                ) : (
                  <strong>{t(item.actual, item.actualValues)}</strong>
                )}
                <small>{t(item.requirement, item.requirementValues)}</small>
              </div>

              {item.id === "port" ? (
                <div aria-hidden="true" className="deploy-resource-ports">
                  <span data-tone={item.tone}>{item.requirementValues?.port ?? 8787}</span>
                  <span>6200–6299</span>
                </div>
              ) : (
                <div aria-hidden="true" className="deploy-resource-bar" data-tone={item.tone}>
                  <span
                    className="deploy-resource-fill"
                    style={{ "--fill": item.ratio ?? 0 } as CSSProperties}
                  />
                  {item.threshold !== undefined ? (
                    <i className="deploy-resource-mark" style={{ "--mark": item.threshold } as CSSProperties} />
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>

        {resources.note ? (
          <p className="deploy-resources-note" data-tone={resources.note.tone} role="status">
            {resources.note.tone === "fail" ? (
              <XCircle aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
            ) : (
              <AlertTriangle aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
            )}
            <span>{t(resources.note.text, resources.note.values)}</span>
          </p>
        ) : null}
      </section>

      <div className="deploy-guide-advice" data-tone={advice.tone} key={`${advice.tone}:${advice.headline}`}>
        <i aria-hidden="true" />
        <strong>{t(advice.headline)}</strong>
        <span>{t(advice.detail)}</span>
      </div>
    </div>
  );
}
