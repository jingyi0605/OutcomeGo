import { normalizeRobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import {
  type PointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BotAvatarGlyph } from "../components/outcomego/avatar-picker-icons";
import type { BotDockBotView, BotDockStateView } from "../lib/bot-dock-state";
import { forwardDockFiles } from "./dock-composer";
import type { BotDockBridge, DockComposerAnchor } from "./types";

/** Avatars stacked in the capsule; the rest collapse into a "+N" chip. */
export const MAX_VISIBLE_BOTS = 4;
const AVATAR_SIZE = 32;
/** A press that moves farther than this is a drag of the capsule, not a click. */
const DRAG_THRESHOLD = 4;

export const badgeText = (count: number) => (count > 99 ? "99+" : String(count));

function DockMascot() {
  const id = useId();
  const silhouette = `${id}-silhouette`;
  const pearl = `${id}-pearl`;
  const sheen = `${id}-sheen`;
  const rim = `${id}-rim`;

  return (
    <svg aria-hidden="true" className="dock-mascot" viewBox="0 0 40 40">
      <defs>
        <path
          id={silhouette}
          d="M15 2.8C10.4 3.5 5.1 7 2.3 12 .5 16.5.5 23.8 2.8 27.5 5 32 10.5 34.5 16.5 36.3c4.2 1.05 9.5 1.05 13.5-.2 5.8-2.4 7.6-7 8.4-11.4C39.1 19 36.5 12 32.5 7.5 30.3 3 25 1.5 15 2.8Z"
        />
        <radialGradient id={pearl} cx="34%" cy="20%" r="82%">
          <stop offset="0" stopColor="#fffefa" />
          <stop offset="0.53" stopColor="#f4f5fb" />
          <stop offset="0.84" stopColor="#dbe0ef" />
          <stop offset="1" stopColor="#aab4cf" />
        </radialGradient>
        <radialGradient id={sheen} cx="29%" cy="19%" r="55%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={rim} x2="0%" y2="100%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#8491ae" stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <use href={`#${silhouette}`} fill={`url(#${pearl})`} />
      <use href={`#${silhouette}`} fill={`url(#${sheen})`} stroke={`url(#${rim})`} strokeWidth="1" />
      <g fill="#242936">
        <rect
          height="6.4"
          rx="1.875"
          transform="rotate(-16 21.05 15.8)"
          width="3.75"
          x="19.075"
          y="12.6"
        />
        <rect
          height="6.4"
          rx="1.45"
          transform="rotate(-16 31.7 14.5)"
          width="2.9"
          x="30.25"
          y="11.3"
        />
      </g>
    </svg>
  );
}

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

/** The right side of the capsule: the Bots with something waiting, overlapped, each with a red
 * (unread messages) and a yellow (goals waiting on the owner) badge. */
export function DockBots({ state }: { state: BotDockStateView }) {
  const visible = state.bots.slice(0, MAX_VISIBLE_BOTS);
  const hidden = state.bots.length - visible.length;
  if (visible.length === 0) return null;
  return (
    <div className="dock-bots">
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
type PressTarget = { kind: "bot"; id: string } | { kind: "home" } | { kind: "app" };

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
export function BotDockApp() {
  const bridge = window.botdock;
  const state = useDockState(bridge);
  const frameRef = useRef<HTMLDivElement>(null);
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const reported = useRef<{ key: string; layout: "compact" | "invitation" } | null>(
    null
  );
  const compactResizeId = useRef(0);
  const [messageShake, setMessageShake] = useState(false);
  const [composerMotion, setComposerMotion] = useState<{
    anchor: DockComposerAnchor;
    open: boolean;
  } | null>(null);
  const [fileHover, setFileHover] = useState<"outside" | "window" | "capsule">("outside");
  const [dragHint, setDragHint] = useState(false);
  const rosterSize = state?.roster.length ?? 0;
  const dropInvitation = (fileHover !== "outside" || dragHint) && rosterSize > 0;
  const layout = dropInvitation ? "invitation" : "compact";
  const rosterSizeRef = useRef(rosterSize);
  rosterSizeRef.current = rosterSize;

  useEffect(() => {
    if (!bridge) return;
    const stopMessageArrival = bridge.onMessageArrival(() => setMessageShake(true));
    const stopDragHint = bridge.onDragHint(setDragHint);
    const stopComposerAnchor = bridge.onComposerAnchor((anchor) => {
      setComposerMotion((previous) =>
        anchor ? { anchor, open: true } : previous && { ...previous, open: false }
      );
    });
    return () => {
      stopMessageArrival();
      stopDragHint();
      stopComposerAnchor();
    };
  }, [bridge]);

  // Files dragged from the desktop: hovering invites the drop, dropping opens the composer with
  // the files attached, like pasting them. Only drags that carry files take part.
  useEffect(() => {
    if (!bridge) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;
    const endHover = () => {
      clearTimeout(timer);
      setFileHover("outside");
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (rosterSizeRef.current === 0) return;
      const target = dropTargetRef.current?.getBoundingClientRect();
      const overCapsule =
        target &&
        event.clientX >= target.left &&
        event.clientX < target.right &&
        event.clientY >= target.top &&
        event.clientY < target.bottom;
      setFileHover(overCapsule ? "capsule" : "window");
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
      setDragHint(false);
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

  // Main sizes the window to the capsule, and shows it once it has a size.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !bridge) return;
    let pendingCompactId: number | undefined;
    const stop = bridge.onCompactViewportReady((resizeId) => {
      if (resizeId !== pendingCompactId) return false;
      frame.removeAttribute("data-awaiting-compact");
      return true;
    });
    const report = () => {
      const { width, height } = frame.getBoundingClientRect();
      const key = `${layout}:${Math.ceil(width)}x${Math.ceil(height)}`;
      const previous = reported.current;
      if (key === previous?.key) return;
      const restoring =
        layout === "compact" &&
        (frame.hasAttribute("data-awaiting-compact") ||
          (previous !== null && previous.layout !== "compact"));
      pendingCompactId = restoring ? ++compactResizeId.current : undefined;
      frame.toggleAttribute("data-awaiting-compact", restoring);
      reported.current = { key, layout };
      bridge.resize(width, height, layout, pendingCompactId);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [bridge, layout]);

  if (!bridge) return null;
  // Show placeholder until state arrives
  if (!state) {
    return (
      <div className="dock-viewport">
        <div className="dock-frame" data-standby="true" ref={frameRef}>
          <div className="dock-capsule">
            <button
              className="dock-home"
              data-dock-open=""
              type="button"
              disabled
              title="Waiting for OutcomeGo to load..."
            >
              <DockMascot />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pressTarget = (event: PointerEvent): PressTarget | undefined => {
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-dock-bot], [data-dock-open], [data-dock-app]"
    );
    if (!element) return undefined;
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
      else bridge.open();
    }
  };

  return (
    <div className="dock-viewport">
      <div
        className="dock-frame"
        data-dropping={dropInvitation ? true : undefined}
        data-drop-target={dropInvitation && fileHover === "capsule" ? true : undefined}
        data-message-shake={messageShake ? true : undefined}
        data-standby={layout === "compact" ? true : undefined}
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
                aria-label={state.labels.open}
                className="dock-home"
                data-dock-open=""
                type="button"
              >
                <DockMascot />
              </button>
              <DockBots state={state} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
