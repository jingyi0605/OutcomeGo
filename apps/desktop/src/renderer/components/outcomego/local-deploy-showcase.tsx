import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from "react";
import { useWindowVisible } from "../../hooks/use-window-active";
import { useI18n } from "../../lib/i18n";
import { registerTranslations } from "../../lib/i18n-catalog";
import { POSTER_MS, POSTERS, posterDirection, stepPoster } from "../../lib/local-deploy-showcase";
import { localDeployShowcaseTranslations } from "../../lib/local-deploy-showcase-catalog";
import { SCENES, ScenePlayback } from "./local-deploy-scenes";
import "./setup/local-deploy-showcase.css";

// The posters beside a running deployment: what OutcomeGo is for, told while it installs. They
// always play on their own. Only the pause button stops them, and a window nobody can see: people
// look at other windows while a deployment runs, so losing focus doesn't, and neither does a
// system that asks for less motion (pages then fade instead of moving; see the stylesheet).

registerTranslations("zh-CN", localDeployShowcaseTranslations);

const TICK_MS = 100;
/** How long a poster that left stays mounted to finish leaving (see the CSS). */
const LEAVE_MS = 960;

// The poster shown last, so trying a failed deployment again carries on instead of starting over.
let lastShown = 0;

type Layer = { turn: number; index: number };

export default memo(function DeployShowcase() {
  const { t } = useI18n();
  const visible = useWindowVisible();
  const [paused, setPaused] = useState(false);
  // The poster on screen is the last layer; the one before it is still leaving.
  const [layers, setLayers] = useState<Layer[]>(() => [{ turn: 0, index: lastShown }]);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const fill = useRef<HTMLElement>(null);
  const elapsed = useRef(0);
  const { index, turn } = layers.at(-1)!;

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

  // One clock moves the bar and the posters, so they always agree.
  const playing = !paused && visible;
  useEffect(() => {
    if (fill.current) fill.current.style.transform = `scaleX(${elapsed.current / POSTER_MS})`;
    if (!playing) return;
    const timer = window.setInterval(() => {
      elapsed.current += TICK_MS;
      if (elapsed.current >= POSTER_MS) show(stepPoster(index, 1));
      else if (fill.current) fill.current.style.transform = `scaleX(${elapsed.current / POSTER_MS})`;
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, index, show]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    show(stepPoster(index, event.key === "ArrowRight" ? 1 : -1));
  };
  const name = (position: number) =>
    t("Poster {current} of {total}: {title}", {
      current: position + 1,
      total: POSTERS.length,
      title: t(POSTERS[position]!.title),
    });

  return (
    <section
      aria-label={t("Get to know OutcomeGo")}
      aria-roledescription="carousel"
      className="deploy-showcase electron-no-drag"
      data-direction={direction}
      data-paused={paused || undefined}
      data-poster={POSTERS[index]!.id}
      onKeyDown={onKeyDown}
      style={{ "--turn": turn } as CSSProperties}
    >
      {/* One light for every poster. It shifts a little with each page, so pages feel like places
          in the same room. */}
      <span aria-hidden="true" className="showcase-air">
        <i />
        <i />
        <i />
      </span>
      <div aria-live={playing ? "off" : "polite"} className="showcase-track">
        {layers.map((layer, position) => {
          const shown = POSTERS[layer.index]!;
          const Scene = SCENES[shown.id];
          const leaving = position < layers.length - 1;
          return (
            // biome-ignore lint/a11y/useSemanticElements: A carousel slide is a group by the ARIA pattern.
            <article
              aria-hidden={leaving || undefined}
              aria-label={name(layer.index)}
              aria-roledescription="slide"
              className="showcase-poster"
              data-state={leaving ? "leaving" : layer.turn === 0 ? "first" : "entering"}
              key={layer.turn}
              role="group"
            >
              <div aria-hidden="true" className="showcase-scene">
                <div className="showcase-canvas" data-scene={shown.id}>
                  <ScenePlayback.Provider value={{ playing: !leaving && playing }}>
                    <Scene />
                  </ScenePlayback.Provider>
                </div>
              </div>
              <div className="showcase-copy">
                <h2>{t(shown.title)}</h2>
                <p>{t(shown.body)}</p>
              </div>
            </article>
          );
        })}
      </div>
      <nav className="showcase-nav">
        <button
          aria-label={t("Previous poster")}
          className="showcase-arrow"
          onClick={() => show(stepPoster(index, -1))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={2.2} />
        </button>
        <div className="vg showcase-ornament">
          {POSTERS.map((item, position) => (
            <button
              aria-current={position === index || undefined}
              aria-label={name(position)}
              className="showcase-page"
              key={item.id}
              onClick={() => show(position)}
              type="button"
            >
              <span>{position === index ? <i ref={fill} /> : null}</span>
            </button>
          ))}
          <button
            aria-label={t(paused ? "Play posters" : "Pause posters")}
            className="showcase-toggle"
            onClick={() => setPaused(!paused)}
            type="button"
          >
            {paused ? (
              <Play aria-hidden="true" className="size-3" fill="currentColor" strokeWidth={0} />
            ) : (
              <Pause aria-hidden="true" className="size-3" fill="currentColor" strokeWidth={0} />
            )}
          </button>
        </div>
        <button
          aria-label={t("Next poster")}
          className="showcase-arrow"
          onClick={() => show(stepPoster(index, 1))}
          type="button"
        >
          <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2.2} />
        </button>
      </nav>
    </section>
  );
});
