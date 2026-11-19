import { toast } from "sonner";
import { useI18n } from "../../../../lib/i18n";
import { api } from "../../../../client/outcomego-api";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../ui/dialog";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { QuickIdeaForm } from "./quick-idea-form";

/** Opened from the sidebar lightbulb; saves in place without leaving the current screen. */
export default function QuickIdeaDialog({
  open,
  onOpenChange,
  bots,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: readonly OutcomeExecutionBot[];
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // No centering transform: the @-picker positions itself with viewport coordinates.
        className="left-[max(16px,calc(50%-280px))] top-[18vh] w-[560px] max-w-[calc(100vw-32px)] translate-x-0 translate-y-0 p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          event.currentTarget instanceof HTMLElement &&
            event.currentTarget.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
        }}
      >
        <DialogTitle>{t("Capture an idea")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Write what you want to do. Use @ to choose a Bot.")}
        </DialogDescription>
        <QuickIdeaForm
          client={api.explore}
          bots={bots}
          onCancel={() => onOpenChange(false)}
          onSaved={() => {
            onOpenChange(false);
            toast.success(t("Idea saved"));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
