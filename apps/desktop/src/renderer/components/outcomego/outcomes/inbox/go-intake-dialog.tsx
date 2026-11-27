import { toast } from "sonner";
import { useI18n } from "../../../../lib/i18n";
import { api } from "../../../../client/outcomego-api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { GoIntakeForm } from "./go-intake-form";

/** The one Go entry point shared by the sidebar, dashboard and Outcome workspace. */
export default function GoIntakeDialog({
  open,
  onOpenChange,
  bots,
  onOpenOutcome,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: readonly OutcomeExecutionBot[];
  onOpenOutcome?: (outcomeId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-[max(16px,calc(50%-280px))] top-[18vh] w-[560px] max-w-[calc(100vw-32px)] translate-x-0 translate-y-0 p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          event.currentTarget instanceof HTMLElement && event.currentTarget.querySelector<HTMLElement>('[role="textbox"], [contenteditable="true"]')?.focus();
        }}
      >
        <DialogTitle>{t("Whatever is on your mind")}</DialogTitle>
        <DialogDescription className="sr-only">{t("Capture text, images or files and let OutcomeGo sort it.")}</DialogDescription>
        <GoIntakeForm
          client={api.outcomes}
          bots={bots}
          onCancel={() => onOpenChange(false)}
          onCompleted={({ outcome, turn }) => {
            onOpenChange(false);
            const action = onOpenOutcome
              ? { label: t("Open"), onClick: () => onOpenOutcome(outcome.id) }
              : undefined;
            if (!turn) {
              toast.warning(t("Saved as a note. Automatic sorting is unavailable right now."), { action });
            } else {
              toast.success(t("Saved. Sorting in the background — check All or Notes."), { action });
            }
          }}
          onError={() => toast.error(t("Could not save this. Try again."))}
        />
      </DialogContent>
    </Dialog>
  );
}
