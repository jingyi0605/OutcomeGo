import type { RobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import {
  BatteryFull,
  Bot,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Image,
  Laptop,
  Lock,
  Mail,
  MousePointer2,
  Plus,
  SquareTerminal,
  Table2,
  Wifi,
} from "lucide-react";
import { type ComponentType, type CSSProperties, createContext, type ReactNode, useContext, useEffect, useState } from "react";
import amapIcon from "../../assets/apps/amap.webp?url";
import dingtalkIcon from "../../assets/apps/dingtalk.webp?url";
import emailIcon from "../../assets/apps/email.svg?url";
import feishuIcon from "../../assets/apps/feishu.webp?url";
import notionIcon from "../../assets/apps/notion-app.webp?url";
import synologyIcon from "../../assets/apps/synology.webp?url";
import wechatIcon from "../../assets/apps/wechat.webp?url";
import chatgptIcon from "../../assets/model-providers/chatgpt.webp?url";
import claudeIcon from "../../assets/model-providers/claude.webp?url";
import deepseekIcon from "../../assets/provider-icons/deepseek-color.svg?url";
import ollamaIcon from "../../assets/provider-icons/ollama.svg?url";
import qwenIcon from "../../assets/provider-icons/qwen-color.svg?url";
import dockMascot from "../../botdock/dock-mascot-2x.webp?url";
import { useI18n } from "../../lib/i18n";
import type { PosterId } from "../../lib/local-deploy-showcase";
import { BotAvatarGlyph } from "./avatar-picker-icons";
import { Humanoid } from "./local-deploy-humanoids";

// The pictures on the posters (local-deploy-showcase.tsx): one glass object each, drawn on a
// 720 × 440 canvas that the stylesheet scales to the stage. All of them share one light and one
// family of colours (local-deploy-showcase.css). A picture tells its story in beats: a beat turns
// elements on ([data-on]) and they arrive with CSS transitions, so a story can stop anywhere
// without hiding anything. Endless motion (orbits, floats) is CSS animation and stops with the
// poster.

export interface Playback {
  playing: boolean;
  /** Holds the story at this beat; it carries on from there when let go. Only the debug page
   *  (test/browser/deploy-showcase.tsx) sets this and listens. */
  held?: number;
  onBeat?(beat: number, last: number): void;
}
export const ScenePlayback = createContext<Playback>({ playing: true });

/** The story's beat, counting up to `last`. A poster that isn't playing shows it finished. */
function useBeat(last: number, every = 800, first = 700): number {
  const { playing, held, onBeat } = useContext(ScenePlayback);
  const [beat, setBeat] = useState(() => Math.min(held ?? (playing ? 0 : last), last));
  useEffect(() => onBeat?.(beat, last), [beat, last, onBeat]);
  useEffect(() => {
    if (held !== undefined) {
      setBeat(Math.min(held, last));
      return;
    }
    if (!playing || beat >= last) return;
    const timer = window.setTimeout(() => setBeat(beat + 1), beat === 0 ? first : every);
    return () => window.clearTimeout(timer);
  }, [beat, last, every, first, playing, held]);
  return beat;
}

const on = (value: boolean) => (value ? "" : undefined);
/** Numbers for the stylesheet. */
const vars = (values: Record<string, string | number>) => values as CSSProperties;

/** A pearl robot: every bot in the same material as the glass around it. */
function Robot({ shape, size }: { shape: RobotAvatarShape; size: number }) {
  const { playing } = useContext(ScenePlayback);
  return (
    <span className="vg-robot">
      <BotAvatarGlyph
        color="var(--pearl)"
        eyeColor="var(--visor)"
        height={size}
        mode={playing ? "idle" : "still"}
        shape={shape}
        width={size}
      />
    </span>
  );
}

/** A glass sphere: the OutcomeGo planet when it has a face. */
function Sphere({ size, face = false, down = false }: { size: number; face?: boolean; down?: boolean }) {
  return (
    <span className="vg-sphere" data-down={on(down)} style={vars({ "--s": `${size}px` })}>
      <i />
      {face ? (
        <>
          <b />
          <b />
        </>
      ) : null}
    </span>
  );
}

/** A check that draws itself. */
function Tick({ shown }: { shown: boolean }) {
  return (
    <svg aria-hidden="true" className="vg-tick" data-on={on(shown)} viewBox="0 0 24 24">
      <path d="M6.5 12.5l3.8 3.8 7.4-8.2" pathLength={1} />
    </svg>
  );
}

// What it knows about you, around the planet. Each is held by the end its line starts from, so its
// words can be any length.
const MEMORIES = [
  { label: "Conclusions first", hold: { right: 472 }, y: 6, line: "M248 26 C 276 26, 292 62, 306 100" },
  { label: "Short email replies", hold: { right: 534 }, y: 72, line: "M186 92 C 226 92, 250 112, 276 136" },
  { label: "Figures need sources", hold: { right: 552 }, y: 138, line: "M168 158 C 208 158, 232 166, 262 176" },
  { label: "No morning meetings", hold: { right: 552 }, y: 204, line: "M168 224 C 212 224, 238 218, 268 214" },
  { label: "On project A", hold: { right: 512 }, y: 270, line: "M208 290 C 250 290, 274 278, 298 264" },
  { label: "Friday reviews", hold: { left: 472 }, y: 6, line: "M472 26 C 444 26, 428 62, 414 100" },
  { label: "Window seat on trips", hold: { left: 534 }, y: 72, line: "M534 92 C 494 92, 470 112, 444 136" },
  { label: "Pre-meeting nudges", hold: { left: 552 }, y: 138, line: "M552 158 C 512 158, 488 166, 458 176" },
  { label: "Call key clients first", hold: { left: 552 }, y: 204, line: "M552 224 C 508 224, 482 218, 452 214" },
  { label: "No spicy food", hold: { left: 512 }, y: 270, line: "M512 290 C 470 290, 446 278, 422 264" },
] as const;
// Work done the way you like it, and the memories (by index) it was done with.
const SITUATIONS = [
  { label: "Weekly report done, conclusions on top", uses: [0, 2] },
  { label: "Meeting set for 3 PM, reminder on", uses: [3, 7] },
  { label: "Trip planned: window seat, mild dinner", uses: [6, 9] },
] as const;

/** What it knows about you, flowing into the planet; then one situation after another handled with it. */
function AssistantScene() {
  const { t } = useI18n();
  const beat = useBeat(1 + SITUATIONS.length, 1450, 600);
  const current = beat - 2;
  const uses = (index: number) => Boolean(SITUATIONS[current]?.uses.some((used) => used === index));
  return (
    <div className="vs-assistant">
      <svg className="vg-fill vg-lines" viewBox="0 0 720 440">
        <path className="vs-halo-back" d="M214 190 A 146 37 0 0 1 506 190" transform="rotate(-13 360 190)" />
        {MEMORIES.map(({ label, line }, index) => (
          <path
            className="vs-thread"
            d={line}
            data-lit={on(uses(index))}
            data-on={on(beat >= 1)}
            key={label}
            pathLength={1}
            style={vars({ "--i": index % 5 })}
          />
        ))}
      </svg>
      <span className="vs-warmth" data-on={on(beat >= 2)} />
      <Sphere down={beat >= 2} face size={200} />
      <svg className="vg-fill vs-halo" viewBox="0 0 720 440">
        <defs>
          <linearGradient id="halo" x1="0" x2="1">
            <stop offset="0" stopColor="var(--lilac)" />
            <stop offset="0.5" stopColor="#ffffff" />
            <stop offset="1" stopColor="var(--ice)" />
          </linearGradient>
        </defs>
        <path d="M214 190 A 146 37 0 0 0 506 190" stroke="url(#halo)" transform="rotate(-13 360 190)" />
      </svg>
      {MEMORIES.map(({ label, hold, y }, index) => (
        <span
          className="vg vg-capsule vs-memory"
          data-lit={on(uses(index))}
          data-on={on(beat >= 1)}
          key={label}
          style={{ ...hold, top: y, ...vars({ "--i": index % 5, "--n": index }) }}
        >
          {t(label)}
        </span>
      ))}
      {SITUATIONS.map(({ label }, index) => (
        <span className="vg vg-capsule vs-reply" data-on={on(current === index)} key={label}>
          <Tick shown={current === index} />
          {t(label)}
        </span>
      ))}
    </div>
  );
}

const CREW = [
  { role: "Researcher", label: "Sources gathered", who: "researcher", x: 144 },
  { role: "Writer", label: "Draft written", who: "writer", x: 360 },
  { role: "Reviewer", label: "Facts checked", who: "reviewer", x: 576 },
] as const;

/** One file passed along by three humanoid robots, who wake as it reaches them, and further along with each. */
function TeamScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 820, 800);
  // Each of them works on the file for a beat, then it travels on.
  const holder = beat >= 5 ? 2 : beat >= 3 ? 1 : beat >= 1 ? 0 : -1;
  const finished = Math.floor(beat / 2);
  const written = beat >= 6 ? 4 : beat >= 4 ? 3 : beat >= 2 ? 1 : 0;
  return (
    <div className="vs-team">
      <svg className="vg-fill vg-lines" viewBox="0 0 720 440">
        <path d="M144 70 Q 252 -36 360 70 Q 468 -36 576 70" />
      </svg>
      <span
        className="vg vs-doc"
        data-done={on(beat >= 6)}
        data-on={on(beat >= 1)}
        style={{ offsetDistance: `${Math.max(holder, 0) * 50}%` }}
      >
        {[0.9, 0.7, 0.82].map((width, index) => (
          <i data-on={on(written > index)} key={width} style={vars({ "--w": width })} />
        ))}
        <b>
          <Tick shown={beat >= 6} />
        </b>
      </span>
      {CREW.map(({ role, label, who, x }, index) => (
        <div
          className="vs-member"
          data-busy={on(holder === index && finished <= index)}
          data-on={on(holder >= index)}
          key={role}
          style={{ left: x }}
        >
          <span className="vg vs-portrait" />
          <span className="vs-bust">
            <Humanoid delay={index * -1.7} who={who} />
          </span>
          <span className="vs-isbot">
            <Bot className="size-5.5" strokeWidth={2} />
          </span>
          <strong>{t(role)}</strong>
          <small data-on={on(finished > index)}>
            <Tick shown={finished > index} />
            {t(label)}
          </small>
        </div>
      ))}
    </div>
  );
}

const PRICES = [
  { name: "Northstar", price: 144, rating: "4.8" },
  { name: "Acme", price: 216, rating: "4.2" },
  { name: "Orbit", price: 200, rating: "4.5" },
  { name: "Vega", price: 168, rating: "4.6" },
] as const;
// What opens on the desktop, at which beat, from which icon in its dock.
const DOCK = [
  { icon: Globe, at: 1 },
  { icon: Folder, at: 3 },
  { icon: Table2, at: 5 },
  { icon: SquareTerminal, at: 99 },
  { icon: Mail, at: 99 },
] as const;
// Where the pointer is at each beat, on the 628 × 346 screen.
const POINTER = [
  [430, 150],
  [248, 312],
  [112, 56],
  [282, 312],
  [560, 118],
  [316, 312],
  [420, 214],
  [352, 244],
  [428, 268],
] as const;

function WindowBar({ children }: { children: ReactNode }) {
  return (
    <header>
      <i />
      <i />
      <i />
      {children}
    </header>
  );
}

/** A computer with a big display: a browser, the files and a spreadsheet at work on it, and your hand for a moment. */
function ComputerScene() {
  const { t } = useI18n();
  const beat = useBeat(8, 660, 650);
  const yours = beat === 7;
  const [x, y] = POINTER[beat] ?? POINTER[0];
  return (
    <div className="vs-computer">
      <span className="vs-stand" />
      <div className="vs-monitor">
        <div className="vs-desktop">
          <div className="vs-menubar">
            <b />
            <i />
            <i />
            <i />
            <Wifi className="size-3" strokeWidth={2.4} />
            <BatteryFull className="size-3.5" strokeWidth={2.2} />
            <em>9:41</em>
          </div>
          <section className="vs-win" data-kind="browser" data-on={on(beat >= 1)}>
            <WindowBar>
              <span data-on={on(beat >= 2)}>
                <Lock className="size-2.5" strokeWidth={2.8} />
                <b>northstar.example/pricing</b>
              </span>
            </WindowBar>
            <div className="vs-site" data-on={on(beat >= 2)}>
              <div>
                <p>
                  <b />
                  <i />
                  <i />
                  <u />
                </p>
                <Photo />
              </div>
              <ul>
                {PRICES.slice(0, 3).map(({ name, price }, index) => (
                  <li key={name} style={vars({ "--i": index })}>
                    <small>{name}</small>
                    <strong>${price}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section className="vs-win" data-kind="files" data-on={on(beat >= 3)}>
            <WindowBar>
              <strong>{t("Competitor files")}</strong>
            </WindowBar>
            <ul>
              <li>
                <FileText className="size-6" strokeWidth={1.6} />
                {t("Report.docx")}
              </li>
              <li>
                <FileText className="size-6" strokeWidth={1.6} />
                {t("Quotes.pdf")}
              </li>
              <li>
                <Image className="size-6" strokeWidth={1.6} />
                {t("Shots.png")}
              </li>
              <li data-new="" data-on={on(beat >= 4)}>
                <FileSpreadsheet className="size-6" strokeWidth={1.6} />
                {t("Table.xlsx")}
              </li>
            </ul>
          </section>
          <section className="vs-win" data-kind="sheet" data-on={on(beat >= 5)}>
            <WindowBar>
              <strong>{t("Table.xlsx")}</strong>
            </WindowBar>
            <div className="vs-sheet" data-on={on(beat >= 6)}>
              <table>
                <tbody>
                  <tr>
                    <th />
                    <th>{t("Product")}</th>
                    <th>{t("Price")}</th>
                    <th>{t("Rating")}</th>
                  </tr>
                  {PRICES.map(({ name, price, rating }, row) => (
                    <tr key={name}>
                      <th>{row + 1}</th>
                      {[name, `$${price}`, rating].map((value, column) => (
                        <td key={value} style={vars({ "--n": row * 3 + column })}>
                          <span>{value}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                {PRICES.map(({ name, price }, index) => (
                  <i key={name} style={vars({ "--h": price / 216, "--i": index })} />
                ))}
              </div>
            </div>
          </section>
          <div className="vs-apps">
            {DOCK.map(({ icon: Icon, at }) => (
              <span data-hit={on(beat === at)} data-open={on(beat >= at)} key={Icon.displayName ?? at}>
                <Icon className="size-4" strokeWidth={2} />
              </span>
            ))}
          </div>
          <span className="vs-pointer" data-yours={on(yours)} style={{ transform: `translate(${x}px, ${y}px)` }}>
            <MousePointer2 className="size-5.5" strokeWidth={1.5} />
            <em>{t("You")}</em>
          </span>
        </div>
      </div>
      <span className="vg vg-capsule vs-takeover" data-on={on(beat >= 7)} data-yours={on(yours)}>
        <i />
        {t("Take over")}
      </span>
      <Robot shape="tv-head" size={92} />
    </div>
  );
}

// Nine pieces of work on one quiet arc; the fifth is the one that needs you.
const WORK = Array.from({ length: 9 }, (_, index) => ({
  x: 120 + index * 60,
  y: 30 + ((index - 4) / 4) ** 2 * 34,
}));
const ASKING = 4;

/** Work finishing quietly, and the one thing that comes to you. */
function DecideScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 780, 700);
  const asking = beat >= 2;
  const open = beat >= 3;
  const answered = beat >= 6;
  return (
    <div className="vs-decide">
      {WORK.map(({ x, y }, index) => (
        <i
          className="vs-task"
          data-asking={on(index === ASKING && asking && !open)}
          data-done={on(index === ASKING ? answered : beat >= 1 + (index % 3))}
          data-gone={on(index === ASKING && open && !answered)}
          key={x}
          style={{ left: x, top: y }}
        >
          <Tick shown={index === ASKING ? answered : beat >= 1 + (index % 3)} />
        </i>
      ))}
      <div className="vg vs-card" data-answered={on(answered)} data-on={on(open)}>
        <Robot shape="helmet" size={58} />
        <strong>{t("Which quote to send?")}</strong>
        <div>
          <span data-best="" data-gazed={on(beat >= 4)} data-press={on(beat === 5)}>
            {t("Standard quote")}
            <em>{t("Recommended")}</em>
            <Tick shown={answered} />
          </span>
          <span>{t("Discounted quote")}</span>
        </div>
      </div>
      <span className="vs-touch" data-on={on(beat === 4 || beat === 5)} data-press={on(beat === 5)} />
    </div>
  );
}

// How each to-do lies about before it becomes part of the result.
const CRITERIA = [
  { label: "Figures have sources", dx: -84, dy: -46, tilt: -9 },
  { label: "Conclusions backed up", dx: 96, dy: -6, tilt: 7 },
  { label: "Comparison attached", dx: -58, dy: 52, tilt: 5 },
] as const;

/** Loose to-dos that draw together into one result, checked line by line, then sealed. */
function OutcomeScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 720, 1800);
  return (
    <div className="vs-outcome">
      <div className="vs-float">
        <div className="vg vs-report" data-on={on(beat >= 1)}>
          <strong>{t("Competitor analysis")}</strong>
        </div>
        {CRITERIA.map(({ label, dx, dy, tilt }, index) => (
          <p
            className="vs-criterion"
            data-met={on(beat >= 2 + index)}
            data-on={on(beat >= 1)}
            key={label}
            style={vars({ "--i": index, "--dx": `${dx}px`, "--dy": `${dy}px`, "--tilt": `${tilt}deg` })}
          >
            <span>
              <Tick shown={beat >= 2 + index} />
            </span>
            {t(label)}
          </p>
        ))}
        <div className="vs-seal" data-on={on(beat >= 5)}>
          <Sphere size={112} />
          <Tick shown={beat >= 6} />
        </div>
      </div>
    </div>
  );
}

/** A picture, in the posters' own colours. */
function Photo() {
  return (
    <svg aria-hidden="true" className="vs-photo" preserveAspectRatio="xMidYMid slice" viewBox="0 0 150 100">
      <circle cx="110" cy="30" fill="#ffffff" opacity="0.95" r="12" />
      <path d="M0 82 L40 42 L72 76 L100 54 L150 94 V100 H0 Z" fill="#ffffff" opacity="0.5" />
      <path d="M0 100 V88 L44 68 L86 94 L118 78 L150 94 V100 Z" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}

/** A file by its name. */
function Paper() {
  const { t } = useI18n();
  return (
    <span className="vs-paper">
      <FileText className="size-5" strokeWidth={1.9} />
      {t("Quotes.pdf")}
    </span>
  );
}

/**
 * The bot floating window as it works (src/renderer/botdock): it grows and glows while something is
 * dragged from another app, takes the drop, and opens a message with it attached. A second drop goes
 * into the open message.
 */
function DockScene() {
  const { t } = useI18n();
  const beat = useBeat(7, 760, 700);
  const sent = beat >= 7;
  return (
    <div className="vs-docking">
      <div className="vg vs-source" data-held={on(beat === 3)} data-kind="file">
        <header>
          <img alt="" draggable={false} src={emailIcon} />
          <i />
        </header>
        <Paper />
      </div>
      <div className="vg vs-source" data-held={on(beat === 1)} data-kind="image">
        <header>
          <img alt="" draggable={false} src={wechatIcon} />
          <i />
        </header>
        <Photo />
      </div>
      <div className="vg vs-composer" data-on={on(beat >= 3)} data-target={on(beat === 3 || beat === 4)}>
        <p data-on={on(beat >= 6)}>
          <span>{t("Sum up the key points")}</span>
        </p>
        <div>
          <b data-kind="image" data-on={on(beat >= 3)}>
            <Photo />
          </b>
          <b data-kind="file" data-on={on(beat >= 5)}>
            <Paper />
          </b>
        </div>
        <footer>
          <span>
            <Robot shape="goggles" size={24} />
            {t("Researcher")}
          </span>
          <u data-ready={on(beat >= 6)} data-sent={on(sent)}>
            {t("Send")}
            <Tick shown={sent} />
          </u>
        </footer>
      </div>
      <span className="vs-dock" data-inviting={on(beat === 1 || beat === 2)}>
        <i />
        <img alt="" draggable={false} src={dockMascot} />
      </span>
      <span className="vs-drag" data-go={on(beat >= 2)} data-kind="image" data-lift={on(beat >= 1)}>
        <Photo />
      </span>
      <span className="vs-drag" data-go={on(beat >= 4)} data-kind="file" data-lift={on(beat >= 3)}>
        <Paper />
      </span>
    </div>
  );
}

const RUNS = [
  { time: "23:00", label: "Sort the inbox" },
  { time: "02:30", label: "Track competitors" },
  { time: "06:00", label: "Gather the numbers" },
  { time: "08:00", label: "Morning briefing" },
] as const;

/** A night on a dial, with the routines it passes. */
function RoutineScene() {
  const { t } = useI18n();
  const beat = useBeat(4, 1250, 900);
  const run = Math.min(Math.max(beat - 1, 0), RUNS.length - 1);
  const progress = run / (RUNS.length - 1);
  return (
    <div className="vs-routines" style={vars({ "--progress": progress })}>
      <span className="vg vs-face" />
      <svg className="vg-fill vs-dial" viewBox="0 0 720 440">
        <defs>
          <linearGradient id="dial" x1="0" x2="1" y1="1" y2="0.6">
            <stop offset="0" stopColor="var(--lilac)" />
            <stop offset="0.6" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--ice)" />
          </linearGradient>
        </defs>
        <circle cx="360" cy="216" pathLength={360} r="176" />
        <circle cx="360" cy="216" data-fill="" pathLength={360} r="176" stroke="url(#dial)" />
      </svg>
      {RUNS.map((item, index) => (
        <i
          className="vs-mark"
          data-on={on(beat > index)}
          key={item.time}
          style={vars({ "--at": index / (RUNS.length - 1) })}
        />
      ))}
      <span className="vs-moon">
        <i />
      </span>
      <div className="vs-time">
        {RUNS.map((item, index) => (
          <p data-on={on(index === run)} key={item.time}>
            <strong>{item.time}</strong>
            <small>{t(item.label)}</small>
          </p>
        ))}
      </div>
    </div>
  );
}

// The apps' own icons: from their App Store listings (downloaded 2026-11-25) as 128 px WebP, with
// Synology Drive standing for a NAS; email is OutcomeGo's own Email plugin icon. They only identify
// what can be integrated, and belong to their owners.
const APPS = [
  { name: "WeChat", src: wechatIcon },
  { name: "Feishu", src: feishuIcon },
  { name: "DingTalk", src: dingtalkIcon },
  { name: "Amap", src: amapIcon },
  { name: "Notion", src: notionIcon },
  { name: "Email", src: emailIcon },
  { name: "Synology", src: synologyIcon },
  { name: "More", src: null },
] as const;

/** The apps people work in, circling the planet. */
function ConnectScene() {
  const beat = useBeat(APPS.length, 240, 500);
  return (
    <div className="vs-connect">
      <svg className="vg-fill vg-lines" viewBox="0 0 720 440">
        <circle cx="360" cy="214" r="172" />
      </svg>
      <div className="vs-ring">
        {APPS.map(({ name, src }, index) => (
          <span
            data-on={on(beat > index)}
            key={name}
            style={vars({ "--a": `${(360 / APPS.length) * index - 90}deg`, "--i": index })}
          >
            <u />
            {src ? (
              <b className="vs-app">
                <img alt="" draggable={false} src={src} />
              </b>
            ) : (
              <b className="vg vs-app">
                <Plus className="size-7" strokeWidth={1.8} />
              </b>
            )}
          </span>
        ))}
      </div>
      <Sphere face size={136} />
    </div>
  );
}

const PLATES = ["var(--ice)", "var(--accent)", "var(--lilac)"] as const;
// A mark is a bare logo, which needs a tile of its own; the others are whole app icons.
const MODELS = [
  { name: "ChatGPT", src: chatgptIcon, angle: -64, mark: false },
  { name: "Claude", src: claudeIcon, angle: -32, mark: false },
  { name: "DeepSeek", src: deepseekIcon, angle: 0, mark: true },
  { name: "Qwen", src: qwenIcon, angle: 32, mark: true },
  { name: "Ollama", src: ollamaIcon, angle: 64, mark: true },
] as const;

/** Everything you keep, inside one sphere; the models, outside it, yours to pick. */
function YoursScene() {
  const { t } = useI18n();
  const beat = useBeat(8, 620);
  const pick = beat >= 4 ? (beat - 4) % MODELS.length : -1;
  return (
    <div className="vs-yours">
      <span className="vs-dome">
        <Sphere size={256} />
      </span>
      <div className="vs-plates">
        {PLATES.map((tone, index) => (
          <i data-on={on(beat > index)} key={tone} style={vars({ "--tone": tone, "--z": index })} />
        ))}
      </div>
      <span className="vg vg-capsule vs-home" data-on={on(beat >= 3)}>
        <Laptop className="size-4" strokeWidth={2} />
        {t("This computer")}
        <Lock className="size-3" strokeWidth={2.6} />
      </span>
      {MODELS.map(({ name, src, angle, mark }, index) => (
        <span
          className="vs-model"
          data-on={on(beat >= 3)}
          data-picked={on(pick === index)}
          key={name}
          style={vars({ "--angle": `${angle}deg` })}
        >
          <u />
          <b className="vs-app" data-mark={on(mark)}>
            <img alt="" draggable={false} src={src} />
          </b>
        </span>
      ))}
    </div>
  );
}

export const SCENES: Record<PosterId, ComponentType> = {
  assistant: AssistantScene,
  team: TeamScene,
  computer: ComputerScene,
  decide: DecideScene,
  outcome: OutcomeScene,
  dock: DockScene,
  routines: RoutineScene,
  connect: ConnectScene,
  yours: YoursScene,
};
