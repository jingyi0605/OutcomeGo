import type { RobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import {
  Ban,
  Boxes,
  Check,
  CircleQuestionMark,
  CircleSlash,
  Container,
  Database,
  Download,
  Globe,
  LoaderCircle,
  type LucideIcon,
  PackageX,
  Power,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useI18n } from "../../lib/i18n";
import type { EngineOption } from "../../lib/local-deploy-flow";
import { BotAvatarGlyph } from "./avatar-picker-icons";

// The two engines as pictures. Yours: a robot's box drops in beside the containers you already
// run. OutcomeGo's: a walled space of its own builds itself next to them. What was found on this
// computer changes the drawing (dashed when missing, waiting when stopped), and the picked one
// moves. All motion is CSS (local-deploy.css).

const stateIcon = (option: EngineOption): LucideIcon => {
  switch (option.tone) {
    case "checking":
      return LoaderCircle;
    case "ready":
      return Check;
    case "setup":
      return Download;
    case "attention":
      if (option.kind === "external") return Power;
      return option.status === "Restart needed" ? RotateCw : ShieldAlert;
    case "unavailable":
      return option.kind === "external" ? PackageX : Ban;
    case "blocked":
      return Ban;
    default:
      // An engine this deployment can no longer use is crossed out, not in question.
      return option.selectable ? CircleQuestionMark : CircleSlash;
  }
};

/** Something you already run. */
const Yours = ({ icon: Icon }: { icon: LucideIcon }) => (
  <span className="deploy-art-crate" data-owner="yours">
    <Icon strokeWidth={2} />
  </span>
);

/** An OutcomeGo bot in its box. */
const Bot = ({ shape, live, order }: { shape: RobotAvatarShape; live: boolean; order: number }) => (
  <span className="deploy-art-crate" data-owner="ours" style={{ "--n": order } as CSSProperties}>
    <BotAvatarGlyph
      color="#fff"
      eyeColor="var(--lane)"
      height={28}
      mode={live ? "idle" : "still"}
      shape={shape}
      width={28}
    />
  </span>
);

const EngineBar = ({ icon: Icon, label }: { icon: LucideIcon; label?: string }) => (
  <span className="deploy-art-engine">
    <Icon strokeWidth={2.1} />
    {label ? <b>{label}</b> : null}
  </span>
);

export function EngineArt({
  option,
  platform,
  live,
}: {
  option: EngineOption;
  platform: string | undefined;
  /** The picked engine, which is the one that moves. */
  live: boolean;
}) {
  const { t } = useI18n();
  const State = stateIcon(option);
  return (
    <div aria-hidden="true" className="deploy-art" data-live={live || undefined} data-tone={option.tone}>
      <div className="deploy-art-screen">
        {option.kind === "external" ? (
          <div className="deploy-art-stack">
            <div className="deploy-art-shelf">
              <Yours icon={Globe} />
              <Yours icon={Database} />
              <Bot live={live} order={0} shape="classic" />
            </div>
            {/* A detected engine is named as it reported itself. */}
            <EngineBar icon={Container} label={option.meta ?? "Docker"} />
          </div>
        ) : (
          <>
            <div className="deploy-art-stack" data-apart="">
              <div className="deploy-art-shelf">
                <Yours icon={Globe} />
                <Yours icon={Database} />
              </div>
              <EngineBar icon={Container} />
            </div>
            <span className="deploy-art-fence">
              <ShieldCheck strokeWidth={2.2} />
            </span>
            <div className="deploy-art-capsule">
              {/* Image sources being tried; the middle one is quickest. */}
              <span className="deploy-art-streams">
                <i />
                <i />
                <i />
              </span>
              <div className="deploy-art-shelf">
                <Bot live={live} order={1} shape="goggles" />
                <Bot live={live} order={2} shape="tv-head" />
              </div>
              <EngineBar icon={Boxes} label={platform === "darwin" ? t("Virtual machine") : "WSL 2"} />
            </div>
          </>
        )}
        <span className="deploy-art-state" key={option.status}>
          <State strokeWidth={2.4} />
        </span>
        {option.tone === "checking" ? <span className="deploy-art-scan" /> : null}
      </div>
      <span className="deploy-art-base" />
    </div>
  );
}
