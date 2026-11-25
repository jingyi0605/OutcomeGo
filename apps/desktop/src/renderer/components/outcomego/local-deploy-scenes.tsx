import type { RobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import { Check, Laptop, Lock, Plug } from "lucide-react";
import { type ComponentType, type CSSProperties, createContext, useContext, useEffect, useState } from "react";
import dingtalkLogo from "../../assets/apps/dingtalk.png?url";
import githubLogo from "../../assets/apps/github.svg?url";
import gmailLogo from "../../assets/apps/gmail.svg?url";
import linearLogo from "../../assets/apps/linear.svg?url";
import notionLogo from "../../assets/apps/notion.svg?url";
import slackLogo from "../../assets/apps/slack.svg?url";
import wechatLogo from "../../assets/apps/wechat.svg?url";
import { useI18n } from "../../lib/i18n";
import type { PosterId } from "../../lib/local-deploy-showcase";
import { BotAvatarGlyph } from "./avatar-picker-icons";

// The pictures on the posters (local-deploy-showcase.tsx): one glass object each, drawn on a
// 720 × 440 canvas that the stylesheet scales to the stage. All of them share one light and one
// family of colours (local-deploy-showcase.css). A picture tells its story in beats: a beat turns
// elements on ([data-on]) and they arrive with CSS transitions, so a story can stop anywhere
// without hiding anything. Endless motion (orbits, floats) is CSS animation and stops with the
// poster.

export const ScenePlayback = createContext({ playing: true });

/** The story's beat, counting up to `last`. A poster that isn't playing shows it finished. */
function useBeat(last: number, every = 800, first = 700): number {
  const { playing } = useContext(ScenePlayback);
  const [beat, setBeat] = useState(() => (playing ? 0 : last));
  useEffect(() => {
    if (!playing || beat >= last) return;
    const timer = window.setTimeout(() => setBeat(beat + 1), beat === 0 ? first : every);
    return () => window.clearTimeout(timer);
  }, [beat, last, every, first, playing]);
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

const BEADS = Array.from({ length: 9 }, (_, index) => index);

/** Many things circling quietly, and the one that steps forward. */
function FocusScene() {
  const { t } = useI18n();
  const beat = useBeat(3, 1150, 1300);
  return (
    <div className="vs-focus" data-calling={on(beat >= 1)}>
      <svg className="vg-fill vg-lines" viewBox="0 0 720 440">
        <ellipse cx="360" cy="196" rx="304" ry="92" transform="rotate(-8 360 196)" />
        <path className="vs-halo-back" d="M204 196 A 156 40 0 0 1 516 196" transform="rotate(-13 360 196)" />
      </svg>
      {BEADS.map((bead) => (
        <i className="vs-bead" key={bead} style={vars({ "--p": bead / BEADS.length })} />
      ))}
      <Sphere down={beat >= 2} face size={212} />
      <svg className="vg-fill vs-halo" viewBox="0 0 720 440">
        <defs>
          <linearGradient id="halo" x1="0" x2="1">
            <stop offset="0" stopColor="var(--lilac)" />
            <stop offset="0.5" stopColor="#ffffff" />
            <stop offset="1" stopColor="var(--ice)" />
          </linearGradient>
        </defs>
        <path d="M204 196 A 156 40 0 0 0 516 196" stroke="url(#halo)" transform="rotate(-13 360 196)" />
      </svg>
      <span className="vg vg-capsule vs-call" data-on={on(beat >= 2)}>
        <i />
        {t("Needs your call")}
      </span>
    </div>
  );
}

const ROWS = [0.82, 0.6, 0.72] as const;

/** A contract of three lines, met one by one, then sealed. */
function OutcomeScene() {
  const beat = useBeat(5, 780);
  return (
    <div className="vs-outcome">
      <div className="vs-float">
        <div className="vg vs-contract">
          <u />
          {ROWS.map((width, index) => (
            <p data-on={on(beat > index)} key={width}>
              <span>
                <Tick shown={beat > index} />
              </span>
              <i style={vars({ "--w": width })} />
            </p>
          ))}
        </div>
        <div className="vs-seal" data-on={on(beat >= 4)}>
          <Sphere size={116} />
          <Tick shown={beat >= 5} />
        </div>
      </div>
    </div>
  );
}

const LINES = [0.9, 0.64, 0.78, 0.5] as const;

/** A window of its own with a bot before it, and your hand joining for a moment. */
function ComputerScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 760);
  const yours = beat === 5;
  return (
    <div className="vs-computer">
      <div className="vs-float">
        <div className="vg vs-window">
          <header>
            <i data-on={on(beat >= 1)} />
          </header>
          {LINES.map((width, index) => (
            <p data-lit={on(beat === index + 1)} data-on={on(beat > index)} key={width}>
              <b />
              <i style={vars({ "--w": width })} />
            </p>
          ))}
          <span className="vs-gaze" data-yours={on(yours)} style={vars({ "--row": Math.min(Math.max(beat - 1, 0), 3) })} />
        </div>
        <span className="vs-grabber">
          <i />
          <i />
        </span>
        <span className="vg vg-capsule vs-takeover" data-on={on(beat >= 5)}>
          <i />
          {t("Take over")}
        </span>
      </div>
      <Robot shape="tv-head" size={104} />
    </div>
  );
}

const CREW = [
  { role: "Researcher", shape: "goggles", x: 144 },
  { role: "Writer", shape: "chip", x: 360 },
  { role: "Reviewer", shape: "owl", x: 576 },
] as const;

/** One piece of work, passed along by three. */
function TeamScene() {
  const { t } = useI18n();
  const beat = useBeat(5, 900, 900);
  // Each bot holds the work for a beat, then it travels on.
  const holder = beat >= 5 ? 2 : beat >= 3 ? 1 : beat >= 1 ? 0 : -1;
  return (
    <div className="vs-team">
      <svg className="vg-fill vg-lines" viewBox="0 0 720 440">
        <path d="M144 176 Q 252 40 360 176 Q 468 40 576 176" />
      </svg>
      <span className="vs-work" data-on={on(beat >= 1)} style={{ offsetDistance: `${Math.max(holder, 0) * 50}%` }} />
      {CREW.map(({ role, shape, x }, index) => (
        <div className="vs-member" data-on={on(holder >= index)} key={role} style={{ left: x }}>
          <Robot shape={shape} size={112} />
          <span className="vg vs-disc" />
          <small>{t(role)}</small>
        </div>
      ))}
    </div>
  );
}

const RUNS = [
  { time: "23:00", label: "Sort the inbox" },
  { time: "02:30", label: "Check packages" },
  { time: "06:00", label: "Watch prices" },
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

/** Stillness, one card, one answer. */
function DecideScene() {
  const { t } = useI18n();
  const beat = useBeat(5, 950, 1100);
  const answered = beat >= 4;
  return (
    <div className="vs-decide">
      <span className="vs-ripples">
        <i />
        <i />
        <i />
      </span>
      <div className="vg vs-card" data-answered={on(answered)} data-on={on(beat >= 1)}>
        <Robot shape="helmet" size={62} />
        <strong>{t("Which supplier to use?")}</strong>
        <div>
          <span data-best="" data-gazed={on(beat >= 2)} data-press={on(beat === 3)}>
            Northstar
            <Tick shown={answered} />
          </span>
          <span>Acme</span>
        </div>
      </div>
      <span className="vs-touch" data-on={on(beat === 2 || beat === 3)} data-press={on(beat === 3)} />
    </div>
  );
}

const TOOLS = [
  { name: "Gmail", src: gmailLogo },
  { name: "GitHub", src: githubLogo },
  { name: "Notion", src: notionLogo },
  { name: "DingTalk", src: dingtalkLogo },
  { name: "Slack", src: slackLogo },
  { name: "WeChat", src: wechatLogo },
  { name: "Linear", src: linearLogo },
  { name: "MCP", src: null },
] as const;

/** The tools people use, circling the app in one colour. */
function ConnectScene() {
  const beat = useBeat(TOOLS.length, 260, 500);
  return (
    <div className="vs-connect">
      <svg className="vg-fill vg-lines" viewBox="0 0 720 440">
        <circle cx="360" cy="214" r="178" />
      </svg>
      <div className="vs-ring">
        {TOOLS.map(({ name, src }, index) => (
          <span data-on={on(beat > index)} key={name} style={vars({ "--a": `${(360 / TOOLS.length) * index}deg`, "--i": index })}>
            <u />
            <b className="vg">
              {src ? <i style={{ maskImage: `url("${src}")` }} /> : <Plug className="size-6" strokeWidth={1.9} />}
            </b>
          </span>
        ))}
      </div>
      <Sphere face size={148} />
    </div>
  );
}

const PLATES = ["var(--ice)", "var(--accent)", "var(--lilac)"] as const;
const MODELS = [-60, -20, 20, 60] as const;

/** Everything you keep, inside one sphere; the models, outside it, yours to pick. */
function YoursScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 720);
  const pick = beat >= 4 ? (beat - 4) % MODELS.length : -1;
  return (
    <div className="vs-yours">
      <span className="vs-dome">
        <Sphere size={270} />
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
      {MODELS.map((angle, index) => (
        <span
          className="vs-model"
          data-on={on(beat >= 3)}
          data-picked={on(pick === index)}
          key={angle}
          style={vars({ "--angle": `${angle}deg` })}
        >
          <u />
          <b>
            <Sphere size={54} />
            <Check className="size-4" strokeWidth={2.6} />
          </b>
        </span>
      ))}
    </div>
  );
}

export const SCENES: Record<PosterId, ComponentType> = {
  focus: FocusScene,
  outcome: OutcomeScene,
  computer: ComputerScene,
  team: TeamScene,
  routines: RoutineScene,
  decide: DecideScene,
  connect: ConnectScene,
  yours: YoursScene,
};
