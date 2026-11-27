import { useEffect } from "react";
import { toast } from "sonner";
import type { OutcomeKind } from "@outcomego/contracts/outcomes";
import { useI18n } from "../lib/i18n";
import { subscribeOutcomeTriageEvents } from "../lib/outcome-events";
import { subscribeOutcomeThreadEvents } from "../lib/outcome-thread";

const TRIAGE_KIND_LABELS: Record<OutcomeKind, string> = {
  standard: "Goal",
  tracked: "Bot-registered",
  scheduled_once: "Scheduled",
  todo: "To-do",
  explore_idea: "Idea",
  note: "Note",
};

/** Tells the owner when a goal's bot has answered or Go intake sorting has finished, wherever they are in the app. */
export function useOutcomeThreadNotices(onOpenOutcome?: (outcomeId: string) => void) {
  const { t } = useI18n();
  useEffect(() => {
    const offThread = subscribeOutcomeThreadEvents(({ outcomeId, status, title, planMode }) => {
      if (planMode === "triage") return;
      const action = onOpenOutcome ? { label: t("Open"), onClick: () => onOpenOutcome(outcomeId) } : undefined;
      if (status === "completed")
        toast.success(t("The bot replied about “{title}”. Open the goal to read it.", { title }), { action });
      else if (status === "failed")
        toast.error(t("The bot couldn’t finish working on “{title}”. Open the goal to try again.", { title }), { action });
    });
    const offTriage = subscribeOutcomeTriageEvents((event) => {
      if (event.triageStatus === "completed") {
        const splitCount = event.createdChildren?.length ?? 0;
        const heading = splitCount > 0
          ? t("Sorted into a note and {count} linked items", { count: splitCount })
          : event.sourceKind
            ? t("Sorted as {kind}", { kind: t(TRIAGE_KIND_LABELS[event.sourceKind]) })
            : t("Go intake sorted");
        toast.success(heading, {
          ...(event.triageSummary ? { description: event.triageSummary } : {}),
          ...(onOpenOutcome
            ? { action: { label: t("Open or reclassify"), onClick: () => onOpenOutcome(event.outcomeId) } }
            : {}),
        });
      } else if (event.triageStatus === "failed") {
        toast.error(t("Could not sort your Go note automatically. Your note and files are saved."), {
          ...(onOpenOutcome
            ? { action: { label: t("Open to retry"), onClick: () => onOpenOutcome(event.outcomeId) } }
            : {}),
        });
      }
    });
    return () => {
      offThread();
      offTriage();
    };
  }, [onOpenOutcome, t]);
}
