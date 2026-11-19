import { Lightbulb, Target } from "lucide-react";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import type { OutcomeActionCounts } from "../../../hooks/use-outcome-action-counts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";

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
  onNewIdea,
  badges = NO_BADGES,
}: {
  active: boolean;
  compact?: boolean;
  onOpen: () => void;
  /** Goals waiting for the owner's approval or acceptance, shown as colored count badges. */
  badges?: OutcomeActionCounts;
  /** Expanded sidebar only: shows a quick-capture lightbulb at the right end of the row. */
  onNewIdea?: () => void;
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
        "electron-no-drag relative flex items-center rounded-lg text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
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
      <OutcomeBadges counts={badges} compact={compact} />
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
