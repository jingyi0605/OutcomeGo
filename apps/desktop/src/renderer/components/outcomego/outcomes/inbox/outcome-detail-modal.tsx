import { lazy, Suspense, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import type { OutcomeDetailRoute } from "./outcome-route-view";
import "../outcome-ui.css";

const OutcomeRouteView = lazy(() =>
  import("./outcome-route-view").then((module) => ({ default: module.OutcomeRouteView }))
);

/**
 * Goal detail opened in place (for example from a chat card) so the reader never leaves the
 * conversation. Decisions and human tasks reached from the goal stay inside the same modal.
 */
export default function OutcomeDetailModal({
  outcomeId,
  bots,
  onClose,
}: {
  outcomeId: string;
  bots: OutcomeExecutionBot[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [route, setRoute] = useState<OutcomeDetailRoute>({ kind: "outcome", id: outcomeId });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="outcome-modal outcome-page" overlayClassName="outcome-modal-overlay">
        <DialogTitle className="sr-only">
          {t(
            route.kind === "decision"
              ? "Decision"
              : route.kind === "human"
                ? "Human action"
                : "Goal details"
          )}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("Review the goal and handle current decisions.")}
        </DialogDescription>
        <div className="outcome-page-content outcome-modal-body space-y-5">
          <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
            <OutcomeRouteView route={route} bots={bots} onOpen={setRoute} onClose={onClose} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
