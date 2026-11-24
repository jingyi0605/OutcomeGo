import type { ActivityItem } from "@outcomego/contracts/task-overview";
import { Fragment } from "react";
import { useI18n } from "../../../../lib/i18n";
import {
  activityPresentation,
  groupActivityByBot,
  styleForActivity,
  visibleActivity,
  type ActivityGroup,
} from "./activity-state";

/**
 * What every bot is doing right now (specs/004.10 design §3.3), beside the two goal lanes. Cards while the list is
 * short, one table past the owner's limit; grouped by bot with a count of what is working, waiting and blocked. Anything
 * a bot wrote is shown as plain text and labelled as the bot's: React escapes it, and nothing here parses markup or links.
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

export function ActivitySection({ items, botName, cardMaxItems, showAll, onToggleAll, onOpen, canOpen }: ActivitySectionProps) {
  const { t } = useI18n();
  const times = useTimes();
  const visible = visibleActivity(items);
  const groups = groupActivityByBot(visible, botName);
  const presentation = activityPresentation(visible.length, cardMaxItems);

  return (
    <section aria-label={t("Activity")} className="outcome-dash-section outcome-activity">
      <div className="outcome-dash-heading">
        <h2>
          {t("Activity")}
          {visible.length > 0 && <span>{visible.length}</span>}
        </h2>
        <button type="button" data-dash="" aria-pressed={showAll} onClick={onToggleAll}>
          {t(showAll ? "Show less" : "Show all")}
        </button>
      </div>
      <p className="outcome-activity-description">{t("What your bots are doing right now.")}</p>
      {groups.length === 0 && <p className="outcome-dash-lane-empty">{t("No bot is working right now.")}</p>}

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
