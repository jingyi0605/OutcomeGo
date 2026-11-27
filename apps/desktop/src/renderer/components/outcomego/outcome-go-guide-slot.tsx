import { Component, lazy, type ReactNode, Suspense } from "react";
import { useOutcomeGoGuideSteps } from "../../lib/outcome-go-guide";

const OutcomeGoGuide = lazy(() => import("./outcome-go-guide"));

/** The guide is a helping hand: if it fails to load or draw, the app goes on without it. */
class GuideBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Where the app keeps the guide to Outcome and Go, loaded only while a step of it is left. */
export function OutcomeGoGuideSlot() {
  if (useOutcomeGoGuideSteps().length === 0) return null;
  return (
    <GuideBoundary>
      <Suspense fallback={null}>
        <OutcomeGoGuide />
      </Suspense>
    </GuideBoundary>
  );
}
