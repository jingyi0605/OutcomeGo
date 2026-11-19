import { Lightbulb, Target } from "lucide-react";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";

export function OutcomeNavigation({
  active,
  compact = false,
  onOpen,
  onNewIdea,
}: {
  active: boolean;
  compact?: boolean;
  onOpen: () => void;
  /** Expanded sidebar only: shows a quick-capture lightbulb at the right end of the row. */
  onNewIdea?: () => void;
}) {
  const { t } = useI18n();
  const showIdea = !compact && Boolean(onNewIdea);
  const button = (
    <button
      type="button"
      aria-label={t("Outcomes")}
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
      className={cn(
        "electron-no-drag flex items-center rounded-lg text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        // The expanded icon starts at the same x as the search field's magnifier (8px inside a 12px gutter).
        compact ? "mx-auto mb-2 size-12 justify-center" : "h-9 w-full gap-2 pl-2 pr-9",
        active
          ? "bg-selected text-foreground"
          : "text-foreground-secondary hover:bg-hover hover:text-foreground"
      )}
    >
      <Target
        aria-hidden="true"
        className={cn("shrink-0", compact ? "size-[17px]" : "size-[14px]")}
        strokeWidth={1.6}
      />
      {!compact && <span className="text-[13px] font-medium">{t("Outcomes")}</span>}
    </button>
  );
  if (compact)
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{t("Outcomes")}</TooltipContent>
      </Tooltip>
    );
  return (
    <div className="relative mb-2">
      {button}
      {showIdea && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("Capture an idea")}
              onClick={onNewIdea}
              className="electron-no-drag absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[7px] text-foreground-tertiary outline-none transition-colors hover:bg-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground-secondary"
            >
              <Lightbulb aria-hidden="true" className="size-[15px]" strokeWidth={1.6} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("Capture an idea")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
