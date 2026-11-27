import type { RobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import { type CSSProperties, createContext, useContext, useEffect, useState } from "react";
import { BotAvatarGlyph } from "./avatar-picker-icons";

// What every poster picture is made of (see poster-showcase.tsx): a story told in beats, and the
// shared pearl robot, glass sphere and tick.

export interface Playback {
  playing: boolean;
  /** Holds the story at this beat; it carries on from there when let go. Only the debug page
   *  (test/browser/deploy-showcase.tsx) sets this and listens. */
  held?: number;
  onBeat?(beat: number, last: number): void;
}
export const ScenePlayback = createContext<Playback>({ playing: true });

/** The story's beat, counting up to `last`. A poster that isn't playing shows it finished. */
export function useBeat(last: number, every = 800, first = 700): number {
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

export const on = (value: boolean) => (value ? "" : undefined);
/** Numbers for the stylesheet. */
export const vars = (values: Record<string, string | number>) => values as CSSProperties;

/** A pearl robot: every bot in the same material as the glass around it. */
export function Robot({ shape, size }: { shape: RobotAvatarShape; size: number }) {
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
export function Sphere({ size, face = false, down = false }: { size: number; face?: boolean; down?: boolean }) {
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
export function Tick({ shown }: { shown: boolean }) {
  return (
    <svg aria-hidden="true" className="vg-tick" data-on={on(shown)} viewBox="0 0 24 24">
      <path d="M6.5 12.5l3.8 3.8 7.4-8.2" pathLength={1} />
    </svg>
  );
}
