import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useI18n } from "../../lib/i18n";
import { Dialog } from "../ui/dialog";
import { GroupTasks } from "./group-tasks";

interface GroupTasksBottomSheetProps {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GroupTasksBottomSheet({ channelId, open, onOpenChange }: GroupTasksBottomSheetProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 dark:bg-black/40" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl outline-none"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2.5">
            <h2 className="text-sm font-semibold">{t("Tasks")}</h2>

            {/* Close button */}
            <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <X className="size-3.5" />
              <span className="sr-only">{t("Close")}</span>
            </DialogPrimitive.Close>
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <GroupTasks active={open} channelId={channelId} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
