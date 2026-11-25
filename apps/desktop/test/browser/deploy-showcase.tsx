import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/renderer/styles.css";
import DeployShowcase, {
  ShowcaseAir,
  ShowcaseNav,
  ShowcasePoster,
} from "../../src/renderer/components/outcomego/local-deploy-showcase";
import { StageBackdrop } from "../../src/renderer/components/outcomego/setup/setup-layout";
import { I18nProvider, useI18n } from "../../src/renderer/lib/i18n";
import { POSTER_MS, POSTERS, stepPoster } from "../../src/renderer/lib/local-deploy-showcase";
import "./deploy-showcase.css";

// The posters beside a running deployment, on their own: hold one, step its story beat by beat, slow
// it down, see all of them at once, or let the real carousel run. The posters are the app's own
// components, so edits to local-deploy-scenes.tsx and local-deploy-showcase.css show up at once.
// Everything chosen lives in the address, so a reload or a hot update keeps it. Params: ?view=single|
// grid|carousel, ?poster=<id>, ?beat=<n>, ?speed=0.1…2, ?size=<id>, ?theme=dark, ?lang=en-US, ?loop=0,
// ?motion=0 (hold endless motion), ?panel=0 (posters only).

type View = "single" | "grid" | "carousel";

const VIEWS: readonly { id: View; label: string }[] = [
  { id: "single", label: "单页" },
  { id: "grid", label: "总览" },
  { id: "carousel", label: "轮播" },
];
const SPEEDS = [0.1, 0.25, 0.5, 1, 2] as const;
// The stage at some window sizes: the window less the panel beside it, which is 40vw within 400–500.
const SIZES = [
  { id: "default", label: "默认窗口 1470×920", width: 970, height: 920 },
  { id: "hd", label: "全高清 1920×1080", width: 1420, height: 1080 },
  { id: "laptop", label: "笔记本 1280×800", width: 780, height: 800 },
  { id: "small", label: "小窗口 920×640", width: 520, height: 640 },
  { id: "narrow", label: "最窄 861×600", width: 461, height: 600 },
  { id: "fill", label: "铺满右侧", width: 0, height: 0 },
] as const;

interface Settings {
  view: View;
  poster: number;
  /** The beat the story is held at; null lets it play. */
  held: number | null;
  speed: number;
  size: string;
  dark: boolean;
  lang: "zh-CN" | "en-US";
  loop: boolean;
  motion: boolean;
  panel: boolean;
}

const readSettings = (): Settings => {
  const params = new URLSearchParams(window.location.search);
  const beat = params.get("beat");
  const speed = Number(params.get("speed") ?? 1);
  return {
    view: VIEWS.find((view) => view.id === params.get("view"))?.id ?? "single",
    poster: Math.max(0, POSTERS.findIndex((poster) => poster.id === params.get("poster"))),
    held: beat === null ? null : Math.max(0, Math.floor(Number(beat)) || 0),
    speed: speed > 0 ? speed : 1,
    size: SIZES.find((size) => size.id === params.get("size"))?.id ?? "default",
    dark: params.get("theme") === "dark",
    lang: params.get("lang") === "en-US" ? "en-US" : "zh-CN",
    loop: params.get("loop") !== "0",
    motion: params.get("motion") !== "0",
    panel: params.get("panel") !== "0",
  };
};

const writeSettings = (settings: Settings) => {
  const params = new URLSearchParams();
  if (settings.view !== "single") params.set("view", settings.view);
  params.set("poster", POSTERS[settings.poster]!.id);
  if (settings.held !== null) params.set("beat", String(settings.held));
  if (settings.speed !== 1) params.set("speed", String(settings.speed));
  if (settings.size !== "default") params.set("size", settings.size);
  if (settings.dark) params.set("theme", "dark");
  if (settings.lang !== "zh-CN") params.set("lang", settings.lang);
  if (!settings.loop) params.set("loop", "0");
  if (!settings.motion) params.set("motion", "0");
  if (!settings.panel) params.set("panel", "0");
  window.history.replaceState(null, "", `?${params}`);
};

// Speed: the stories' timers are stretched, and every running animation and transition follows.
let rate = readSettings().speed;
const nativeTimeout = window.setTimeout.bind(window);
const nativeInterval = window.setInterval.bind(window);
window.setTimeout = ((run: () => void, ms = 0) => nativeTimeout(run, ms / rate)) as typeof window.setTimeout;
window.setInterval = ((run: () => void, ms = 0) => nativeInterval(run, ms / rate)) as typeof window.setInterval;
const paceAnimations = () => {
  for (const animation of document.getAnimations()) {
    if (animation.playbackRate !== rate) animation.playbackRate = rate;
  }
  requestAnimationFrame(paceAnimations);
};
requestAnimationFrame(paceAnimations);

/** The stage as setup draws it (setup-layout.tsx), at one size, scaled to fit. */
function Stage({ children, height, scale, width }: { children: ReactNode; height: number; scale: number; width: number }) {
  return (
    <div className="qa-box" style={{ width: width * scale, height: height * scale }}>
      <main className="setup-shell qa-shell" style={{ width, height, transform: `scale(${scale})` }}>
        <aside className="setup-stage">
          <StageBackdrop />
          <div className="setup-visual">{children}</div>
        </aside>
      </main>
    </div>
  );
}

/** One poster in the showcase's own frame. */
function Poster({
  held,
  index,
  motion,
  onBeat,
  onPause,
  onShow,
}: {
  held: number | null;
  index: number;
  motion: boolean;
  onBeat?: (beat: number, last: number) => void;
  onPause: () => void;
  onShow: (index: number) => void;
}) {
  const fill = useRef<HTMLElement>(null);
  useEffect(() => {
    if (fill.current) fill.current.style.transform = "scaleX(1)";
  }, [index]);
  return (
    <section
      className="deploy-showcase"
      data-direction="forward"
      data-paused={motion ? undefined : true}
      data-poster={POSTERS[index]!.id}
      style={{ "--turn": index } as CSSProperties}
    >
      <ShowcaseAir />
      <div className="showcase-track">
        <ShowcasePoster index={index} playback={{ playing: true, held: held ?? undefined, onBeat }} state="first" />
      </div>
      <ShowcaseNav fill={fill} index={index} onPause={onPause} onShow={onShow} paused={held !== null} />
    </section>
  );
}

function Choices<T extends string | number>({
  label,
  onPick,
  options,
  value,
}: {
  label: string;
  onPick: (value: T) => void;
  options: readonly { id: T; label: string }[];
  value: T | null;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="qa-choices">
        {options.map((option) => (
          <button aria-pressed={option.id === value} key={option.id} onClick={() => onPick(option.id)} type="button">
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Debugger() {
  const { t } = useI18n();
  const [settings, setSettings] = useState(readSettings);
  const [story, setStory] = useState({ beat: 0, last: 0 });
  // A new run plays the story again from its first beat.
  const [run, setRun] = useState(0);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const areaRef = useRef<HTMLDivElement>(null);
  const { view, poster, held, speed, size, dark, lang, loop, motion, panel } = settings;

  const change = useCallback((next: Partial<Settings>) => setSettings((current) => ({ ...current, ...next })), []);
  const replay = useCallback(() => {
    change({ held: null });
    setRun((current) => current + 1);
  }, [change]);
  const showPoster = useCallback(
    (index: number) => {
      change({ poster: index, held: null });
      setRun((current) => current + 1);
    },
    [change]
  );
  const onBeat = useCallback((beat: number, last: number) => setStory({ beat, last }), []);

  useEffect(() => writeSettings(settings), [settings]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.setupTone = "server";
  }, [dark]);
  useLayoutEffect(() => {
    rate = speed;
  }, [speed]);
  useEffect(() => {
    // The event changes the language here without storing it: the dev app shares this origin. It is
    // sent once the provider above, whose effects run after these, is listening.
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("outcomego-locale-change", { detail: lang })));
  }, [lang]);
  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Looping waits out the poster's own time, as the carousel would, then plays the story again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new run, poster or speed starts the wait over.
  useEffect(() => {
    if (!loop || held !== null || view === "carousel") return;
    const timer = window.setTimeout(() => setRun((current) => current + 1), POSTER_MS);
    return () => window.clearTimeout(timer);
  }, [loop, held, view, run, poster, speed]);

  const hold = useCallback((beat: number) => change({ held: Math.max(0, Math.min(beat, story.last)) }), [change, story.last]);
  const toggleHold = useCallback(() => change({ held: held === null ? story.beat : null }), [change, held, story.beat]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const single = view === "single";
      const actions: Record<string, (() => void) | undefined> = {
        ArrowLeft: single ? () => showPoster(stepPoster(poster, -1)) : undefined,
        ArrowRight: single ? () => showPoster(stepPoster(poster, 1)) : undefined,
        "[": single ? () => hold((held ?? story.beat) - 1) : undefined,
        "]": single ? () => hold((held ?? story.beat) + 1) : undefined,
        " ": single ? toggleHold : undefined,
        r: replay,
        l: () => change({ loop: !loop }),
        g: () => change({ view: view === "grid" ? "single" : "grid", held: null }),
        t: () => change({ dark: !dark }),
        h: () => change({ panel: !panel }),
      };
      const digit = Number(event.key);
      const action =
        digit >= 1 && digit <= POSTERS.length
          ? () => {
              change({ view: "single" });
              showPoster(digit - 1);
            }
          : actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [change, dark, held, hold, loop, panel, poster, replay, showPoster, story.beat, toggleHold, view]);

  const preset = SIZES.find((item) => item.id === size)!;
  const filling = preset.width === 0;
  const width = filling ? Math.max(1, area.width) : preset.width;
  const height = filling ? Math.max(1, area.height) : preset.height;
  const fit = Math.min(1, area.width / width, area.height / height);
  // The overview shows all nine, three by three, at the chosen size (the default one when filling).
  const cell = filling ? SIZES[0] : preset;
  const rows = Math.ceil(POSTERS.length / 3);
  const cellScale = Math.max(
    0.2,
    Math.min((area.width - 2 * 16) / 3 / cell.width, (area.height - rows * 26 - (rows - 1) * 12) / rows / cell.height)
  );
  const current = POSTERS[poster]!;

  return (
    <div className="qa" data-panel={panel || undefined}>
      {panel ? (
        // Buttons give focus back, so Space and the arrows keep meaning the shortcuts.
        <aside className="qa-panel" onClick={() => (document.activeElement as HTMLElement | null)?.blur()}>
          <h1>部署海报调试</h1>
          <Choices label="视图" onPick={(id) => change({ view: id, held: null })} options={VIEWS} value={view} />
          <fieldset>
            <legend>海报</legend>
            <ol className="qa-posters">
              {POSTERS.map((item, index) => (
                <li key={item.id}>
                  <button
                    aria-pressed={view === "single" && index === poster}
                    onClick={() => {
                      change({ view: "single" });
                      showPoster(index);
                    }}
                    type="button"
                  >
                    <b>{index + 1}</b>
                    <span>{t(item.title)}</span>
                    <small>{item.id}</small>
                  </button>
                </li>
              ))}
            </ol>
          </fieldset>
          <fieldset disabled={view !== "single"}>
            <legend>节拍{view === "single" ? `：第 ${story.beat} 拍，共 ${story.last} 拍` : ""}</legend>
            <div className="qa-choices" data-tight="">
              {Array.from({ length: story.last + 1 }, (_, beat) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: A beat is its number.
                <button aria-pressed={beat === story.beat} data-held={held === beat || undefined} key={beat} onClick={() => hold(beat)} type="button">
                  {beat}
                </button>
              ))}
            </div>
            <div className="qa-choices">
              <button onClick={toggleHold} type="button">
                {held === null ? "停在这一拍" : "从这一拍继续"}
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>播放</legend>
            <div className="qa-choices">
              <button onClick={replay} type="button">
                重播
              </button>
              <button aria-pressed={loop} disabled={view === "carousel"} onClick={() => change({ loop: !loop })} type="button">
                循环
              </button>
              <button aria-pressed={motion} disabled={view === "carousel"} onClick={() => change({ motion: !motion })} type="button">
                环绕与漂浮
              </button>
            </div>
          </fieldset>
          <Choices
            label="速度"
            onPick={(id) => change({ speed: id })}
            options={SPEEDS.map((id) => ({ id, label: `${id}×` }))}
            value={speed as (typeof SPEEDS)[number]}
          />
          <Choices
            label="主题"
            onPick={(id) => change({ dark: id === "dark" })}
            options={[
              { id: "light", label: "浅色" },
              { id: "dark", label: "深色" },
            ]}
            value={dark ? "dark" : "light"}
          />
          <Choices
            label="语言"
            onPick={(id) => change({ lang: id })}
            options={[
              { id: "zh-CN", label: "中文" },
              { id: "en-US", label: "English" },
            ]}
            value={lang}
          />
          <fieldset>
            <legend>窗口尺寸{view === "grid" ? "" : `（显示 ${Math.round(fit * 100)}%）`}</legend>
            <select onChange={(event) => change({ size: event.target.value })} value={size}>
              {SIZES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </fieldset>
          <p className="qa-keys">
            <kbd>1</kbd>–<kbd>9</kbd> 选页　<kbd>←</kbd> <kbd>→</kbd> 换页　<kbd>空格</kbd> 停住/继续　<kbd>[</kbd> <kbd>]</kbd> 前后一拍
            <br />
            <kbd>R</kbd> 重播　<kbd>L</kbd> 循环　<kbd>G</kbd> 总览　<kbd>T</kbd> 深浅色　<kbd>H</kbd> 隐藏面板
          </p>
          <p className="qa-keys">
            <a href={`./local-deploy.html?platform=win32&freeze=pull${dark ? "&theme=dark" : ""}`}>在部署页里看 →</a>
          </p>
        </aside>
      ) : null}
      <div className="qa-area" data-view={view} ref={areaRef}>
        {area.width === 0 ? null : view === "grid" ? (
          POSTERS.map((item, index) => (
            <figure key={item.id}>
              <Stage height={cell.height} scale={cellScale} width={cell.width}>
                <Poster held={null} index={index} key={run} motion={motion} onPause={() => undefined} onShow={() => undefined} />
              </Stage>
              <button
                aria-label={t(item.title)}
                onClick={() => {
                  change({ view: "single" });
                  showPoster(index);
                }}
                type="button"
              />
              <figcaption>
                {index + 1} · {item.id}
              </figcaption>
            </figure>
          ))
        ) : (
          <Stage height={height} scale={fit} width={width}>
            {view === "carousel" ? (
              <DeployShowcase key={run} />
            ) : (
              <Poster
                held={held}
                index={poster}
                key={`${current.id}:${run}`}
                motion={motion}
                onBeat={onBeat}
                onPause={toggleHold}
                onShow={showPoster}
              />
            )}
          </Stage>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <Debugger />
  </I18nProvider>
);
