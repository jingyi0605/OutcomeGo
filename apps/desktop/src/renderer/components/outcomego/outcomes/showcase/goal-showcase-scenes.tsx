import { BadgeCheck, ClipboardList, FileText, type LucideIcon, PenLine } from "lucide-react";
import { type ComponentType, createContext, useContext } from "react";
import { GOAL_STORIES, type GoalPosterId, type GoalStory } from "../../../../lib/goal-showcase";
import { useI18n } from "../../../../lib/i18n";
import { on, Robot, Tick, useBeat, vars } from "../../poster-scene-kit";

// The pictures on the goal posters, drawn like the deployment ones: a 720 × 440 canvas, a story told
// in beats, and elements that arrive with CSS transitions ([data-on], goal-showcase.css). A poster
// that isn't playing shows its last beat, so that one reads as the finished picture. The staging is
// the same for every role; what is written in it comes from the role's story.

export const GoalStoryContext = createContext<GoalStory>(GOAL_STORIES[0]!);
const usePicture = () => useContext(GoalStoryContext).picture;

const STATIONS: readonly { label: string; icon: LucideIcon | null; x: number }[] = [
  { label: "Capture", icon: PenLine, x: 105 },
  { label: "Plan", icon: ClipboardList, x: 275 },
  // The bot does this one, so it stands there itself.
  { label: "Execute", icon: null, x: 445 },
  { label: "Accept", icon: BadgeCheck, x: 615 },
];
/** The stations where the owner has the last word. */
const OWNER_STATIONS = [1, 3] as const;

/** A goal on its way from a note to an accepted result. */
function ConceptScene() {
  const { t } = useI18n();
  const { bot, plan } = usePicture();
  const beat = useBeat(6, 750, 500);
  const reach = Math.min(Math.max(beat - 1, 0), STATIONS.length - 1) / (STATIONS.length - 1);
  return (
    <div className="gs-concept">
      <svg className="vg-fill gs-path" viewBox="0 0 720 440">
        <path className="gs-track" d="M105 200 H615" />
        <path className="gs-flow" d="M105 200 H615" pathLength={1} style={vars({ "--reach": reach })} />
      </svg>
      {STATIONS.map(({ label, icon: Icon, x }, index) => (
        <div className="gs-station" data-on={on(beat > index)} key={label} style={{ left: x }}>
          <span className="vg gs-orb">
            {Icon ? <Icon className="size-12" strokeWidth={1.6} /> : <Robot shape={bot.shape} size={68} />}
          </span>
          <strong>{t(label)}</strong>
        </div>
      ))}
      {OWNER_STATIONS.map((index) => (
        <span className="vg vg-capsule gs-yours" data-on={on(beat >= 5)} key={index} style={{ left: STATIONS[index]!.x }}>
          <i />
          {t("You decide")}
        </span>
      ))}
      <span className="vg vg-capsule gs-result" data-on={on(beat >= 6)}>
        <Tick shown={beat >= 6} />
        {t("{result}, with evidence", { result: t(plan) })}
      </span>
    </div>
  );
}

const KINDS = ["Goals", "To-dos", "Scheduled", "Ideas", "Notes"] as const;
const kindX = (index: number) => 88 + index * 136;

/** A line typed into Go, sent, and sorted. */
function CaptureScene() {
  const { t } = useI18n();
  const { bot, line, file } = usePicture();
  const beat = useBeat(6, 760, 500);
  const sorted = beat >= 4;
  return (
    <div className="gs-capture">
      <svg className="vg-fill gs-fan" viewBox="0 0 720 440">
        {KINDS.map((kind, index) => (
          <path
            d={`M360 236 C 360 282, ${kindX(index)} 270, ${kindX(index)} 322`}
            data-lit={on(beat >= 5 && index === 0)}
            data-on={on(sorted)}
            key={kind}
            pathLength={1}
          />
        ))}
      </svg>
      <div className="vg gs-input">
        <p data-on={on(beat >= 1)}>{t(line)}</p>
        <div className="gs-chips">
          <span data-on={on(beat >= 2)}>
            <Robot shape={bot.shape} size={24} />@{t(bot.name)}
          </span>
          <span data-on={on(beat >= 2)}>
            <FileText className="size-5" strokeWidth={1.8} />
            {t(file)}
          </span>
        </div>
        <span className="gs-go" data-press={on(beat === 3)} data-ready={on(beat >= 2)} data-sent={on(sorted)}>
          {t("Go")}
          <Tick shown={sorted} />
        </span>
      </div>
      {KINDS.map((kind, index) => (
        <span
          className="vg vg-capsule gs-kind"
          data-lit={on(beat >= 5 && index === 0)}
          data-on={on(sorted)}
          key={kind}
          style={{ left: kindX(index), ...vars({ "--i": index }) }}
        >
          {t(kind)}
        </span>
      ))}
    </div>
  );
}

/** The plan arrives line by line, the owner approves it, and the work starts. */
function ApproveScene() {
  const { t } = useI18n();
  const { bot, plan, criteria } = usePicture();
  const beat = useBeat(7, 720, 500);
  const approved = beat >= 5;
  return (
    <div className="gs-approve">
      <div className="vg gs-plan" data-approved={on(approved)}>
        <strong>{t(plan)}</strong>
        <ul>
          {criteria.map((criterion, index) => (
            <li data-on={on(beat > index)} key={criterion}>
              <i />
              {t(criterion)}
            </li>
          ))}
        </ul>
        <div className="gs-buttons">
          <span data-press={on(beat === 5)} data-primary="">
            {t("Yes, approve")}
            <Tick shown={approved} />
          </span>
          <span>{t("Send to bot")}</span>
        </div>
        <b className="gs-progress" data-on={on(beat >= 6)}>
          <i />
        </b>
      </div>
      <span className="gs-touch" data-on={on(beat === 4 || beat === 5)} data-press={on(beat === 5)} />
      <div className="gs-worker" data-on={on(beat >= 6)}>
        <Robot shape={bot.shape} size={96} />
      </div>
      <span className="vg vg-capsule gs-started" data-on={on(beat >= 7)}>
        <i />
        {t("Work has started")}
      </span>
    </div>
  );
}

/** What the owner is asked to do with each of the three things waiting, in the story's order. */
const VERBS = ["Make a decision", "Take action", "Review result"] as const;

/** What waits for the owner, then one result checked against its criteria and accepted. */
function AcceptScene() {
  const { t } = useI18n();
  const { plan, criteria, asks } = usePicture();
  const beat = useBeat(8, 650, 500);
  return (
    <div className="gs-accepting">
      {VERBS.map((verb, index) => (
        <div
          className="vg gs-ask"
          data-lit={on(index === VERBS.length - 1 && beat >= 4)}
          data-on={on(beat > index)}
          key={verb}
          style={{ top: 40 + index * 128 }}
        >
          <strong>{t(asks[index]!)}</strong>
          <em>{t(verb)}</em>
        </div>
      ))}
      <div className="vg gs-review" data-on={on(beat >= 4)}>
        <strong>{t(plan)}</strong>
        <ul>
          {criteria.map((criterion, index) => (
            <li data-met={on(beat >= 5 + index)} key={criterion}>
              <span>
                <Tick shown={beat >= 5 + index} />
              </span>
              {t(criterion)}
              <small>{t("Evidence")}</small>
            </li>
          ))}
        </ul>
        <span className="gs-accepted" data-on={on(beat >= 8)}>
          <Tick shown={beat >= 8} />
          {t("Accepted")}
        </span>
      </div>
    </div>
  );
}

export const GOAL_SCENES: Record<GoalPosterId, ComponentType> = {
  concept: ConceptScene,
  capture: CaptureScene,
  approve: ApproveScene,
  accept: AcceptScene,
};
