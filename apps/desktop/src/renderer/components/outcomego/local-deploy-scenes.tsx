import type { RobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import {
  BadgeCheck,
  Bell,
  Bot,
  Brain,
  CalendarDays,
  ChartColumn,
  Check,
  Clock,
  CodeXml,
  Cpu,
  Database,
  FileCheck,
  FileText,
  Folder,
  Globe,
  KeyRound,
  Laptop,
  Link2,
  Lock,
  Mail,
  Monitor,
  MousePointer2,
  PenLine,
  Plug,
  Search,
  Server,
  Sparkles,
  Target,
} from "lucide-react";
import { type ComponentType, type CSSProperties, createContext, useContext, useEffect, useState } from "react";
import dingtalkLogo from "../../assets/apps/dingtalk.png?url";
import githubLogo from "../../assets/apps/github.svg?url";
import gmailLogo from "../../assets/apps/gmail.svg?url";
import calendarLogo from "../../assets/apps/google-calendar.svg?url";
import driveLogo from "../../assets/apps/google-drive.svg?url";
import linearLogo from "../../assets/apps/linear.svg?url";
import notionLogo from "../../assets/apps/notion.svg?url";
import slackLogo from "../../assets/apps/slack.svg?url";
import wechatLogo from "../../assets/apps/wechat.svg?url";
import outcomegoIcon from "../../assets/outcomego-icon.png?url";
import { useI18n } from "../../lib/i18n";
import type { PosterId } from "../../lib/local-deploy-showcase";
import { BotAvatarGlyph } from "./avatar-picker-icons";
import { AppIcon } from "./setup/app-icons";

// The pictures on the posters (local-deploy-showcase.tsx), drawn on a 720 × 440 canvas that the
// stylesheet scales to the stage. Each one tells a short story in beats: a beat turns elements on
// ([data-on]) and they arrive with CSS transitions, so a story can stop anywhere without hiding
// anything. Endless motion (orbits, floats, twinkles) is CSS animation and pauses with the poster.

export const ScenePlayback = createContext({ playing: true, still: false });

/** The story's beat, counting up to `last`. Without motion it is told at once. */
function useBeat(last: number, every = 950, first = 620): number {
  const { playing, still } = useContext(ScenePlayback);
  const [beat, setBeat] = useState(() => (playing && !still ? 0 : last));
  useEffect(() => {
    if (still) {
      setBeat(last);
      return;
    }
    if (!playing || beat >= last) return;
    const timer = window.setTimeout(() => setBeat(beat + 1), beat === 0 ? first : every);
    return () => window.clearTimeout(timer);
  }, [beat, last, every, first, playing, still]);
  return beat;
}

const on = (value: boolean) => (value ? "" : undefined);
/** Places an element on the canvas. */
const at = (x: number, y: number, extra?: Record<string, string | number>) =>
  ({ left: x, top: y, ...extra }) as CSSProperties;

function Robot({ shape, color, size }: { shape: RobotAvatarShape; color: string; size: number }) {
  const { playing } = useContext(ScenePlayback);
  return (
    <BotAvatarGlyph
      color={color}
      eyeColor="#111111"
      height={size}
      mode={playing ? "idle" : "still"}
      shape={shape}
      width={size}
    />
  );
}

/** The OutcomeGo planet, after the app icon: a dark glass sphere, a bright ring and two eyes. */
function Planet({ looking }: { looking: boolean }) {
  return (
    <svg className="sc-planet" data-looking={on(looking)} viewBox="0 0 260 220">
      <defs>
        <radialGradient cx="0.56" cy="0.5" id="planet-body" r="0.56">
          <stop offset="0" stopColor="#0a1040" />
          <stop offset="0.62" stopColor="#131d63" />
          <stop offset="0.86" stopColor="#4457d8" />
          <stop offset="1" stopColor="#a8b7ff" />
        </radialGradient>
        <radialGradient cx="0.18" cy="0.3" id="planet-sun" r="0.5">
          <stop offset="0" stopColor="#ffdcb8" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#c9b1ff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#8f9dff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="planet-ring" x1="0" x2="1" y1="0.6" y2="0.4">
          <stop offset="0" stopColor="#b79bff" />
          <stop offset="0.45" stopColor="#ffffff" />
          <stop offset="1" stopColor="#8fb4ff" />
        </linearGradient>
      </defs>
      <path className="sc-ring-back" d="M4 110 A 126 33 0 0 1 256 110" fill="none" transform="rotate(-13 130 110)" />
      <circle cx="130" cy="108" fill="url(#planet-body)" r="80" />
      <circle cx="130" cy="108" fill="url(#planet-sun)" r="80" />
      <circle className="sc-planet-rim" cx="130" cy="108" fill="none" r="79.4" />
      <path
        className="sc-ring-front"
        d="M4 110 A 126 33 0 0 0 256 110"
        fill="none"
        stroke="url(#planet-ring)"
        transform="rotate(-13 130 110)"
      />
      <g className="sc-eyes">
        <rect fill="#fff" height="27" rx="6.5" width="13" x="143" y="84" />
        <rect fill="#fff" height="27" rx="6.5" width="13" x="177" y="84" />
      </g>
    </svg>
  );
}

const ORBITERS = [
  { icon: Search, label: "Research", orbit: 0, p: 0.04, done: 3 },
  { icon: PenLine, label: "Writing", orbit: 1, p: 0.36, done: 2 },
  { icon: CodeXml, label: "Coding", orbit: 2, p: 0.6, done: 9 },
  { icon: Mail, label: "Email", orbit: 1, p: 0.86, done: 3 },
  { icon: ChartColumn, label: "Data", orbit: 2, p: 0.1, done: 4 },
  { icon: CalendarDays, label: "Scheduling", orbit: 2, p: 0.36, done: 9 },
  { icon: Globe, label: "Web", orbit: 0, p: 0.54, done: 1 },
] as const;

/** Many things in flight around the planet, and the one that needs you stepping forward. */
function FocusScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 900, 900);
  const calling = beat >= 5;
  return (
    <div className="sc-focus" data-calling={on(calling)}>
      <span className="sc-glow" />
      <svg className="sc-fill sc-orbits" viewBox="0 0 720 440">
        <g transform="rotate(-9 360 208)">
          <ellipse cx="360" cy="208" rx="205" ry="66" />
          <ellipse cx="360" cy="208" rx="272" ry="104" />
          <ellipse cx="360" cy="208" rx="330" ry="146" />
        </g>
      </svg>
      <Planet looking={calling} />
      {ORBITERS.map(({ icon: Icon, label, orbit, p, done }) => (
        <span
          className="sc-orbiter"
          data-done={on(beat >= done)}
          data-orbit={orbit}
          key={label}
          style={{ "--p": p } as CSSProperties}
        >
          <Icon className="size-3.5" strokeWidth={2.2} />
          {t(label)}
          <i>
            <Check className="size-2.5" strokeWidth={4} />
          </i>
        </span>
      ))}
      <span className="sc-pill sc-reveal" data-on={on(beat >= 1)} style={at(24, 20)}>
        <i className="sc-dot" />
        {t("{count} in progress", { count: ORBITERS.filter(({ done }) => beat < done).length })}
      </span>
      <div className="sc-call" data-on={on(calling)}>
        <Robot color="#ffb340" shape="chip" size={38} />
        <span>
          <em>{t("Needs your call")}</em>
          <strong>{t("Two options, A recommended")}</strong>
        </span>
        <b data-on={on(beat >= 6)}>{t("Choose A")}</b>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Target, label: "Goal" },
  { icon: FileCheck, label: "Contract" },
  { icon: Bot, label: "Deliver" },
  { icon: BadgeCheck, label: "Sign-off" },
] as const;
const CRITERIA = ["Prices from official sites", "Every figure has a source", "Trade-offs explained"] as const;
const EVIDENCE = [
  { icon: ChartColumn, label: "Price table" },
  { icon: Link2, label: "Sources" },
  { icon: FileText, label: "report.md" },
] as const;

/** A contract whose criteria are checked off one by one, each with its evidence, then accepted. */
function OutcomeScene() {
  const { t } = useI18n();
  const beat = useBeat(7, 980);
  const accepted = beat >= 7;
  const step = accepted ? 3 : beat >= 3 ? 2 : beat >= 1 ? 1 : 0;
  return (
    <div className="sc-outcome">
      <div className="sc-steps" style={{ "--step": step } as CSSProperties}>
        <i />
        {STEPS.map(({ icon: Icon, label }, index) => (
          <span data-on={on(index <= step)} key={label}>
            <b>
              <Icon className="size-4" strokeWidth={2.2} />
            </b>
            {t(label)}
          </span>
        ))}
      </div>
      <svg className="sc-fill sc-links" viewBox="0 0 720 440">
        {CRITERIA.map((criterion, index) => (
          <path
            d={`M474 ${154 + index * 90} C 440 ${154 + index * 90}, 452 ${219 + index * 48}, 414 ${219 + index * 48}`}
            data-on={on(beat >= 4 + index)}
            key={criterion}
            pathLength={1}
          />
        ))}
      </svg>
      <div className="sc-card sc-contract sc-reveal" data-on={on(beat >= 1)} style={at(76, 104)}>
        <header>
          <em>{t("Contract")}</em>
          <strong>{t("Supplier price comparison")}</strong>
          <small>{t("Goal: shortlist three suppliers")}</small>
        </header>
        <ul>
          {CRITERIA.map((criterion, index) => (
            <li data-on={on(beat >= 2)} data-met={on(beat >= 4 + index)} key={criterion} style={{ "--i": index } as CSSProperties}>
              <i>
                <Check className="size-3" strokeWidth={3.6} />
              </i>
              {t(criterion)}
            </li>
          ))}
        </ul>
        <footer>
          <Robot color="#925df2" shape="goggles" size={30} />
          <span>{t(accepted ? "Accepted" : beat >= 6 ? "Ready for review" : "Working on it")}</span>
          <u style={{ "--fill": Math.max(0, Math.min(1, (beat - 2) / 4)) } as CSSProperties} />
        </footer>
        <span className="sc-stamp" data-on={on(accepted)}>
          <BadgeCheck className="size-5" strokeWidth={2.2} />
          {t("Accepted")}
        </span>
      </div>
      {EVIDENCE.map(({ icon: Icon, label }, index) => (
        <div
          className="sc-card sc-evidence sc-reveal"
          data-from="right"
          data-kind={index}
          data-on={on(beat >= 4 + index)}
          key={label}
          style={at(474, 114 + index * 90)}
        >
          <header>
            <Icon className="size-3.5" strokeWidth={2.2} />
            {t(label)}
          </header>
          <div>
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      ))}
    </div>
  );
}

const SUPPLIERS = [
  { name: "Northstar", price: "$144" },
  { name: "Acme", price: "$216" },
  { name: "Orbit", price: "$200" },
] as const;
// Where the bot's pointer is at each beat, on the 480 × 268 screen.
const POINTER = [
  [340, 130],
  [190, 40],
  [210, 128],
  [232, 160],
  [228, 192],
  [250, 150],
  [96, 226],
  [168, 90],
] as const;

/** A bot at work on its own screen, with you stepping in for a moment. */
function ComputerScene() {
  const { t } = useI18n();
  const beat = useBeat(7, 1050);
  const yours = beat === 6;
  const [x, y] = POINTER[beat] ?? POINTER[0];
  return (
    <div className="sc-computer">
      <div className="sc-peek">
        <Robot color="#14b8c4" shape="tv-head" size={76} />
      </div>
      <div className="sc-monitor" style={at(106, 70)}>
        <div className="sc-screen">
          <div className="sc-browser-bar">
            <i />
            <i />
            <i />
            <span data-on={on(beat >= 1)}>
              <Lock className="size-2.5" strokeWidth={2.6} />
              <b>northstar.example/pricing</b>
            </span>
          </div>
          <div className="sc-page" data-on={on(beat >= 2)}>
            <strong>{t("Supplier pricing")}</strong>
            <ul>
              {SUPPLIERS.map((supplier, index) => (
                <li data-lit={on(beat >= 2 + index)} key={supplier.name} style={{ "--i": index } as CSSProperties}>
                  <span>{supplier.name}</span>
                  <i />
                  <b>{supplier.price}</b>
                  <small>{t("per year")}</small>
                </li>
              ))}
            </ul>
          </div>
          <div className="sc-terminal" data-on={on(beat >= 5)}>
            <p>$ python compare.py</p>
            <p>
              <b>✓</b> {t("3 suppliers compared")}
            </p>
            <p>
              <b>✓</b> {t("Report saved")}
            </p>
          </div>
          <span className="sc-takeover" data-on={on(beat >= 6)} data-yours={on(yours)}>
            {t(yours ? "Take over" : "I'm done, continue")}
          </span>
          <span className="sc-pointer" data-yours={on(yours)} style={{ transform: `translate(${x}px, ${y}px)` }}>
            <MousePointer2 className="size-4" strokeWidth={1.6} />
            <em>{t(yours ? "You" : "Research bot")}</em>
          </span>
        </div>
      </div>
      <span className="sc-stand" />
      <span className="sc-pill sc-live sc-reveal" data-on={on(beat >= 1)} style={at(500, 26)}>
        <i className="sc-dot" />
        {t("Live screen")}
      </span>
    </div>
  );
}

const CREW = [
  { role: "Researcher", line: "Sources are in the folder.", shape: "goggles", color: "#1685ed", x: 34, y: 262, from: 1 },
  { role: "Writer", line: "Got it, drafting now.", shape: "chip", color: "#ff9912", x: 310, y: 286, from: 3 },
  { role: "Reviewer", line: "Checked. Two dates fixed.", shape: "owl", color: "#08c875", x: 586, y: 262, from: 5 },
] as const;
// The file's way at each beat: the researcher, the folder, the writer, the folder, the reviewer, the folder.
const HANDOFFS = [
  [62, 222],
  [62, 222],
  [336, 100],
  [336, 240],
  [336, 100],
  [612, 222],
  [336, 100],
] as const;

/** Three bots with roles passing one file through the shared folder. */
function TeamScene() {
  const { t } = useI18n();
  const beat = useBeat(7, 1000);
  const [x, y] = HANDOFFS[Math.min(beat, HANDOFFS.length - 1)] ?? HANDOFFS[0];
  return (
    <div className="sc-team">
      <svg className="sc-fill sc-routes" viewBox="0 0 720 440">
        <path d="M104 232 C 120 140, 220 96, 284 92" data-on={on(beat >= 1)} />
        <path d="M360 168 L 360 262" data-on={on(beat >= 3)} />
        <path d="M616 232 C 600 140, 500 96, 436 92" data-on={on(beat >= 5)} />
      </svg>
      <div className="sc-folder" data-busy={on(beat === 2 || beat === 4 || beat === 6)}>
        <Folder className="size-12" fill="currentColor" strokeWidth={0} />
        <strong>/workspace</strong>
      </div>
      <span className="sc-file" data-on={on(beat >= 1)} style={{ transform: `translate(${x}px, ${y}px)` }}>
        <FileText className="size-4" strokeWidth={2} />
        brief.md
      </span>
      {CREW.map((bot) => (
        <div className="sc-crew" data-on={on(beat >= bot.from)} key={bot.role} style={at(bot.x, bot.y)}>
          <p>{t(bot.line)}</p>
          <Robot color={bot.color} shape={bot.shape} size={104} />
          <span>{t(bot.role)}</span>
        </div>
      ))}
      <span className="sc-pill sc-memory sc-reveal" data-on={on(beat >= 7)}>
        <Brain className="size-3.5" strokeWidth={2.2} />
        {t("Remembered: lead with decisions")}
      </span>
    </div>
  );
}

const STARS = Array.from({ length: 34 }, (_, index) => ({
  x: (index * 137 + 43) % 712,
  y: ((index * 89 + 17) % 232) + 6,
  r: 0.7 + ((index * 5) % 4) * 0.35,
}));
const NIGHT_RUNS = [
  { time: "23:00", label: "Sort the inbox", icon: Mail, x: 56, y: 196 },
  { time: "02:30", label: "Check packages", icon: CodeXml, x: 204, y: 124 },
  { time: "06:00", label: "Watch prices", icon: ChartColumn, x: 368, y: 124 },
  { time: "08:00", label: "Morning briefing", icon: Sparkles, x: 486, y: 196 },
] as const;

/** A night passing over a sleeping house while the routines run one after another. */
function RoutineScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 1150, 700);
  const dawn = beat >= 5;
  return (
    <div className="sc-night" data-dawn={on(dawn)}>
      <svg className="sc-fill" viewBox="0 0 720 440">
        <defs>
          <radialGradient id="night-dawn">
            <stop offset="0" stopColor="#ffb36b" stopOpacity="0.85" />
            <stop offset="0.5" stopColor="#f2789f" stopOpacity="0.34" />
            <stop offset="1" stopColor="#7a5cff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="night-hill-far" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#2b3a78" />
            <stop offset="1" stopColor="#151d47" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="night-hill-near" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1b2556" />
            <stop offset="1" stopColor="#0c1230" stopOpacity="0" />
          </linearGradient>
        </defs>
        {STARS.map((star, index) => (
          <circle
            className="sc-star"
            cx={star.x}
            cy={star.y}
            data-twinkles={on(index % 3 === 0)}
            fill="#fff"
            key={`${star.x}-${star.y}`}
            r={star.r}
            style={{ animationDelay: `${(index % 7) * -0.6}s` }}
          />
        ))}
        <path className="sc-sky-arc" d="M30 340 A 330 300 0 0 1 690 340" fill="none" />
        <ellipse className="sc-dawn" cx="640" cy="356" fill="url(#night-dawn)" rx="300" ry="190" />
        <path d="M-700 330 C -460 380, -180 300, 0 356 S 220 330, 330 344 S 560 296, 720 340 S 1180 300, 1420 350 V 520 H -700 Z" fill="url(#night-hill-far)" />
        <path d="M-700 400 C -480 350, -220 420, 0 388 S 270 388, 400 376 S 610 356, 720 386 S 1160 352, 1420 396 V 540 H -700 Z" fill="url(#night-hill-near)" />
        <g transform="translate(96 328)">
          <path d="M0 26 L 34 0 L 68 26 V 62 H 0 Z" fill="#0b1130" />
          <rect className="sc-window" height="15" rx="2" width="15" x="13" y="32" />
          <rect fill="#1b2556" height="24" rx="2" width="13" x="43" y="38" />
        </g>
        <g className="sc-sleep" fill="#c7d2ff" fontWeight="700">
          <text fontSize="13" x="152" y="322">z</text>
          <text fontSize="17" x="163" y="306">z</text>
          <text fontSize="22" x="176" y="286">z</text>
        </g>
      </svg>
      <span className="sc-luminary" style={{ offsetDistance: `${8 + Math.min(beat, 4) * 21}%` }}>
        <i />
        <i />
      </span>
      <div className="sc-nightcrew">
        <Robot color="#5b8cff" shape="terminal" size={62} />
        <Robot color="#b48bff" shape="pod" size={52} />
      </div>
      {NIGHT_RUNS.map(({ time, label, icon: Icon, x, y }, index) => (
        <div className="sc-run" data-done={on(beat >= index + 2)} data-on={on(beat >= index + 1)} key={time} style={at(x, y)}>
          <i>
            <Clock className="size-3" strokeWidth={2.4} />
            <Check className="size-3" strokeWidth={3.6} />
          </i>
          <small>{time}</small>
          <strong>
            <Icon className="size-3.5" strokeWidth={2.2} />
            {t(label)}
          </strong>
        </div>
      ))}
      <span className="sc-pill sc-briefing sc-reveal" data-on={on(beat >= 6)}>
        <Bell className="size-3.5" strokeWidth={2.2} />
        {t("Your briefing is ready")}
      </span>
    </div>
  );
}

const QUIET = ["Read 14 emails", "Compared 3 suppliers", "Drafted the replies"] as const;

/** Quiet work settling on the left, and the one card that asks for an answer. */
function DecideScene() {
  const { t } = useI18n();
  const beat = useBeat(7, 950);
  const picked = beat >= 6;
  return (
    <div className="sc-decide">
      <div className="sc-quiet" style={at(0, 92)}>
        <header>{t("Done quietly")}</header>
        {QUIET.map((line, index) => (
          <p data-on={on(beat >= index + 1)} key={line}>
            <i>
              <Check className="size-2.5" strokeWidth={4} />
            </i>
            {t(line)}
          </p>
        ))}
        <p data-on={on(beat >= 7)} data-tone="next">
          <i>
            <Check className="size-2.5" strokeWidth={4} />
          </i>
          {t("Decided, work continues")}
        </p>
      </div>
      <div className="sc-phone" style={at(520, 24)}>
        <div>
          <small>9:41</small>
          <span data-on={on(beat >= 4)} data-done={on(picked)}>
            <img alt="" draggable={false} src={outcomegoIcon} />
            <b>OutcomeGo</b>
            <em>{t(picked ? "Decided, work continues" : "A decision is waiting")}</em>
          </span>
        </div>
      </div>
      <div className="sc-card sc-decision" data-on={on(beat >= 4)} data-picked={on(picked)}>
        <header>
          <Robot color="#1685ed" shape="helmet" size={36} />
          <span>
            <em>{t("Needs your call")}</em>
            <strong>{t("Which supplier to use?")}</strong>
          </span>
        </header>
        <div className="sc-option" data-best="">
          <b>Northstar</b>
          <i>{t("Recommended")}</i>
          <small>{t("Under budget, with single sign-on")}</small>
        </div>
        <div className="sc-option">
          <b>Acme</b>
          <small>{t("Over budget")}</small>
        </div>
        <footer>
          <span>
            <Link2 className="size-3" strokeWidth={2.4} />
            {t("3 sources")}
          </span>
          <span>
            <ChartColumn className="size-3" strokeWidth={2.4} />
            {t("Price table")}
          </span>
          <u data-press={on(beat === 6)}>
            {picked ? <Check className="size-3.5" strokeWidth={3.4} /> : null}
            {t("Approve")}
          </u>
        </footer>
      </div>
      <span className="sc-finger" data-on={on(beat === 5 || beat === 6)} data-press={on(beat === 6)}>
        <MousePointer2 className="size-5" strokeWidth={1.4} />
      </span>
    </div>
  );
}

const INNER = [
  { src: gmailLogo, name: "Gmail" },
  { src: githubLogo, name: "GitHub" },
  { src: notionLogo, name: "Notion" },
  { src: dingtalkLogo, name: "DingTalk" },
] as const;
const OUTER = [
  { src: slackLogo, name: "Slack" },
  { src: calendarLogo, name: "Google Calendar" },
  { src: wechatLogo, name: "WeChat" },
  { src: linearLogo, name: "Linear" },
  { src: driveLogo, name: "Google Drive" },
  { src: null, name: "MCP" },
] as const;
const EVENTS = [
  { event: "New email", result: "Reply drafted", logo: gmailLogo },
  { event: "New issue", result: "Issue triaged", logo: githubLogo },
  { event: "Meeting at 3 PM", result: "Brief prepared", logo: calendarLogo },
] as const;

function Ring({ items, radius, kind }: { items: readonly { src: string | null; name: string }[]; radius: number; kind: string }) {
  return (
    <div className="sc-ring" data-kind={kind} style={{ "--r": `${radius}px` } as CSSProperties}>
      {items.map((item, index) => (
        <span key={item.name} style={{ "--a": `${(360 / items.length) * index}deg`, "--i": index } as CSSProperties}>
          <u />
          <b>
            {item.src ? (
              <img alt="" draggable={false} src={item.src} />
            ) : (
              <Plug className="size-5" strokeWidth={2} />
            )}
          </b>
        </span>
      ))}
    </div>
  );
}

/** The tools people use circling the app, with something arriving on one side and its result on the other. */
function ConnectScene() {
  const { t } = useI18n();
  const beat = useBeat(6, 1150);
  return (
    <div className="sc-connect">
      <Ring items={OUTER} kind="outer" radius={176} />
      <Ring items={INNER} kind="inner" radius={100} />
      <span className="sc-hub">
        <img alt="" draggable={false} src={outcomegoIcon} />
      </span>
      {EVENTS.map(({ event, result, logo }, index) => (
        <div className="sc-event" key={event} style={{ "--i": index } as CSSProperties}>
          <span className="sc-reveal" data-from="left" data-on={on(beat >= index * 2 + 1)}>
            <img alt="" draggable={false} src={logo} />
            {t(event)}
          </span>
          <span className="sc-reveal" data-from="right" data-on={on(beat >= index * 2 + 2)} data-result="">
            <Check className="size-3.5" strokeWidth={3.2} />
            {t(result)}
          </span>
        </div>
      ))}
    </div>
  );
}

const PLATES = [
  { icon: Monitor, name: "Bot computer", holds: "Files and browsers", tone: "#14b8a6" },
  { icon: Database, name: "Database", holds: "Goals and memory", tone: "#6366f1" },
  { icon: Server, name: "Server", holds: "Chats and settings", tone: "#0a84ff" },
] as const;
const MODELS = ["ChatGPT plan", "Claude plan", "API key", "Your own model"] as const;

/** What is being installed right now, stacked inside this computer, with a model of your choice beside it. */
function YoursScene() {
  const { t } = useI18n();
  const beat = useBeat(7, 900);
  const model = beat >= 7 ? 3 : beat >= 6 ? 2 : beat >= 5 ? 1 : 0;
  return (
    <div className="sc-yours">
      <div className="sc-boundary" data-on={on(beat >= 4)}>
        <span>
          <Laptop className="size-4" strokeWidth={2.2} />
          {t("This computer")}
          <Lock className="size-3" strokeWidth={2.8} />
        </span>
      </div>
      <div className="sc-iso">
        {PLATES.map(({ name, tone }, index) => (
          <i
            data-on={on(beat >= index + 1)}
            key={name}
            style={{ "--tone": tone, "--z": index } as CSSProperties}
          >
            <u />
          </i>
        ))}
      </div>
      {PLATES.map(({ icon: Icon, name, holds, tone }, index) => (
        <div
          className="sc-plate-label sc-reveal"
          data-from="right"
          data-on={on(beat >= index + 1)}
          key={name}
          style={at(286, 284 - index * 78, { "--tone": tone })}
        >
          <i>
            <Icon className="size-4" strokeWidth={2.1} />
          </i>
          <span>
            <strong>{t(name)}</strong>
            <small>{t(holds)}</small>
          </span>
        </div>
      ))}
      <svg className="sc-fill sc-wire" data-on={on(beat >= 5)} viewBox="0 0 720 440">
        <path d="M482 220 H 528" />
      </svg>
      <ul className="sc-models" data-on={on(beat >= 5)} style={{ "--pick": model } as CSSProperties}>
        <i />
        {MODELS.map((name, index) => (
          <li data-picked={on(index === model)} key={name}>
            {index === 0 ? (
              <AppIcon app="chatgpt" size={30} />
            ) : index === 1 ? (
              <AppIcon app="claude" size={30} />
            ) : (
              <b data-kind={index}>
                {index === 2 ? <KeyRound className="size-4" strokeWidth={2.1} /> : <Cpu className="size-4" strokeWidth={2.1} />}
              </b>
            )}
            {t(name)}
          </li>
        ))}
      </ul>
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
