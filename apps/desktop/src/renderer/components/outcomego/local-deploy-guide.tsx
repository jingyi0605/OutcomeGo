import { Bot, Boxes, Check, Container, Laptop, Minus } from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../lib/i18n";
import type { EngineAdvice, EngineKind, EngineOption } from "../../lib/local-deploy-flow";
import "./setup/local-deploy.css";

// The picture beside the engine choice: the two ways to run OutcomeGo side by side, each drawn
// as the layers it stacks on this computer, with what sets them apart and what is suggested.
// Everything here restates what the CLI does (apps/cli/src/engine): an existing engine is used
// as it is, the OutcomeGo engine is its own virtual machine or WSL 2 environment.

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

export function EngineGuideVisual({
  options,
  selected,
  advice,
  platform,
  busy = false,
}: {
  options: readonly EngineOption[];
  selected: EngineKind | null;
  advice: EngineAdvice;
  platform: string | undefined;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="deploy-guide" data-busy={busy || undefined}>
      <div className="deploy-guide-lanes">
        {options.map((option, index) => {
          const managed = option.kind === "managed";
          // A detected engine is named as it reported itself; the OutcomeGo engine is a virtual
          // machine on macOS and a WSL 2 distribution on Windows.
          const engineName = managed
            ? platform === "darwin" ? t("OutcomeGo virtual machine") : "OutcomeGo WSL 2"
            : option.meta ?? t("Docker-compatible engine");
          return (
            <section
              className="deploy-lane"
              data-kind={option.kind}
              data-recommended={option.recommended || undefined}
              data-selected={selected === option.kind || undefined}
              data-tone={option.tone}
              key={option.kind}
              style={{ "--i": index } as CSSProperties}
            >
              <header>
                <strong>{t(TITLES[option.kind])}</strong>
                {option.recommended ? <span className="deploy-engine-badge">{t("Recommended")}</span> : null}
              </header>
              <div aria-hidden="true" className="deploy-stack">
                <div className="deploy-layer" data-layer="apps">
                  <Bot className="size-4" strokeWidth={2} />
                  <span>{t("OutcomeGo server and bots")}</span>
                </div>
                <i className="deploy-link" />
                <div className="deploy-layer" data-layer="engine">
                  {managed ? <Boxes className="size-4" strokeWidth={2} /> : <Container className="size-4" strokeWidth={2} />}
                  <span>{engineName}</span>
                  <em data-tone={option.tone}>
                    <i />
                    {t(option.status)}
                  </em>
                </div>
                <i className="deploy-link" />
                <div className="deploy-layer" data-layer="host">
                  <Laptop className="size-4" strokeWidth={2} />
                  <span>{t("This computer")}</span>
                </div>
                <small className="deploy-apart">
                  {t(managed ? "Separate from your own Docker" : "Runs next to your other containers")}
                </small>
              </div>
              <ul className="deploy-facts">
                {FACTS[option.kind].map((fact) => (
                  <li data-kind={fact.kind} key={fact.text}>
                    {fact.kind === "plus" ? (
                      <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
                    ) : (
                      <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} />
                    )}
                    <span>{t(fact.text)}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="deploy-guide-advice" data-tone={advice.tone} key={`${advice.tone}:${advice.headline}`}>
        <i aria-hidden="true" />
        <strong>{t(advice.headline)}</strong>
        <span>{t(advice.detail)}</span>
      </div>
    </div>
  );
}
