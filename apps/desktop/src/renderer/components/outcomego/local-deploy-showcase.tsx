import { type ComponentProps, memo } from "react";
import { registerTranslations } from "../../lib/i18n-catalog";
import { POSTER_MS, POSTERS } from "../../lib/local-deploy-showcase";
import { localDeployShowcaseTranslations } from "../../lib/local-deploy-showcase-catalog";
import type { Playback } from "./poster-scene-kit";
import { SCENES } from "./local-deploy-scenes";
import { DeckNav, DeckPoster, PosterCarousel, type PosterDeck } from "./poster-showcase";

// The posters beside a running deployment: what OutcomeGo is for, told while it installs. How they
// play is the shared carousel's business (poster-showcase.tsx).

export { ShowcaseAir } from "./poster-showcase";

registerTranslations("zh-CN", localDeployShowcaseTranslations);

const DEPLOY_DECK: PosterDeck = {
  label: "Get to know OutcomeGo",
  className: "deploy-showcase",
  posters: POSTERS,
  scenes: SCENES,
  durationMs: POSTER_MS,
  // Trying a failed deployment again carries on instead of starting over.
  memory: { index: 0 },
};

/** One deployment poster on its own (the debug page, test/browser/deploy-showcase.tsx). */
export function ShowcasePoster(props: { index: number; playback: Playback; state: "first" | "entering" | "leaving" }) {
  return <DeckPoster deck={DEPLOY_DECK} {...props} />;
}

/** The deployment posters' controls on their own. */
export function ShowcaseNav(props: Omit<ComponentProps<typeof DeckNav>, "posters">) {
  return <DeckNav posters={POSTERS} {...props} />;
}

export default memo(function DeployShowcase() {
  return <PosterCarousel deck={DEPLOY_DECK} />;
});
