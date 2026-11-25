import { Check, CircleAlert, Minus } from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../lib/i18n";
import { type Stage, stages } from "../../lib/local-deploy-contract";
import {
  activeStage,
  type DeployProgressState,
  deployFraction,
  type EngineKind,
  imageSources,
  type ImageSource,
  stageCopy,
  stepState,
} from "../../lib/local-deploy-flow";
import { LoadingOrb } from "../ui/loading-orb";
import { CrossFade } from "./setup/cross-fade";
import "./setup/local-deploy.css";

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Which registry the images come from. The OutcomeGo engine tests the official source and two
 * mirrors and uses the fastest; your own engine keeps its own settings.
 */
function ImageSources({ sources, engine }: { sources: readonly ImageSource[]; engine: EngineKind | "auto" }) {
  const { t } = useI18n();
  const managed = engine === "managed" || (engine === "auto" && sources.length > 0);
  if (!managed) {
    return engine === "external" ? (
      <p className="deploy-sources-note">{t("Images come from your engine's own settings. OutcomeGo changes nothing in Docker.")}</p>
    ) : null;
  }
  const current = sources.at(-1);
  const name = imageSources.find((source) => source.id === current)?.name;
  return (
    <section aria-label={t("Image source")} className="deploy-sources">
      <header>
        <strong>{t("Image source")}</strong>
        <span>{name ? t("Downloading from {name}", { name: t(name) }) : t("Testing which source is fastest…")}</span>
      </header>
      <ul>
        {imageSources.map((source) => {
          const state = source.id === current ? "active" : sources.includes(source.id) ? "used" : current ? "idle" : "testing";
          return (
            <li data-state={state} key={source.id}>
              <i aria-hidden="true" />
              <span>
                <b>{t(source.name)}</b>
                <small>{t(source.detail)}</small>
              </span>
              <em>{state === "active" ? t("In use") : state === "used" ? t("Used") : state === "testing" ? t("Testing…") : ""}</em>
            </li>
          );
        })}
      </ul>
      <p>{t("OutcomeGo uses the fastest one and switches on its own if it fails. Your Docker settings stay unchanged.")}</p>
    </section>
  );
}

/** The deployment as a bar and a timeline: what is happening now, in plain words, and what is left. */
export function DeployProgressPanel({
  progress,
  platform,
  engine,
  elapsed,
}: {
  progress: DeployProgressState;
  platform: string | undefined;
  engine: EngineKind | "auto";
  elapsed: number;
}) {
  const { t } = useI18n();
  const active = activeStage(progress);
  const copy = stageCopy(active, platform, engine);
  const fraction = deployFraction(progress);
  const position = stages.indexOf(active) + 1;
  const counting = active === "pull" && progress.total ? progress.total : 0;
  return (
    <div className="deploy-progress">
      <div className="deploy-head" role="status">
        <span className="deploy-step-count">{t("Step {step} of {total}", { step: position, total: stages.length })}</span>
        <strong>
          <CrossFade value={t(copy.title)} />
        </strong>
        <p>
          <CrossFade value={t(copy.note)} />
        </p>
      </div>
      <div
        aria-label={t(copy.title)}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(fraction * 100)}
        className="deploy-meter"
        role="progressbar"
        style={{ "--fill": fraction } as CSSProperties}
      >
        <span className="deploy-meter-fill" />
      </div>
      <div className="deploy-meta">
        <span>{counting ? t("{current} of {total} images downloaded", { current: progress.current ?? 0, total: counting }) : ""}</span>
        <span>{t("{time} elapsed", { time: clock(elapsed) })}</span>
      </div>
      {active === "pull" ? <ImageSources engine={engine} sources={progress.sources} /> : null}
      <details className="deploy-all">
        <summary>{t("All steps")}</summary>
        <ol className="deploy-steps">
        {stages.map((stage: Stage, index) => {
          const state = stepState(progress, stage);
          return (
            <li data-state={state} key={stage} style={{ "--i": index } as CSSProperties}>
              <span aria-hidden="true" className="deploy-step-mark">
                {state === "done" ? (
                  <Check className="size-3" strokeWidth={3.2} />
                ) : state === "skipped" ? (
                  <Minus className="size-3" strokeWidth={3} />
                ) : state === "failed" ? (
                  <CircleAlert className="size-3" strokeWidth={2.6} />
                ) : state === "active" ? (
                  <LoadingOrb aria-hidden size={14} />
                ) : null}
              </span>
              <span className="deploy-step-title">{t(stageCopy(stage, platform, engine).title)}</span>
              {state === "skipped" ? <small>{t("Already done")}</small> : null}
            </li>
          );
        })}
        </ol>
      </details>
    </div>
  );
}
