import type { ActivityItem } from "@outcomego/contracts/task-overview";
import { ChevronRight, Target } from "lucide-react";
import { Fragment, type ReactNode, type RefObject } from "react";
import { useI18n } from "../../../../lib/i18n";
import {
  activityPresentation,
  groupActivityByBot,
  styleForActivity,
  visibleActivity,
  type ActivityGroup,
} from "./activity-state";

/**
 * Unified "In progress" / bot activity view. Cards while the list is short, one table past the owner's limit;
 * grouped by bot with a count of what is working, waiting and blocked. Anything a bot wrote is shown as plain text
 * and labelled as the bot's: React escapes it, and nothing here parses markup or links.
 */
export interface ActivitySectionProps {
  items: readonly ActivityItem[];
  botName: (botId: string) => string;
  /** The owner's limit for cards; past it the area is a table. */
  cardMaxItems: number;
  showAll: boolean;
  onToggleAll: () => void;
  onOpen: (item: ActivityItem) => void;
  /** Whether an item leads anywhere in this window. One that does not is shown as text only. */
  canOpen: (item: ActivityItem) => boolean;
  /** Optional section title key (defaults to "Activity"). */
  title?: string;
  /** Optional subtitle key; pass null to hide. */
  description?: string | null;
  /** Optional empty state message key (defaults to "No bot is working right now."). */
  emptyLabel?: string;
  /** Optional action shown inside the quiet empty row. */
  emptyAction?: ReactNode;
  /** Whether to show the Show all / Show less toggle (defaults to true). */
  showAllToggle?: boolean;
  /** Optional secondary heading action (e.g. "View all >"). */
  viewAllAction?: { label: string; onClick: () => void };
  sectionRef?: RefObject<HTMLElement | null>;
}

function StateBadge({ state }: { state: string }) {
  const { t } = useI18n();
  const style = styleForActivity(state);
  return (
    <span className="outcome-activity-status" data-tone={style.tone} data-animated={style.animated || undefined}>
      <span className="outcome-activity-icon" aria-hidden="true">{style.icon}</span>
      {t(style.label)}
    </span>
  );
}

/** The time line of one item: when it last moved, and when it next starts or is next checked. */
function useTimes() {
  const { t } = useI18n();
  const when = (value: string) => new Date(value).toLocaleString();
  return {
    last: (item: ActivityItem) => `${t("Last activity")}: ${when(item.lastActivityAt)}`,
    next: (item: ActivityItem) =>
      item.nextCheckAt
        ? item.state === "scheduled" || item.state === "deferred"
          ? t("Starts {time}", { time: when(item.nextCheckAt) })
          : `${t("Next check")}: ${when(item.nextCheckAt)}`
        : null,
  };
}

function Facts({ item }: { item: ActivityItem }) {
  const { t } = useI18n();
  const botWritten = item.type !== "routine" && Boolean(item.doing || item.reason);
  return (
    <>
      <span className="outcome-activity-title">{item.title}</span>
      {item.doing && <span className="outcome-activity-doing">{item.doing}</span>}
      {item.reason && item.reason !== item.doing && <span className="outcome-activity-reason">{item.reason}</span>}
      {botWritten && <span className="outcome-activity-by">{t("Written by the bot")}</span>}
      {item.progress && (
        <span className="outcome-activity-progress">
          {t("{done} of {total} parts done", { done: item.progress.done, total: item.progress.total })}
          {item.progress.phase ? ` · ${item.progress.phase}` : ""}
        </span>
      )}
      {item.workerCount ? <span className="outcome-activity-workers">{t("{count} helpers working", { count: item.workerCount })}</span> : null}
    </>
  );
}

function Summary({ group }: { group: ActivityGroup }) {
  const { t } = useI18n();
  const parts = [
    group.summary.working > 0 && t("{working} working", { working: group.summary.working }),
    group.summary.waiting > 0 && t("{waiting} waiting", { waiting: group.summary.waiting }),
    group.summary.blocked > 0 && t("{blocked} blocked", { blocked: group.summary.blocked }),
  ].filter(Boolean);
  return parts.length ? <span className="outcome-activity-summary">{parts.join(" · ")}</span> : null;
}

export function ActivitySection({
  items,
  botName,
  cardMaxItems,
  showAll,
  onToggleAll,
  onOpen,
  canOpen,
  title = "Activity",
  description = "What your bots are doing right now.",
  emptyLabel = "No bot is working right now.",
  emptyAction,
  showAllToggle = true,
  viewAllAction,
  sectionRef,
}: ActivitySectionProps) {
  const { t } = useI18n();
  const times = useTimes();
  const visible = visibleActivity(items);
  const groups = groupActivityByBot(visible, botName);
  const presentation = activityPresentation(visible.length, cardMaxItems);

  return (
    <section ref={sectionRef} aria-label={t(title)} className="outcome-dash-section outcome-activity">
      <div className="outcome-dash-heading">
        <h2>
          {t(title)}
          {visible.length > 0 && <span>{visible.length}</span>}
        </h2>
        {(showAllToggle || viewAllAction) && (
          <div className="outcome-dash-heading-actions">
            {showAllToggle && (
              <button type="button" data-dash="" aria-pressed={showAll} onClick={onToggleAll}>
                {t(showAll ? "Show less" : "Show all")}
              </button>
            )}
            {viewAllAction && (
              <button type="button" data-dash="" onClick={viewAllAction.onClick}>
                {viewAllAction.label}
                <ChevronRight aria-hidden="true" className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>
      {description && <p className="outcome-activity-description">{t(description)}</p>}
      {groups.length === 0 && (
        <div className="outcome-dash-empty" role="status">
          <Target aria-hidden="true" className="size-4" strokeWidth={1.6} />
          {t(emptyLabel)}
          {emptyAction}
        </div>
      )}

      {presentation === "cards" &&
        groups.map((group) => (
          <div key={group.botId} className="outcome-activity-group">
            <h3>
              {group.name}
              <Summary group={group} />
            </h3>
            <ul className="outcome-activity-cards">
              {group.items.map((item) => {
                const body = (
                  <>
                    <StateBadge state={item.state} />
                    <Facts item={item} />
                    <span className="outcome-activity-times">
                      {times.last(item)}
                      {times.next(item) ? ` · ${times.next(item)}` : ""}
                    </span>
                  </>
                );
                return (
                  <li key={item.id}>
                    {canOpen(item) ? (
                      <button type="button" className="outcome-activity-card" onClick={() => onOpen(item)}>
                        {body}
                      </button>
                    ) : (
                      <div className="outcome-activity-card">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

      {presentation === "table" && (
        <table className="outcome-activity-table">
          <thead>
            <tr>
              <th scope="col">{t("Title")}</th>
              <th scope="col">{t("Status")}</th>
              <th scope="col">{t("Last activity")}</th>
              <th scope="col">{t("Next check")}</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.botId}>
              <tr className="outcome-activity-grouprow">
                <th scope="rowgroup" colSpan={4}>
                  {group.name}
                  <Summary group={group} />
                </th>
              </tr>
              {group.items.map((item) => (
                <Fragment key={item.id}>
                  <tr>
                    <td>
                      {canOpen(item) ? (
                        <button type="button" className="outcome-activity-link" onClick={() => onOpen(item)}>
                          <Facts item={item} />
                        </button>
                      ) : (
                        <Facts item={item} />
                      )}
                    </td>
                    <td><StateBadge state={item.state} /></td>
                    <td>{new Date(item.lastActivityAt).toLocaleString()}</td>
                    <td>{item.nextCheckAt ? new Date(item.nextCheckAt).toLocaleString() : "—"}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          ))}
        </table>
      )}
    </section>
  );
}
