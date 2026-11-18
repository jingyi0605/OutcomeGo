import { Target } from "lucide-react";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";

export function OutcomeNavigation({
  active,
  compact = false,
  onOpen,
}: {
  active: boolean;
  compact?: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const button = (
    <button
      type="button"
      aria-label={t("Outcomes")}
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
      className={cn(
        "electron-no-drag flex items-center gap-2.5 rounded-lg text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "mx-auto mb-2 size-12 justify-center" : "mb-2 h-9 w-full px-2.5",
        active
          ? "bg-selected text-foreground"
          : "text-foreground-secondary hover:bg-hover hover:text-foreground"
      )}
    >
      <Target aria-hidden="true" className="size-[17px] shrink-0" strokeWidth={1.6} />
      {!compact && <span className="text-[13px] font-medium">{t("Outcomes")}</span>}
    </button>
  );
  return compact ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{t("Outcomes")}</TooltipContent>
    </Tooltip>
  ) : (
    button
  );
}
