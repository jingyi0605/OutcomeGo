import { normalizeRobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import { Target } from "lucide-react";
import {
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BotAvatarGlyph } from "../components/outcomego/avatar-picker-icons";
import type { BotDockBotView, BotDockStateView } from "../lib/bot-dock-state";
import { forwardDockFiles } from "./dock-composer";
import { watchDragDiagnostics } from "./drag-debug";
import type { BotDockBridge, DockComposerAnchor, DockSide } from "./types";

/** Avatars stacked in the capsule; the rest collapse into a "+N" chip. */
export const MAX_VISIBLE_BOTS = 4;
const AVATAR_SIZE = 32;
/** A press that moves farther than this is a drag of the capsule, not a click. */
const DRAG_THRESHOLD = 4;

export const badgeText = (count: number) => (count > 99 ? "99+" : String(count));

function DockAvatar({ bot }: { bot: BotDockBotView }) {
  if (bot.avatarDataUrl) {
    return <img alt="" className="dock-avatar-image" draggable={false} src={bot.avatarDataUrl} />;
  }
  return (
    <BotAvatarGlyph
      color={bot.color}
      shape={normalizeRobotAvatarShape(bot.icon)}
      style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, flex: "none" }}
    />
  );
}

/** The goal management entry: its own icon, yellow when goal records wait on the owner to approve,
 * decide or act, and blue when results wait for review. */
function DockOutcomes({ state }: { state: BotDockStateView }) {
  const counts = state.outcomes;
  if (!counts || counts.action + counts.review <= 0) return null;
  const parts = [
    counts.action > 0 ? `${state.labels.goals}: ${counts.action}` : "",
    counts.review > 0 ? `${state.labels.review}: ${counts.review}` : "",
  ].filter(Boolean);
  return (
    <button
      aria-label={[state.labels.outcomes, ...parts].join(", ")}
      className="dock-outcomes"
      data-dock-outcomes=""
      title={[state.labels.outcomes, ...parts].join(" · ")}
      type="button"
    >
      <Target aria-hidden="true" className="dock-outcomes-icon" strokeWidth={1.8} />
      {counts.action > 0 ? (
        <span className="dock-badge dock-badge-goals dock-badge-top" data-dock-badge="outcome-action">
          {badgeText(counts.action)}
        </span>
      ) : null}
      {counts.review > 0 ? (
        <span className="dock-badge dock-badge-review" data-dock-badge="outcome-review">
          {badgeText(counts.review)}
        </span>
      ) : null}
    </button>
  );
}

/** The right side of the capsule: the goal management entry when goal records wait, then the Bots
 * with something waiting, overlapped, each with a red (unread messages) and a yellow (goals
 * waiting on the owner) badge. */
export function DockBots({ state }: { state: BotDockStateView }) {
  const visible = state.bots.slice(0, MAX_VISIBLE_BOTS);
  const hidden = state.bots.length - visible.length;
  const hasOutcomes = Boolean(state.outcomes && state.outcomes.action + state.outcomes.review > 0);
  if (visible.length === 0 && !hasOutcomes) return null;
  return (
    <div className="dock-bots">
      <DockOutcomes state={state} />
      {visible.map((bot, index) => (
        <button
          aria-label={[
            bot.name,
            bot.messages > 0 ? `${state.labels.messages}: ${bot.messages}` : "",
            bot.goals > 0 ? `${state.labels.goals}: ${bot.goals}` : "",
          ]
            .filter(Boolean)
            .join(", ")}
          className="dock-bot"
          data-dock-bot={bot.id}
          key={bot.id}
          // Earlier Bots sit on top, so each badge stays visible over the next avatar.
          style={{ zIndex: visible.length - index }}
          type="button"
        >
          <DockAvatar bot={bot} />
          {bot.messages > 0 ? (
            <span
              className="dock-badge dock-badge-messages"
              data-dock-badge="messages"
              title={`${state.labels.messages}: ${bot.messages}`}
            >
              {badgeText(bot.messages)}
            </span>
          ) : null}
          {bot.goals > 0 ? (
            <span
              className="dock-badge dock-badge-goals"
              data-dock-badge="goals"
              title={`${state.labels.goals}: ${bot.goals}`}
            >
              {badgeText(bot.goals)}
            </span>
          ) : null}
        </button>
      ))}
      {hidden > 0 ? (
        <button className="dock-more" data-dock-app="" type="button">
          +{hidden}
        </button>
      ) : null}
    </div>
  );
}

/** What a press landed on: a Bot's avatar, the capsule's own button, or the "+N" chip. */
type PressTarget = { kind: "bot"; id: string } | { kind: "home" } | { kind: "app" } | { kind: "outcomes" };

interface Gesture {
  x: number;
  y: number;
  dragging: boolean;
  /** Undefined for the plain capsule, which only drags. */
  target: PressTarget | undefined;
}

export function useDockState(bridge: BotDockBridge | undefined) {
  const [state, setState] = useState<BotDockStateView | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const stop = bridge.onState(setState);
    void bridge.getState().then((initial) => {
      if (active) setState((current) => current ?? initial);
    });
    return () => {
      active = false;
      stop();
    };
  }, [bridge]);
  const theme = state?.theme;
  useEffect(() => {
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  return state;
}

/** The Bot floating window: a capsule with the app button on the left and, on the right, the
 * Bots that have something waiting, overlapped, each with a red (messages) and yellow (goals) badge. */
export function BotDockApp({ invitation = false }: { invitation?: boolean }) {
  const bridge = window.botdock;
  const state = useDockState(bridge);
  const frameRef = useRef<HTMLDivElement>(null);
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const reported = useRef("");
  const [messageShake, setMessageShake] = useState(false);
  const [composerMotion, setComposerMotion] = useState<{
    anchor: DockComposerAnchor;
    open: boolean;
  } | null>(null);
  const [overCapsule, setOverCapsule] = useState(false);
  const [invitationVisible, setInvitationVisible] = useState(false);
  const [dockSide, setDockSide] = useState<DockSide>("left");
  const rosterSize = state?.roster.length ?? 0;
  const hasState = state !== null;
  const rosterSizeRef = useRef(rosterSize);
  rosterSizeRef.current = rosterSize;

  useEffect(() => {
    if (!bridge) return;
    const stopMessageArrival = bridge.onMessageArrival(() => setMessageShake(true));
    const stopComposerAnchor = bridge.onComposerAnchor((anchor) => {
      setComposerMotion((previous) =>
        anchor ? { anchor, open: true } : previous && { ...previous, open: false }
      );
    });
    return () => {
      stopMessageArrival();
      stopComposerAnchor();
    };
  }, [bridge]);

  // Files dragged from the desktop: hovering invites the drop, dropping opens the composer with
  // the files attached, like pasting them. Only drags that carry files take part.
  useEffect(() => {
    if (!bridge) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovering = false;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;
    const endHover = () => {
      clearTimeout(timer);
      setOverCapsule(false);
      if (!hovering) return;
      hovering = false;
      bridge.setFileHover(false);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (rosterSizeRef.current === 0) return;
      const target = dropTargetRef.current?.getBoundingClientRect();
      const withinCapsule =
        target &&
        event.clientX >= target.left &&
        event.clientX < target.right &&
        event.clientY >= target.top &&
        event.clientY < target.bottom;
      setOverCapsule(Boolean(withinCapsule));
      if (!hovering) {
        hovering = true;
        bridge.setFileHover(true);
      }
      // dragover repeats while the pointer is over the window: silence means it left.
      clearTimeout(timer);
      timer = setTimeout(endHover, 600);
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      const outside =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;
      if (outside) endHover();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      // The list is cleared once the handler returns: copy it out now.
      const files = [...(event.dataTransfer?.files ?? [])];
      endHover();
      if (rosterSizeRef.current === 0) return;
      bridge.drop();
      if (files.length > 0) void forwardDockFiles(bridge, files);
    };
    window.addEventListener("dragenter", onOver);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("dragenter", onOver);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [bridge]);

  useEffect(() => watchDragDiagnostics(bridge), [bridge]);

  useLayoutEffect(() => bridge?.onDockSide(setDockSide), [bridge]);

  // Main sizes the window to the capsule, and shows it once it has a size.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !bridge || (invitation && !hasState)) return;
    const stopVisibility = invitation
      ? bridge.onSurfaceVisible(setInvitationVisible)
      : undefined;
    const report = () => {
      const { width, height } = frame.getBoundingClientRect();
      const layout = invitation ? "invitation" : "compact";
      const key = `${layout}:${Math.ceil(width)}x${Math.ceil(height)}`;
      if (key === reported.current) return;
      reported.current = key;
      bridge.resize(width, height, layout);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      stopVisibility?.();
    };
  }, [bridge, invitation, hasState]);

  if (!bridge) return null;
  // Show placeholder until state arrives
  if (!state) {
    return (
      <div className="dock-viewport">
        <div className="dock-frame" data-dock-side={dockSide} data-standby="true" ref={frameRef}>
          <div className="dock-capsule">
            <button
              className="dock-home"
              data-dock-open=""
              type="button"
              disabled
              title="Waiting for OutcomeGo to load..."
            />
          </div>
        </div>
      </div>
    );
  }

  const pressTarget = (event: PointerEvent): PressTarget | undefined => {
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-dock-bot], [data-dock-open], [data-dock-app], [data-dock-outcomes]"
    );
    if (!element) return undefined;
    if ("dockOutcomes" in element.dataset) return { kind: "outcomes" };
    if (element.dataset.dockBot) return { kind: "bot", id: element.dataset.dockBot };
    return "dockApp" in element.dataset ? { kind: "app" } : { kind: "home" };
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    gesture.current = {
      x: event.screenX,
      y: event.screenY,
      dragging: false,
      target: pressTarget(event),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.dragging) return;
    if (Math.hypot(event.screenX - current.x, event.screenY - current.y) > DRAG_THRESHOLD) {
      current.dragging = true;
      bridge.dragStart();
    }
  };
  const finish = (activate: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;
    if (current.dragging) bridge.dragEnd();
    else if (activate && current.target) {
      if (current.target.kind === "bot") bridge.open(current.target.id);
      else if (current.target.kind === "app") bridge.focusApp();
      else if (current.target.kind === "outcomes") bridge.openGoals();
      else bridge.open();
    }
  };
  const runningLabel = state.running ? state.labels.running ?? "Bot activity in progress" : undefined;

  return (
    <div className="dock-viewport">
      <div
        className="dock-frame"
        data-dock-side={dockSide}
        data-dropping={invitation || undefined}
        data-invitation-visible={(invitation && invitationVisible) || undefined}
        data-drop-target={(invitation && overCapsule) || undefined}
        data-message-shake={messageShake ? true : undefined}
        data-standby={!invitation || undefined}
        ref={frameRef}
      >
        <div
          className="dock-drop-target"
          data-composer-open={composerMotion?.open || undefined}
          data-composer-x={composerMotion ? (composerMotion.anchor.right ? "right" : "left") : undefined}
          data-composer-y={composerMotion ? (composerMotion.anchor.bottom ? "top" : "bottom") : undefined}
          ref={dropTargetRef}
        >
          <div
            className="dock-message-motion"
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && event.animationName === "dock-shake") {
                setMessageShake(false);
              }
            }}
          >
            <div
              aria-label="OutcomeGo"
              className="dock-capsule"
              data-running={state.running || undefined}
              onContextMenu={(event) => {
                event.preventDefault();
                finish(false);
                bridge.contextMenu();
              }}
              onLostPointerCapture={() => finish(false)}
              onPointerCancel={() => finish(false)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => finish(true)}
            >
              <button
                aria-label={runningLabel ? `${state.labels.open}, ${runningLabel}` : state.labels.open}
                className="dock-home"
                data-dock-open=""
                type="button"
                title={runningLabel}
              />
              <DockBots state={state} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
