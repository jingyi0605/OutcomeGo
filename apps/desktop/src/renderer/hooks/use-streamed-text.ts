import { useLayoutEffect, useRef, useState } from "react";

const FRAME_MS = 24;
const MAX_FRAMES = 5;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function replyRevealFrames(source: string, shown: string | null): string[] {
  if (shown === source) return [];
  if (shown !== null && !source.startsWith(shown)) return [source];

  const ends = Array.from(graphemes.segment(source), ({ index, segment }) => index + segment.length)
    .filter((end) => end > (shown?.length ?? 0));
  const firstEnd = shown === null ? ends.shift() : undefined;
  const frames = firstEnd === undefined ? [] : [source.slice(0, firstEnd)];
  const batch = Math.ceil(ends.length / MAX_FRAMES);
  for (let offset = 0; offset < ends.length; offset += batch) {
    const end = ends[Math.min(offset + batch, ends.length) - 1];
    frames.push(source.slice(0, end));
  }
  return frames;
}

export function useStreamedText(source: string, streaming: boolean): string {
  const [wasStreamed] = useState(streaming);
  const [shown, setShown] = useState(source);
  const cursor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!wasStreamed) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const previous = cursor.current;
    const show = (text: string) => {
      cursor.current = text;
      setShown(text);
    };
    if (motion.matches || (previous !== null && !source.startsWith(previous))) {
      show(source);
      return;
    }
    const frames = replyRevealFrames(source, previous);
    if (previous === null) show(frames.shift() ?? source);
    if (frames.length === 0) return;

    const start = performance.now();
    let index = -1;
    const interval = window.setInterval(() => {
      index = Math.max(index + 1, Math.floor((performance.now() - start) / FRAME_MS) - 1);
      show(motion.matches ? source : frames[Math.min(index, frames.length - 1)]!);
      if (motion.matches || index >= frames.length - 1) window.clearInterval(interval);
    }, FRAME_MS);
    return () => window.clearInterval(interval);
  }, [source, wasStreamed]);
  return wasStreamed ? shown : source;
}
