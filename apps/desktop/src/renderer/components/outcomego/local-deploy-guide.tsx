import {
  Boxes,
  Check,
  Container,
  Cpu,
  HardDrive,
  Info,
  type LucideIcon,
  MemoryStick,
  Network,
  Plug,
  Power,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../lib/i18n";
import type {
  EngineAdvice,
  EngineKind,
  EngineOption,
  HostResourceReport,
  ResourceCheckItem,
  ResourceTone,
} from "../../lib/local-deploy-flow";
import { EngineArt } from "./local-deploy-engine-art";
import { DeployHint } from "./local-deploy-hint";
import "./setup/local-deploy.css";

// The picture beside the engine choice: the two ways to run OutcomeGo drawn side by side, then
// this computer's resources as dials. It speaks in pictures; the sentences behind each icon show
// on hover, focus or press, and only a choice that needs the person to act is spelled out.

type Fact = { text: string; kind: "plus" | "minus"; icon: LucideIcon };
const FACTS: Record<EngineKind, readonly Fact[]> = {
  external: [
    { text: "Uses the engine you already have", kind: "plus", icon: Plug },
    { text: "Images follow your engine's own settings", kind: "plus", icon: SlidersHorizontal },
    { text: "Needs a running, compatible engine", kind: "minus", icon: Power },
  ],
  managed: [
    { text: "Set up automatically on first deploy", kind: "plus", icon: Sparkles },
    { text: "Tests image sources and picks the fastest", kind: "plus", icon: Zap },
    { text: "Takes its own memory and disk", kind: "minus", icon: MemoryStick },
  ],
};
const TITLES: Record<EngineKind, string> = { external: "Existing engine", managed: "OutcomeGo engine" };

const RESOURCE_ICONS: Record<ResourceCheckItem["id"], LucideIcon> = {
  memory: MemoryStick,
  disk: HardDrive,
  cpu: Cpu,
  port: Network,
};

const TONE_ICONS: Partial<Record<ResourceTone, LucideIcon>> = { pass: Check, warn: TriangleAlert, fail: X };

/** One resource as a dial: how much there is and, when that falls short, where enough begins. */
function Dial({ item }: { item: ResourceCheckItem }) {
  const Icon = RESOURCE_ICONS[item.id];
  const Mark = TONE_ICONS[item.tone];
  const short = item.tone === "warn" || item.tone === "fail";
  // A port has no amount: its ring is whole once the answer is known.
  const fill = item.tone === "checking" ? 0.25 : item.tone === "unknown" ? 0 : (item.ratio ?? 1);
  return (
    <span aria-hidden="true" className="deploy-dial">
      <svg aria-hidden="true" viewBox="0 0 56 56">
        <circle className="deploy-dial-track" cx="28" cy="28" r="24" />
        <circle
          className="deploy-dial-fill"
          cx="28"
          cy="28"
          pathLength={100}
          r="24"
          style={{ "--fill": fill } as CSSProperties}
        />
        {short && item.threshold !== undefined ? (
          <path className="deploy-dial-notch" d="M48.5 28h7" transform={`rotate(${item.threshold * 360} 28 28)`} />
        ) : null}
      </svg>
      <Icon className="deploy-dial-icon" strokeWidth={2} />
      {Mark ? (
        <i className="deploy-dial-mark" key={item.tone}>
          <Mark strokeWidth={3.2} />
        </i>
      ) : null}
    </span>
  );
}

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
  // A plain good suggestion is already drawn (the badge); words are for when there is
  // something to do about it. When neither engine can be picked, the list beside the picture
  // already says so.
  const spellOut =
    options.some((option) => option.selectable) &&
    (advice.tone === "info" || options.some((option) => option.recommended && option.tone === "attention"));
  const SummaryIcon = TONE_ICONS[resources.tone] ?? ShieldCheck;

  return (
    <div className="deploy-guide" data-busy={busy || undefined}>
      <div className="deploy-guide-lanes">
        {options.map((option, index) => {
          const managed = option.kind === "managed";
          const isSelected = selected === option.kind;
          const isDisabled = !option.selectable;
          const interactive = Boolean(onSelect && option.selectable);
          // The OutcomeGo engine is a virtual machine on macOS and a WSL 2 distribution on Windows.
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
              <span aria-hidden="true" className="deploy-lane-sheen">
                <i />
              </span>
              <header>
                <span aria-hidden="true" className="deploy-lane-icon">
                  {managed ? <Boxes className="size-4" strokeWidth={2.1} /> : <Container className="size-4" strokeWidth={2.1} />}
                </span>
                <strong>{t(TITLES[option.kind])}</strong>
                {option.recommended ? (
                  <DeployHint
                    className="deploy-engine-badge"
                    tip={<>
                      <b>{t(advice.headline)}</b>
                      <span>{t(advice.detail)}</span>
                    </>}
                    wrapper="deploy-lane-badge"
                  >
                    <Star aria-hidden="true" className="size-3" fill="currentColor" strokeWidth={0} />
                    {t("Recommended")}
                  </DeployHint>
                ) : null}
              </header>
              <EngineArt live={isSelected && !isDisabled} option={option} platform={platform} />
              <footer className="deploy-lane-foot">
                <DeployHint
                  className="deploy-lane-caption"
                  tip={<>
                    <b>{t(option.status)}</b>
                    <span>{t(option.detail)}</span>
                    <span>{engineName}</span>
                    <span>{t(managed ? "Separate from your own Docker" : "Runs next to your other containers")}</span>
                  </>}
                >
                  <span>{t(managed ? "Isolated space" : "Shared engine")}</span>
                  <Info aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
                </DeployHint>
                <ul className="deploy-pips">
                  {FACTS[option.kind].map((fact, position) => (
                    <li key={fact.text} style={{ "--n": position } as CSSProperties}>
                      <DeployHint className="deploy-pip" data-kind={fact.kind} label={t(fact.text)} tip={t(fact.text)}>
                        <fact.icon aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
                      </DeployHint>
                    </li>
                  ))}
                </ul>
              </footer>
            </section>
          );
        })}
      </div>

      <section aria-label={t("System requirements & check")} className="deploy-resources" data-tone={resources.tone}>
        <div className="deploy-resource-grid">
          {resources.items.map((item, index) => (
            <DeployHint
              className="deploy-resource-button"
              data-id={item.id}
              data-tone={item.tone}
              key={item.id}
              style={{ "--i": index } as CSSProperties}
              tip={<>
                <b>{t(item.label)} · {t(item.status)}</b>
                {item.tone === "checking" ? null : <span>{t(item.actual, item.actualValues)}</span>}
                <span>{t(item.requirement, item.requirementValues)}</span>
                {item.id === "port" ? <span className="deploy-tip-ports">{item.requirementValues?.port} · 6200–6299</span> : null}
              </>}
              wrapper="deploy-resource"
            >
              <Dial item={item} />
              {item.tone === "checking" ? (
                <span aria-hidden="true" className="deploy-resource-skeleton" />
              ) : (
                <strong>{item.short ? t(item.short, item.actualValues) : "—"}</strong>
              )}
              <small>{t(item.label)}</small>
            </DeployHint>
          ))}
        </div>

        <DeployHint
          className="deploy-resources-summary"
          data-tone={resources.tone}
          key={`${resources.tone}:${resources.summary}`}
          tip={<>
            <b>{t("System requirements & check")}</b>
            <span>{t("Local resources required to run OutcomeGo server and bots")}</span>
          </>}
          wrapper="deploy-resources-verdict"
        >
          <i aria-hidden="true">
            <SummaryIcon className="size-5" strokeWidth={2.4} />
          </i>
          <span>{t(resources.summary)}</span>
        </DeployHint>

        {resources.note ? (
          <p className="deploy-resources-note" data-tone={resources.note.tone} role="status">
            {resources.note.tone === "fail" ? (
              <X aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
            ) : (
              <TriangleAlert aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
            )}
            <span>{t(resources.note.text, resources.note.values)}</span>
          </p>
        ) : null}
      </section>

      {spellOut ? (
        <div className="deploy-guide-advice" data-tone={advice.tone} key={`${advice.tone}:${advice.headline}`}>
          <i aria-hidden="true" />
          <strong>{t(advice.headline)}</strong>
          <span>{t(advice.detail)}</span>
        </div>
      ) : null}
    </div>
  );
}
