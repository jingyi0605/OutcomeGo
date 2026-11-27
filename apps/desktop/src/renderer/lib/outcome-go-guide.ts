// The guide to Outcome and Go (outcome-go-guide.tsx) is shown once per client: to anyone whose
// client holds no record of it, new or long in use. The record is written as soon as the card is
// seen, so quitting halfway doesn't bring it back. The steps still to try last only as long as
// the app runs.
import { useSyncExternalStore } from "react";

export type GuideStep = "outcome" | "go";
/** In the order they are shown. */
export const GUIDE_STEPS: readonly GuideStep[] = ["outcome", "go"];

export const OUTCOME_GO_GUIDE_KEY = "openteam:outcome-go-guide";
const SHOWN = "shown";
const NONE: readonly GuideStep[] = [];

const listeners = new Set<() => void>();
/** What is left of this run's guide. Decided on first use, so writing the record doesn't take the card away. */
let left: readonly GuideStep[] | undefined;

const hasRecord = () => {
  try {
    return window.localStorage.getItem(OUTCOME_GO_GUIDE_KEY) !== null;
  } catch {
    return false;
  }
};

const remaining = () => (left ??= hasRecord() ? NONE : GUIDE_STEPS);

const publish = (next: readonly GuideStep[]) => {
  left = next;
  for (const listener of listeners) listener();
};

/** The card has been seen: this client won't be shown the guide again. */
export const markOutcomeGoGuideShown = () => {
  try {
    window.localStorage.setItem(OUTCOME_GO_GUIDE_KEY, SHOWN);
  } catch {
    // Without storage it is remembered only while the app runs.
  }
};

/** Ticks off an entry the owner has opened. Does nothing for a step that isn't waiting. */
export const completeGuideStep = (step: GuideStep) => {
  const steps = remaining();
  if (!steps.includes(step)) return;
  markOutcomeGoGuideShown();
  publish(steps.filter((other) => other !== step));
};

export const dismissOutcomeGoGuide = () => {
  markOutcomeGoGuideShown();
  publish(NONE);
};

/** Drops what this run remembers, as quitting the app does. For tests. */
export const restartOutcomeGoGuide = () => {
  left = undefined;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useOutcomeGoGuideSteps = (): readonly GuideStep[] => useSyncExternalStore(subscribe, remaining, () => NONE);
