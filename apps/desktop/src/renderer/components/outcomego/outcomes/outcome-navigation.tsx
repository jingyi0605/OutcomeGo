import { CalendarDays, Lightbulb, Target } from "lucide-react";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import type { OutcomeActionCounts } from "../../../hooks/use-outcome-action-counts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";

/** Shared by both row buttons so background, hover and focus behave identically. */
const rowButtonClass = (active: boolean) =>
  cn(
    "electron-no-drag rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-selected text-foreground"
      : "text-foreground-secondary hover:bg-hover hover:text-foreground"
  );

const NO_BADGES: OutcomeActionCounts = { approval: 0, review: 0 };
const badgeLabel = (count: number) => (count > 99 ? "99+" : String(count));

/** One colored count per status that needs the owner; zero counts are not rendered. */
function OutcomeBadges({
  counts,
  compact,
}: {
  counts: OutcomeActionCounts;
  compact: boolean;
}) {
  const { t } = useI18n();
  const entries = [
    { key: "approval", count: counts.approval, label: t("Pending action"), tone: "bg-amber-500" },
    { key: "review", count: counts.review, label: t("Awaiting review"), tone: "bg-blue-500" },
  ].filter((entry) => entry.count > 0);
  if (entries.length === 0) return null;
  return (
    <span
      className={cn(
        "pointer-events-none flex shrink-0 items-center",
        compact ? "absolute right-1 top-1 flex-col items-end gap-0.5" : "ml-auto gap-1"
      )}
    >
      {entries.map((entry) => (
        <span
          key={entry.key}
          data-outcome-badge={entry.key}
          title={`${entry.label}: ${entry.count}`}
          className={cn(
            "inline-flex min-w-4 items-center justify-center rounded-full px-1 font-semibold leading-none tabular-nums text-white",
            compact ? "h-[14px] text-[9px]" : "h-4 text-[10px]",
            entry.tone
          )}
        >
          {badgeLabel(entry.count)}
        </span>
      ))}
    </span>
  );
}

export function OutcomeNavigation({
  active,
  compact = false,
  onOpen,
  onOpenCalendar,
  onNewIdea,
  ideaActive = false,
  badges = NO_BADGES,
}: {
  active: boolean;
  compact?: boolean;
  onOpen: () => void;
  onOpenCalendar?: () => void;
  /** Goals waiting for the owner's approval or acceptance, shown as colored count badges. */
  badges?: OutcomeActionCounts;
  /** Expanded sidebar only: shows a square quick-capture button beside the Outcomes entry. */
  onNewIdea?: () => void;
  /** True while the quick-capture window is open, so its button shows the same selected state as the entry. */
  ideaActive?: boolean;
}) {
  const { t } = useI18n();
  const showIdea = !compact && Boolean(onNewIdea);
  const label = [
    t("Outcomes"),
    badges.approval > 0 ? `${t("Pending action")}: ${badges.approval}` : "",
    badges.review > 0 ? `${t("Awaiting review")}: ${badges.review}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onOpen}
      className={cn(
        rowButtonClass(active),
        "relative flex items-center text-left",
        // The expanded icon starts at the same x as the search field's magnifier (8px inside a 12px gutter).
        compact ? "mx-auto mb-2 size-12 justify-center" : "h-9 min-w-0 flex-1 gap-2 px-2"
      )}
    >
      <Target
        aria-hidden="true"
        className={cn("shrink-0", compact ? "size-[17px]" : "size-[14px]")}
        strokeWidth={1.6}
      />
      {!compact && <span className="text-[13px] font-medium">{t("Outcomes")}</span>}
      <OutcomeBadges counts={badges} compact={compact} />
    </button>
  );
  if (compact)
    return (
      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{t("Outcomes")}</TooltipContent>
        </Tooltip>
        {onOpenCalendar && <Tooltip><TooltipTrigger asChild><button type="button" aria-label={t("Calendar")} onClick={onOpenCalendar} className={cn(rowButtonClass(false), "mx-auto grid size-12 place-items-center")}><CalendarDays aria-hidden="true" className="size-[17px]" strokeWidth={1.6} /></button></TooltipTrigger><TooltipContent side="right">{t("Calendar")}</TooltipContent></Tooltip>}
      </div>
    );
  return (
    <div className="mb-2 flex items-center gap-1">
      {button}
      {onOpenCalendar && <Tooltip><TooltipTrigger asChild><button type="button" aria-label={t("Calendar")} onClick={onOpenCalendar} className={cn(rowButtonClass(false), "grid size-9 shrink-0 place-items-center")}><CalendarDays aria-hidden="true" className="size-[14px]" strokeWidth={1.6} /></button></TooltipTrigger><TooltipContent side="bottom">{t("Calendar")}</TooltipContent></Tooltip>}
      {showIdea && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("Go")}
              aria-pressed={ideaActive}
              onClick={onNewIdea}
              className={cn(rowButtonClass(ideaActive), "grid size-9 shrink-0 place-items-center")}
            >
              <Lightbulb aria-hidden="true" className="size-[14px]" strokeWidth={1.6} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("Go")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
