import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWindowVisible } from "../../hooks/use-window-active";
import { useI18n } from "../../lib/i18n";
import { registerTranslations } from "../../lib/i18n-catalog";
import { type PosterCopy, scrollDirection, wrapPoster } from "../../lib/poster-showcase";
import { posterShowcaseTranslations } from "../../lib/poster-showcase-catalog";
import { type Playback, ScenePlayback } from "./poster-scene-kit";
// The room, the frame, the glass and the controls. The deployment posters' pictures live there too.
import "./setup/local-deploy-showcase.css";

// A carousel of animated posters. They always play on their own. Only the pause button stops them,
// and a window nobody can see: losing focus doesn't, and neither does a system that asks for less
// motion (pages then fade instead of moving; see the stylesheet).

registerTranslations("zh-CN", posterShowcaseTranslations);

const TICK_MS = 100;
/** How long a poster that left stays mounted to finish leaving (see the CSS). */
const LEAVE_MS = 960;

/** One set of posters: what they say, what they show and how long each stays up. */
export interface PosterDeck {
  /** The carousel's accessible name, in English; translated here. */
  label: string;
  /** Marks this carousel for its own styles, beside the shared "poster-showcase". */
  className: string;
  posters: readonly PosterCopy[];
  /** The picture for each poster, by its id. */
  scenes: Readonly<Record<string, ComponentType>>;
  durationMs: number;
  /** The poster shown last, so coming back carries on instead of starting over. */
  memory: { index: number };
}

type Layer = { turn: number; index: number };

const posterName = (t: ReturnType<typeof useI18n>["t"], posters: readonly PosterCopy[], index: number) =>
  t("Poster {current} of {total}: {title}", {
    current: index + 1,
    total: posters.length,
    title: t(posters[index]!.title),
  });

/** One light for every poster. It shifts a little with each page (--turn), so pages feel like
 *  places in the same room. */
export function ShowcaseAir() {
  return (
    <span aria-hidden="true" className="showcase-air">
      <i />
      <i />
      <i />
    </span>
  );
}

/** One poster: its picture and its words. */
export function DeckPoster({
  deck,
  index,
  playback,
  state,
}: {
  deck: PosterDeck;
  index: number;
  playback: Playback;
  state: "first" | "entering" | "leaving";
}) {
  const { t } = useI18n();
  const poster = deck.posters[index]!;
  const Scene = deck.scenes[poster.id]!;
  return (
    // biome-ignore lint/a11y/useSemanticElements: A carousel slide is a group by the ARIA pattern.
    <article
      aria-hidden={state === "leaving" || undefined}
      aria-label={posterName(t, deck.posters, index)}
      aria-roledescription="slide"
      className="showcase-poster"
      data-state={state}
      role="group"
    >
      <div aria-hidden="true" className="showcase-scene">
        <div className="showcase-canvas" data-scene={poster.id}>
          <ScenePlayback.Provider value={playback}>
            <Scene />
          </ScenePlayback.Provider>
        </div>
      </div>
      <div className="showcase-copy">
        {poster.eyebrow ? <span className="showcase-eyebrow">{t(poster.eyebrow)}</span> : null}
        <h2>{t(poster.title)}</h2>
        <p>{t(poster.body)}</p>
        {poster.points ? (
          <ul>
            {poster.points.map((point) => (
              <li key={point}>{t(point)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

/** Pages and pause on one small piece of glass, with an arrow on either side. */
export function DeckNav({
  posters,
  fill,
  index,
  onPause,
  onShow,
  paused,
}: {
  posters: readonly PosterCopy[];
  /** The bar that fills while the poster is up. */
  fill?: Ref<HTMLElement>;
  index: number;
  onPause: () => void;
  onShow: (index: number) => void;
  paused: boolean;
}) {
  const { t } = useI18n();
  return (
    <nav className="showcase-nav">
      <button
        aria-label={t("Previous poster")}
        className="showcase-arrow"
        onClick={() => onShow(wrapPoster(index, -1, posters.length))}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="size-4" strokeWidth={2.2} />
      </button>
      <div className="vg showcase-ornament">
        {posters.map((item, position) => (
          <button
            aria-current={position === index || undefined}
            aria-label={posterName(t, posters, position)}
            className="showcase-page"
            key={item.id}
            onClick={() => onShow(position)}
            type="button"
          >
            <span>{position === index ? <i ref={fill} /> : null}</span>
          </button>
        ))}
        <button
          aria-label={t(paused ? "Play posters" : "Pause posters")}
          className="showcase-toggle"
          onClick={onPause}
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
        onClick={() => onShow(wrapPoster(index, 1, posters.length))}
        type="button"
      >
        <ChevronRight aria-hidden="true" className="size-4" strokeWidth={2.2} />
      </button>
    </nav>
  );
}

export function PosterCarousel({ deck }: { deck: PosterDeck }) {
  const { t } = useI18n();
  const visible = useWindowVisible();
  const [paused, setPaused] = useState(false);
  // The poster on screen is the last layer; the one before it is still leaving.
  const [layers, setLayers] = useState<Layer[]>(() => [{ turn: 0, index: deck.memory.index }]);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const fill = useRef<HTMLElement>(null);
  const elapsed = useRef(0);
  const { index, turn } = layers.at(-1)!;
  const { memory, durationMs } = deck;
  const count = deck.posters.length;

  const show = useCallback(
    (next: number) => {
      if (next === memory.index) return;
      setDirection(scrollDirection(memory.index, next, count));
      memory.index = next;
      elapsed.current = 0;
      setLayers((shown) => {
        const top = shown.at(-1)!;
        return [top, { turn: top.turn + 1, index: next }];
      });
    },
    [memory, count]
  );

  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((shown) => shown.slice(-1)), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [layers]);

  // One clock moves the bar and the posters, so they always agree.
  const playing = !paused && visible;
  useEffect(() => {
    if (fill.current) fill.current.style.transform = `scaleX(${elapsed.current / durationMs})`;
    if (!playing) return;
    const timer = window.setInterval(() => {
      elapsed.current += TICK_MS;
      if (elapsed.current >= durationMs) show(wrapPoster(index, 1, count));
      else if (fill.current) fill.current.style.transform = `scaleX(${elapsed.current / durationMs})`;
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, index, show, count, durationMs]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    show(wrapPoster(index, event.key === "ArrowRight" ? 1 : -1, count));
  };

  return (
    <section
      aria-label={t(deck.label)}
      aria-roledescription="carousel"
      className={`poster-showcase ${deck.className} electron-no-drag`}
      data-direction={direction}
      data-paused={paused || undefined}
      data-poster={deck.posters[index]!.id}
      onKeyDown={onKeyDown}
      style={{ "--turn": turn } as CSSProperties}
    >
      <ShowcaseAir />
      <div aria-live={playing ? "off" : "polite"} className="showcase-track">
        {layers.map((layer, position) => {
          const leaving = position < layers.length - 1;
          return (
            <DeckPoster
              deck={deck}
              index={layer.index}
              key={layer.turn}
              playback={{ playing: !leaving && playing }}
              state={leaving ? "leaving" : layer.turn === 0 ? "first" : "entering"}
            />
          );
        })}
      </div>
      <DeckNav
        fill={fill}
        index={index}
        onPause={() => setPaused(!paused)}
        onShow={show}
        paused={paused}
        posters={deck.posters}
      />
    </section>
  );
}
