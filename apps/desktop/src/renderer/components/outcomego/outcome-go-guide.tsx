import { type CSSProperties, useLayoutEffect, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useWindowVisible } from "../../hooks/use-window-active";
import { useI18n } from "../../lib/i18n";
import { registerTranslations } from "../../lib/i18n-catalog";
import {
  completeGuideStep,
  dismissOutcomeGoGuide,
  GUIDE_STEPS,
  type GuideStep,
  markOutcomeGoGuideShown,
  useOutcomeGoGuideSteps,
} from "../../lib/outcome-go-guide";
import { outcomeGoGuideTranslations } from "../../lib/outcome-go-guide-catalog";
import { Button } from "../ui/button";
import "./outcome-go-guide.css";

// The guide shown once per client: a card under the Outcome entry, then under Go, that asks the
// owner to try each. It finds the buttons by [data-guide-target] and presses the real ones, so it opens exactly
// what they open. It blocks nothing, and any way of opening an entry ticks its step off.

registerTranslations("zh-CN", outcomeGoGuideTranslations);

const COPY: Record<GuideStep, { title: string; body: string; action: string }> = {
  outcome: {
    title: "Open Outcome first",
    body: "Goals, to-dos and whatever is waiting for you live here. The Dashboard also shows how your role can use it.",
    action: "Open Outcome",
  },
  go: {
    title: "Then jot something down with Go",
    body: "Write a line, paste a picture or drop in a file. It is saved at once and sorted in the background.",
    action: "Try Go",
  },
};

const CARD_WIDTH = 280;
/** Between the button and the card, and between the card and the window's edge. */
const GAP = 12;
const EDGE = 8;

interface Spot {
  element: HTMLElement;
  left: number;
  top: number;
  /** Where along the card its arrow points up at the button. */
  arrow: number;
}

/** The button for a step that can be used now: not under a dialog, not hidden. The sidebar's comes first. */
const findEntry = (step: GuideStep) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-guide-target="${step}"]`)).find(
    (element) => !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0
  ) ?? null;

const spotFor = (element: HTMLElement): Spot => {
  const rect = element.getBoundingClientRect();
  const width = Math.min(CARD_WIDTH, window.innerWidth - EDGE * 2);
  const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
  const arrow = Math.max(18, Math.min(rect.left + rect.width / 2 - left, width - 18));
  return { element, left, top: rect.bottom + GAP, arrow };
};

const sameSpot = (a: Spot | null, b: Spot | null) =>
  a === b || Boolean(a && b && a.element === b.element && a.left === b.left && a.top === b.top && a.arrow === b.arrow);

/** Where the card goes for a step, kept up to date as the window, sidebar and pages change. */
function useSpot(step: GuideStep | undefined) {
  const [spot, setSpot] = useState<Spot | null>(null);
  useLayoutEffect(() => {
    if (!step) {
      setSpot(null);
      return;
    }
    let frame = 0;
    let watched: HTMLElement | null = null;
    // Several changes in one frame are measured once.
    const schedule = () => {
      frame ||= window.requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    function measure() {
      frame = 0;
      const element = findEntry(step!);
      if (element !== watched) {
        resize?.disconnect();
        watched = element;
        // A dragged or collapsing sidebar moves the buttons without resizing the window.
        for (const box of [element, document.querySelector("[data-sidebar]")]) if (box) resize?.observe(box);
      }
      const next = element ? spotFor(element) : null;
      setSpot((current) => (sameSpot(current, next) ? current : next));
    }
    measure();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      attributeFilter: ["aria-hidden", "inert"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step]);
  return spot;
}

export default function OutcomeGoGuide() {
  const { t } = useI18n();
  const step = useOutcomeGoGuideSteps()[0];
  const spot = useSpot(step);
  const target = spot?.element;
  const visible = useWindowVisible();

  // Seen means on screen: not while the window is hidden, as it is when the app starts in the tray.
  const seen = visible && Boolean(target);
  useEffect(() => {
    if (seen) markOutcomeGoGuideShown();
  }, [seen]);

  useEffect(() => {
    const tried = (event: Event) => {
      const hit = (event.target as Element | null)?.closest?.("[data-guide-target]")?.getAttribute("data-guide-target");
      const opened = GUIDE_STEPS.find((name) => name === hit);
      if (opened) completeGuideStep(opened);
    };
    // On the way up, after the button's own handler has run.
    document.addEventListener("click", tried);
    return () => document.removeEventListener("click", tried);
  }, []);

  useEffect(() => {
    if (!target) return;
    target.setAttribute("data-guide-lit", "");
    return () => target.removeAttribute("data-guide-lit");
  }, [target]);

  if (!step || !spot) return null;
  const copy = COPY[step];
  return createPortal(
    <aside
      aria-label={t("Getting started")}
      className="outcome-go-guide electron-no-drag"
      data-step={step}
      // Only from inside the card: Escape elsewhere belongs to whatever the owner is doing.
      onKeyDown={(event) => event.key === "Escape" && dismissOutcomeGoGuide()}
      style={{ left: spot.left, top: spot.top, "--arrow": `${spot.arrow}px` } as CSSProperties}
    >
      <span className="outcome-go-guide-step">
        {t("Getting started")} · {t("Step {current} of {total}", { current: GUIDE_STEPS.indexOf(step) + 1, total: GUIDE_STEPS.length })}
      </span>
      <div aria-live="polite">
        <h2>{t(copy.title)}</h2>
        <p>{t(copy.body)}</p>
      </div>
      <div className="outcome-go-guide-actions">
        <Button data-guide-skip="" onClick={dismissOutcomeGoGuide} size="xs" variant="subtle">
          {t("Skip")}
        </Button>
        <Button data-guide-try="" onClick={() => spot.element.click()} size="xs">
          {t(copy.action)}
        </Button>
      </div>
    </aside>,
    document.body
  );
}
