import { ArrowUpRight, CalendarDays } from "lucide-react";
import appIcon from "../../../assets/outcomego-icon.png?url";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import type { OutcomeActionCounts } from "../../../hooks/use-outcome-action-counts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";

/** Shared by row buttons so background, hover and focus behave identically. */
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
        compact
          ? "absolute right-0 top-1 flex-col items-end gap-0.5"
          : "gap-1 @max-[230px]:flex-col @max-[230px]:items-end @max-[230px]:gap-0.5"
      )}
    >
      {entries.map((entry) => (
        <span
          key={entry.key}
          data-outcome-badge={entry.key}
          title={`${entry.label}: ${entry.count}`}
          className={cn(
            "inline-flex min-w-4 items-center justify-center rounded-full px-1 font-semibold leading-none tabular-nums text-white",
            compact ? "h-3.5 text-[9px]" : "h-4 text-[10px] @max-[230px]:h-3.5 @max-[230px]:text-[9px]",
            entry.tone
          )}
        >
          {badgeLabel(entry.count)}
        </span>
      ))}
    </span>
  );
}

/** Corner count badge for today's unfinished goals + to-dos on the calendar button. */
function CalendarTodayBadge({
  count,
  compact,
}: {
  count: number;
  compact: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      data-calendar-badge="today"
      className={cn(
        "pointer-events-none absolute inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-semibold leading-none tabular-nums text-background shadow-[0_0_0_1.5px_var(--sidebar)]",
        compact ? "right-1.5 top-1.5" : "right-0.5 top-[3px]"
      )}
    >
      {badgeLabel(count)}
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
  calendarTodayCount = 0,
}: {
  active: boolean;
  compact?: boolean;
  onOpen: () => void;
  onOpenCalendar?: () => void;
  /** Goals waiting for the owner's approval or acceptance, shown as colored count badges. */
  badges?: OutcomeActionCounts;
  /** Today's unfinished goals and to-dos count shown as a corner badge on the calendar button. */
  calendarTodayCount?: number;
  /** Expanded sidebar only: shows the artistic "Go" quick-capture button beside "Outcome". */
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
  const calendarLabel =
    calendarTodayCount > 0
      ? `${t("Calendar")}, ${t("Today's goals & to-dos")}: ${calendarTodayCount}`
      : t("Calendar");
  const calendarTooltip =
    calendarTodayCount > 0
      ? `${t("Calendar")} · ${t("Today's goals & to-dos")}: ${calendarTodayCount}`
      : t("Calendar");

  const outcomeButton = (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-guide-target="outcome"
      onClick={onOpen}
      className={cn(
        rowButtonClass(active),
        "relative inline-flex items-center text-left transition-[background-color,transform] duration-150 active:scale-[0.98]",
        compact
          ? "mx-auto mb-2 size-12 justify-center"
          : "h-9 shrink-0 gap-1.5 pl-2 pr-0.5 @max-[230px]:gap-1 @max-[230px]:pl-1"
      )}
    >
      <img
        src={appIcon}
        alt=""
        className={cn(
          "size-[21px] shrink-0 rounded-md shadow-sm",
          compact && (badges.approval > 0 || badges.review > 0) && "-translate-x-2"
        )}
      />
      {!compact && <span className="outcome-brand-wordmark text-[16.5px]">Outcome</span>}
      <OutcomeBadges counts={badges} compact={compact} />
    </button>
  );

  if (compact)
    return (
      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>{outcomeButton}</TooltipTrigger>
          <TooltipContent side="right">{t("Outcomes")}</TooltipContent>
        </Tooltip>
        {onOpenCalendar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={calendarLabel}
                onClick={onOpenCalendar}
                className={cn(rowButtonClass(false), "relative mx-auto grid size-12 place-items-center")}
              >
                <CalendarDays aria-hidden="true" className="size-[17px]" strokeWidth={1.6} />
                <CalendarTodayBadge count={calendarTodayCount} compact />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{calendarTooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
    );

  return (
    <div className="@container mb-2 flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>{outcomeButton}</TooltipTrigger>
        <TooltipContent side="bottom">{t("Outcomes")}</TooltipContent>
      </Tooltip>
      {showIdea && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("Go")}
              aria-pressed={ideaActive}
              data-guide-target="go"
              onClick={onNewIdea}
              className={cn(
                rowButtonClass(ideaActive),
                "outcome-brand-go-button inline-flex h-9 min-w-9 shrink-0 items-center gap-px pl-0.5 pr-1.5 @max-[230px]:pr-0.5"
              )}
            >
              <span className="outcome-brand-wordmark outcome-brand-go-text text-[18px]">Go</span>
              <ArrowUpRight
                aria-hidden="true"
                className="size-2.5 -translate-y-[3px] shrink-0"
                strokeWidth={2}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("Go")}</TooltipContent>
        </Tooltip>
      )}
      {onOpenCalendar && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={calendarLabel}
              onClick={onOpenCalendar}
              className={cn(
                rowButtonClass(false),
                "relative ml-auto grid size-9 shrink-0 place-items-center"
              )}
            >
              <CalendarDays aria-hidden="true" className="size-[15px]" strokeWidth={1.6} />
              <CalendarTodayBadge count={calendarTodayCount} compact={false} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{calendarTooltip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
