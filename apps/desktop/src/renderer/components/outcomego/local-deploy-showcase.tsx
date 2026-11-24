import { Check, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from "react";
import { useWindowActive } from "../../hooks/use-window-active";
import { useI18n } from "../../lib/i18n";
import { registerTranslations } from "../../lib/i18n-catalog";
import { POSTER_MS, POSTERS, posterDirection, stepPoster } from "../../lib/local-deploy-showcase";
import { localDeployShowcaseTranslations } from "../../lib/local-deploy-showcase-catalog";
import { SCENES, ScenePlayback } from "./local-deploy-scenes";
import "./setup/local-deploy-showcase.css";

// The posters beside a running deployment: what OutcomeGo is for, told while it installs. They
// scroll on their own, wait while the controls are in use or the window is in the background,
// and can be paused, stepped and jumped to.

registerTranslations("zh-CN", localDeployShowcaseTranslations);

const TICK_MS = 100;
/** How long a poster that scrolled away stays mounted to finish leaving (see the CSS). */
const LEAVE_MS = 720;

// The poster shown last, so trying a failed deployment again carries on instead of starting over.
let lastShown = 0;

const prefersStill = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Whether the person asked for less motion, followed live. */
function useStill() {
  const [still, setStill] = useState(prefersStill);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setStill(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return still;
}

type Layer = { turn: number; index: number };

export default memo(function DeployShowcase() {
  const { t } = useI18n();
  const still = useStill();
  const windowActive = useWindowActive();
  // With reduced motion nothing moves on its own until the person presses play.
  const [paused, setPaused] = useState(prefersStill);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The poster on screen is the last layer; the one before it is still scrolling away.
  const [layers, setLayers] = useState<Layer[]>(() => [{ turn: 0, index: lastShown }]);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const fill = useRef<HTMLElement>(null);
  const elapsed = useRef(0);
  const current = layers.at(-1)!;
  const { index } = current;
  const poster = POSTERS[index]!;

  const show = useCallback((next: number) => {
    if (next === lastShown) return;
    setDirection(posterDirection(lastShown, next));
    lastShown = next;
    elapsed.current = 0;
    setLayers((shown) => {
      const top = shown.at(-1)!;
      return [top, { turn: top.turn + 1, index: next }];
    });
  }, []);

  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((shown) => shown.slice(-1)), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [layers]);

  // One clock moves the bar and the posters, so they always agree. It only counts while playing.
  const advancing = !paused && !hovered && !focused && windowActive;
  useEffect(() => {
    if (fill.current) fill.current.style.transform = `scaleX(${elapsed.current / POSTER_MS})`;
    if (!advancing) return;
    const timer = window.setInterval(() => {
      elapsed.current += TICK_MS;
      if (elapsed.current >= POSTER_MS) show(stepPoster(index, 1));
      else if (fill.current) fill.current.style.transform = `scaleX(${elapsed.current / POSTER_MS})`;
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [advancing, index, show]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    show(stepPoster(index, event.key === "ArrowRight" ? 1 : -1));
  };
  // Only keyboard focus holds the poster: a mouse click leaves focus on its button, and must
  // not stop the rotation for good.
  const onFocus = (event: FocusEvent<HTMLElement>) => setFocused(event.target.matches(":focus-visible"));

  return (
    <section
      aria-label={t("Get to know OutcomeGo")}
      aria-roledescription="carousel"
      className="deploy-showcase electron-no-drag"
      data-direction={direction}
      data-night={poster.night}
      data-paused={paused || undefined}
      data-poster={poster.id}
      onBlur={() => setFocused(false)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <div aria-live={advancing ? "off" : "polite"} className="showcase-track">
        {layers.map((layer, position) => {
          const shown = POSTERS[layer.index]!;
          const Scene = SCENES[shown.id];
          const leaving = position < layers.length - 1;
          return (
            // biome-ignore lint/a11y/useSemanticElements: A carousel slide is a group by the ARIA pattern.
            <article
              aria-hidden={leaving || undefined}
              aria-label={t("Poster {current} of {total}: {title}", {
                current: layer.index + 1,
                total: POSTERS.length,
                title: t(shown.title),
              })}
              aria-roledescription="slide"
              className="showcase-poster"
              data-night={shown.night}
              data-state={leaving ? "leaving" : layer.turn === 0 ? "first" : "entering"}
              key={layer.turn}
              role="group"
            >
              <div aria-hidden="true" className="showcase-scene">
                <div className="showcase-canvas" data-scene={shown.id}>
                  <ScenePlayback.Provider value={{ playing: !leaving && !paused && windowActive, still }}>
                    <Scene />
                  </ScenePlayback.Provider>
                </div>
              </div>
              <div className="showcase-copy">
                <p className="showcase-eyebrow">
                  <b>{String(layer.index + 1).padStart(2, "0")}</b>
                  {t(shown.eyebrow)}
                </p>
                <h2>{t(shown.title)}</h2>
                <p className="showcase-body">{t(shown.body)}</p>
                <ul className="showcase-points">
                  {shown.points.map((point) => (
                    <li key={point}>
                      <Check aria-hidden="true" className="size-3" strokeWidth={3.2} />
                      {t(point)}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
      {/* Only the controls hold the poster under the pointer: the stage fills the window, so a
          pointer left resting on it must not stop the posters. */}
      <nav
        className="showcase-nav"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <div className="showcase-pages">
          {POSTERS.map((item, position) => (
            <button
              aria-current={position === index || undefined}
              aria-label={t("Poster {current} of {total}: {title}", {
                current: position + 1,
                total: POSTERS.length,
                title: t(item.title),
              })}
              key={item.id}
              onClick={() => show(position)}
              type="button"
            >
              <span>{position === index ? <i ref={fill} /> : null}</span>
            </button>
          ))}
        </div>
        <div className="showcase-controls">
          <button
            aria-label={t(paused ? "Play posters" : "Pause posters")}
            onClick={() => setPaused(!paused)}
            type="button"
          >
            {paused ? (
              <Play aria-hidden="true" className="size-3.5" fill="currentColor" strokeWidth={0} />
            ) : (
              <Pause aria-hidden="true" className="size-3.5" fill="currentColor" strokeWidth={0} />
            )}
          </button>
          <button aria-label={t("Previous poster")} onClick={() => show(stepPoster(index, -1))} type="button">
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <button aria-label={t("Next poster")} onClick={() => show(stepPoster(index, 1))} type="button">
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </nav>
    </section>
  );
});
