import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OutcomeAttentionTracker, type AttentionSurface } from "../lib/outcome-attention";
import { useWindowActive, useWindowVisible } from "./use-window-active";

export function useOutcomeAttention({ surface, outcomeId }: { surface: AttentionSurface; outcomeId?: string }) {
  const tracker = useMemo(() => new OutcomeAttentionTracker(surface, (id, sample) =>
    import("../client/outcomego-api").then(({ api }) => api.outcomeAttention(id, sample))), [surface]);
  const [element, ref] = useState<HTMLElement | null>(null);
  const [intersecting, setIntersecting] = useState(false);
  const nativeActive = useWindowActive();
  const nativeVisible = useWindowVisible();
  const focused = useRef(false);
  useEffect(() => { if (outcomeId) tracker.attach(outcomeId); }, [tracker, outcomeId]);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => setIntersecting(entries.some(entry => entry.isIntersecting)), { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  useEffect(() => {
    const update = () => {
      focused.current = nativeActive && nativeVisible && intersecting && document.visibilityState === "visible" && document.hasFocus();
      tracker.setActive(focused.current);
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    const stop = () => tracker.setActive(false);
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", update);
    const interval = window.setInterval(() => { update(); void tracker.flush(); }, 30_000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", update);
      tracker.setActive(false);
    };
  }, [tracker, nativeActive, nativeVisible, intersecting]);
  const attachOutcome = useCallback((id: string) => tracker.attach(id), [tracker]);
  return { ref, attachOutcome };
}
