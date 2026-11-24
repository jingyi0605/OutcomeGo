import { Component, lazy, type ReactNode, Suspense } from "react";

const DeployShowcase = lazy(() => import("./local-deploy-showcase"));

/** The posters are decoration: if they fail to load or draw, the deployment beside them goes on. */
class ShowcaseBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The stage beside a running deployment, loaded once one starts. */
export function DeployShowcaseVisual() {
  return (
    <ShowcaseBoundary>
      <Suspense fallback={null}>
        <DeployShowcase />
      </Suspense>
    </ShowcaseBoundary>
  );
}
