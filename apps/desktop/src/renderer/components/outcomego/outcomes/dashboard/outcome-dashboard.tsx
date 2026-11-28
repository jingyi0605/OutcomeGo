import { useEffect, useRef, useState } from "react";
import {
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Hand,
  X,
  type LucideIcon,
} from "lucide-react";
import { OUTCOME_LIMITS } from "@outcomego/contracts/outcome-state";
import type { OutcomeInboxCategory, OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import type { OutcomeSummary } from "@outcomego/contracts/outcomes";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import type { ActivityItem, NeedsMeItem, OutcomeTodoAttentionItem, OutcomeTodoDigest } from "@outcomego/contracts/task-overview";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { subscribeOutcomeListRefresh } from "../../../../lib/outcome-events";
import { useI18n } from "../../../../lib/i18n";
import { GOAL_OUTCOME_KINDS } from "../../../../lib/outcome-kinds";
import type { InboxClient } from "../inbox/inbox-api";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { OutcomeButton } from "../outcome-ui";
import {
  attentionCategoryLabels,
  attentionRows,
  needsMeQueue,
  attentionVerbs,
  brief,
  DASHBOARD_ROW_LIMIT,
  formatCount,
  STALE_AFTER_MINUTES,
  summarizeOutcomes,
  waitingLabel,
  waitingMinutes,
  type AttentionRow,
} from "./dashboard-state";
import { ActivitySection } from "./activity-section";
import { completedActivityItems, mergeInProgressItems, styleForActivity } from "./activity-state";
import { GoalFocusDetail, type GoalFocusClient } from "./goal-focus";
import { QuickDecision } from "./quick-decision";
import { actOnTodoItem, TodoRow, todoAttentionLabels, updateTodoFollowUp, type TodoActionRequest } from "./todo-panel";
import { isTodoOutcome, todoSchedule, type TodoOutcome } from "./todo-state";

interface Loaded {
  outcomes: OutcomeSummary[];
  steps: OutcomeInboxItemView[];
  moreSteps: boolean;
  /** Null when the area is not wanted or this server has no activity call: the area is then left out. */
  activity: ActivityItem[] | null;
  upcoming: NonNullable<import("@outcomego/contracts/task-overview").ActivityResponse["upcoming"]>;
  /** Requests waiting on the owner. Empty when this server has no such call or it failed: the steps still show. */
  requests: NeedsMeItem[];
  todos: OutcomeTodoAttentionItem[];
  todoDigest: OutcomeTodoDigest | null;
}

// The initial values come from the policy metadata, never from a number written here.
const DEFAULT_POLICY = resolveTaskPolicy({});

const categoryIcons: Record<OutcomeInboxCategory, LucideIcon> = {
  decision_pending: CircleHelp,
  acceptance_pending: ClipboardCheck,
  human_action_pending: Hand,
  completed: CheckCheck,
};

function TodoDigestCard({ digest }: { digest: OutcomeTodoDigest }) {
  const { t } = useI18n();
  return (
    <aside aria-label={t("To-do morning summary")} className="outcome-dash-focus">
      <h3 className="outcome-dash-focus-title">{t("To-do morning summary")}</h3>
      <dl className="flex flex-wrap gap-3 text-xs">
        {Object.entries(todoAttentionLabels).map(([key, label]) => (
          <div key={key}>
            <dt>{t(label)}</dt>
            <dd>{digest.counts[key as keyof OutcomeTodoDigest["counts"]]}</dd>
          </div>
        ))}
      </dl>
      {digest.titles.length > 0 && <div className="text-xs">
        <p className="text-foreground-secondary">{t("Some titles may be written by bots.")}</p>
        <ul className="list-disc ps-4">
          {digest.titles.map((title, index) => <li key={index}>{title}</li>)}
        </ul>
      </div>}
    </aside>
  );
}

/** One compact clickable status pill; the "needs you" pill takes a warm tone when items wait. */
function Metric({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "attention";
  onClick: () => void;
}) {
  return (
    <button type="button" className="outcome-dash-metric" data-tone={tone} onClick={onClick}>
      <span className="outcome-dash-metric-value">{value}</span>
      <span className="outcome-dash-metric-label">{label}</span>
    </button>
  );
}

function SectionHeading({
  title,
  count,
  action,
}: {
  title: string;
  count?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="outcome-dash-heading">
      <h2>
        {title}
        {count && <span>{count}</span>}
      </h2>
      {action && (
        <button type="button" data-dash="" onClick={action.onClick}>
          {action.label}
          <ChevronRight aria-hidden="true" className="size-3" />
        </button>
      )}
    </div>
  );
}

function Waiting({ since }: { since: string }) {
  const { t } = useI18n();
  const minutes = waitingMinutes(since);
  const label = waitingLabel(minutes);
  const time = "count" in label ? t(label.key, { count: label.count }) : t(label.key);
  return (
    <span className="outcome-dash-wait" data-stale={minutes >= STALE_AFTER_MINUTES || undefined}>
      {"count" in label ? t("Waiting {time}", { time }) : time}
    </span>
  );
}

/** A request that waits on the owner. Its reason is bot-written, shown as plain text and labelled as such. */
function RequestRow({
  item,
  botName,
  canOpen,
  onOpen,
  onRemove,
  removing,
}: {
  item: NeedsMeItem;
  botName: string;
  canOpen: boolean;
  onOpen: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const { t } = useI18n();
  const style = styleForActivity(item.state);
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="outcome-row-title">{item.title || t("Request")}</span>
        <span className="outcome-row-meta">
          <span className="outcome-dash-tag" data-zone={item.zone}>
            <span aria-hidden="true">{style.icon}</span> {t(style.label)}
          </span>
          {` · ${botName}`}
          {item.reason ? ` · ${brief(item.reason)}` : ""}
          {item.reason ? ` (${t("Written by the bot")})` : ""}
        </span>
      </span>
      <Waiting since={item.since} />
      {canOpen && (
        <span className="outcome-dash-act">
          {t("Open conversation")}
          <ChevronRight aria-hidden="true" className="size-3" />
        </span>
      )}
    </>
  );
  return (
    <li data-needs-me-request={item.key} data-zone={item.zone} className={onRemove ? "outcome-dash-request-item" : undefined}>
      {canOpen ? (
        <button type="button" className="outcome-row outcome-dash-step" onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div className="outcome-row outcome-dash-step">{body}</div>
      )}
      {onRemove && (
        <button
          type="button"
          className="outcome-dash-remove"
          data-request-remove={item.key}
          disabled={removing}
          aria-label={t("Stop and remove this record")}
          title={t("Stop and remove this record")}
          onClick={onRemove}
        >
          <X aria-hidden="true" className="size-3" />
          <span>{t("Remove")}</span>
        </button>
      )}
    </li>
  );
}

function CategoryTag({ category }: { category: OutcomeInboxCategory }) {
  const { t } = useI18n();
  const Icon = categoryIcons[category];
  return (
    <span className="outcome-dash-tag">
      <Icon aria-hidden="true" className="size-3" strokeWidth={1.8} />
      {t(attentionCategoryLabels[category])}
    </span>
  );
}

/** The one thing to do first, with the facts needed to do it and, for decisions, the answer buttons. */
function FocusStep({
  row,
  inbox,
  outcomes,
  onOpen,
  onResolved,
}: {
  row: AttentionRow;
  inbox: Pick<InboxClient, "decision" | "resolve">;
  outcomes: GoalFocusClient;
  onOpen: () => void;
  onResolved: () => void;
}) {
  const { t } = useI18n();
  // Two lines at most: what to do, then what is in the way. Everything else lives in the details.
  const lines = [
    { text: row.next || row.completed, tone: undefined },
    { text: row.problem, tone: "problem" },
  ].filter((line) => line.text.trim());
  const facts = lines.length > 0 && (
    <div className="outcome-dash-facts">
      {lines.map((line) => (
        <p key={line.tone ?? "next"} data-tone={line.tone} title={line.text}>
          {brief(line.text)}
        </p>
      ))}
    </div>
  );
  const decision = Boolean(row.step?.decisionId && row.category === "decision_pending");
  return (
    <article className="outcome-dash-focus" data-category={row.category}>
      <div className="outcome-dash-focus-meta">
        <span className="outcome-dash-eyebrow">{t("Do this first")}</span>
        <CategoryTag category={row.category} />
        <Waiting since={row.since} />
      </div>
      <h3 className="outcome-dash-focus-title">{row.title}</h3>
      {decision ? (
        <>
          {facts}
          <div className="outcome-dash-focus-actions">
            <QuickDecision decisionId={row.step!.decisionId!} client={inbox} onResolved={onResolved} />
            <OutcomeButton variant="ghost" className="outcome-dash-details" onClick={onOpen}>
              {t("View details")}
              <ChevronRight aria-hidden="true" className="size-3.5" />
            </OutcomeButton>
          </div>
        </>
      ) : (
        <GoalFocusDetail row={row} outcomes={outcomes} fallback={facts} onOpen={onOpen} onResolved={onResolved} />
      )}
    </article>
  );
}

/**
 * First screen of the goals page. Top: compact clickable status strip + minimal actions.
 * First focus: what needs the owner's action right now.
 * Second focus: unified "In progress" work (bot activity + active/paused/failed goals, deduplicated).
 * On demand: upcoming scheduled work when present.
 */
export function OutcomeDashboard({
  outcomes,
  inbox,
  bots,
  onSelectOutcome,
  onSelectStep,
  onShowSteps,
  onShowGoals,
  onOpenChannel,
  onOpenRoutine,
  activityPolicy,
  refreshVersion = 0,
  onBusyChange,
}: {
  outcomes: Pick<OutcomeClient, "list" | "activity" | "stopRequest" | "needsMe" | "act" | "update" | "convert"> & GoalFocusClient;
  inbox: Pick<InboxClient, "list" | "decision" | "resolve">;
  bots: readonly OutcomeExecutionBot[];
  onSelectOutcome: (id: string) => void;
  onSelectStep: (item: OutcomeInboxItemView) => void;
  onShowSteps: () => void;
  onShowGoals: () => void;
  onCreateGoal?: () => void;
  onCreateIdea?: () => void;
  /** Opens a channel's conversation: where a request or a channel routine leads. Without it those rows are text only. */
  onOpenChannel?: (channelId: string) => void;
  onOpenRoutine?: (routineId: string, botId: string) => void;
  /** The owner's choices for the activity area; each falls back to the policy's initial value. */
  activityPolicy?: { cardMaxItems?: number | undefined };
  refreshVersion?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const cardMaxItems = activityPolicy?.cardMaxItems ?? (DEFAULT_POLICY["activity.cardMaxItems"] as number);
  const [showAll, setShowAll] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [allQueue, setAllQueue] = useState(false);
  const [todoActing, setTodoActing] = useState(false);
  const [todoError, setTodoError] = useState(false);
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [removeError, setRemoveError] = useState(false);
  const inProgressRef = useRef<HTMLElement>(null);
  const generation = useRef(0);
  async function load() {
    const request = ++generation.current;
    setBusy(true);
    setError(false);
    try {
      const [goals, steps, activity, needsMe] = await Promise.all([
        outcomes.list(new URLSearchParams({ kinds: GOAL_OUTCOME_KINDS.join(","), limit: String(OUTCOME_LIMITS.listPageSizeMax) }).toString()),
        // An older server without the Inbox still gets a working dashboard, just without steps.
        inbox.list({ status: "pending" }).catch(() => ({ items: [], nextCursor: null })),
        // A server without the activity endpoint, or one that fails, simply leaves bot activity out; goals still show.
        outcomes.activity
          ? outcomes.activity({ includeAll: showAll }).catch(() => null)
          : Promise.resolve(null),
        // Requests nobody can move join the owner's list. An older server just has none.
        outcomes.needsMe?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      if (generation.current !== request) return;
      setData({ outcomes: goals.items, steps: steps.items, moreSteps: steps.nextCursor !== null,
        activity: activity?.items ?? null, upcoming: activity?.upcoming ?? [],
        requests: needsMe?.items ?? [], todos: needsMe?.todos ?? [], todoDigest: needsMe?.todoDigest ?? null });
    } catch {
      if (generation.current === request) setError(true);
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 30_000);
    const unsubscribe = subscribeOutcomeListRefresh(refresh);
    return () => {
      generation.current++;
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [outcomes, inbox, showAll]);
  useEffect(() => {
    if (refreshVersion > 0) void load();
  }, [refreshVersion]);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const goals = data?.outcomes ?? [];
  const stats = summarizeOutcomes(goals);
  const attention = attentionRows(data?.steps ?? [], goals);
  const entries = needsMeQueue(attention, data?.requests ?? [], data?.todos);
  const first = entries[0];
  const focus = first?.kind === "step" ? first.row : undefined;
  const queue = focus ? entries.slice(1) : entries;
  const rowLimit = DASHBOARD_ROW_LIMIT - 1;
  const visibleQueue = allQueue ? queue : queue.slice(0, rowLimit);
  const inProgressItems = mergeInProgressItems(data?.activity, goals, attention);
  const completedItems = completedActivityItems(data?.activity);
  const toggleShowAll = () => {
    const next = !showAll;
    setShowAll(next);
    setCompletedExpanded(next);
  };
  const attentionCount = data ? `${formatCount(entries.length)}${data.moreSteps ? "+" : ""}` : "–";
  const value = (count: number) => (data ? formatCount(count) : "–");
  const open = (row: AttentionRow) => (row.step ? onSelectStep(row.step) : onSelectOutcome(row.outcomeId));
  async function mutateTodo(write: () => Promise<OutcomeDetail>) {
    if (todoActing) return false;
    setTodoActing(true);
    setTodoError(false);
    try {
      const updated = await write();
      if (!isTodoOutcome(updated) || updated.status === "accepted" || updated.status === "cancelled" || todoSchedule(updated).displayState === "snoozed") {
        setData((current) => current && { ...current, todos: current.todos.filter((entry) => entry.outcome.id !== updated.id) });
      }
      void load();
      return true;
    } catch {
      setTodoError(true);
      void load();
      return false;
    } finally {
      setTodoActing(false);
    }
  }
  const actOnTodo = (item: TodoOutcome, request: TodoActionRequest) => mutateTodo(() => actOnTodoItem(outcomes, item, request));
  const todoHandoff = { bots, client: outcomes, change: mutateTodo, onSelectOutcome };
  async function removeRequest(itemKey: string) {
    if (!outcomes.stopRequest || !itemKey.startsWith("request:") || removingIds.has(itemKey)) return;
    const runId = itemKey.slice("request:".length);
    if (!runId) return;
    setRemoveError(false);
    setRemovingIds((previous) => new Set(previous).add(itemKey));
    try {
      await outcomes.stopRequest(runId);
      setData((current) =>
        current && {
          ...current,
          requests: current.requests.filter((entry) => entry.key !== itemKey),
          activity: current.activity ? current.activity.filter((entry) => entry.id !== itemKey) : null,
        }
      );
      void load();
    } catch {
      setRemoveError(true);
      void load();
    } finally {
      setRemovingIds((previous) => {
        const next = new Set(previous);
        next.delete(itemKey);
        return next;
      });
    }
  }
  const canOpenActivity = (item: ActivityItem) =>
    item.link.type === "outcome" || (item.link.type === "channel" && onOpenChannel !== undefined) ||
      (item.link.type === "routine" && onOpenRoutine !== undefined);
  const openActivity = (item: ActivityItem) => {
    if (item.link.type === "outcome") onSelectOutcome(item.link.id);
    else if (item.link.type === "channel") onOpenChannel?.(item.link.id);
    else if (item.link.type === "routine") onOpenRoutine?.(item.link.id, item.botId);
  };
  const jumpToInProgress = () => {
    if (inProgressItems.length > 0 && inProgressRef.current?.scrollIntoView) {
      inProgressRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      onShowGoals();
    }
  };
  return (
    <section aria-label={t("Dashboard")} aria-busy={busy} className="outcome-dash">
      <div className="outcome-dash-topbar">
        <div className="outcome-dash-metrics" role="group" aria-label={t("Overview summary")}>
          <Metric
            label={t("Needs your action")}
            value={attentionCount}
            tone={entries.length > 0 ? "attention" : undefined}
            onClick={onShowSteps}
          />
          <Metric
            label={t("In progress")}
            value={value(inProgressItems.length)}
            onClick={jumpToInProgress}
          />
          <Metric
            label={t("Accepted")}
            value={value(stats.accepted)}
            onClick={onShowGoals}
          />
          <Metric
            label={t("All goals")}
            value={value(stats.total)}
            onClick={onShowGoals}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {t("Could not load goals. Try again.")}{" "}
          <OutcomeButton variant="ghost" onClick={() => void load()}>
            {t("Retry")}
          </OutcomeButton>
        </p>
      )}

      <section aria-label={t("Needs your action")} className="outcome-dash-section">
        <SectionHeading
          title={t("Needs your action")}
          count={entries.length > 0 ? attentionCount : undefined}
          action={
            !allQueue && queue.length > rowLimit && entries.some((entry) => entry.kind === "todo")
              ? { label: t("View all"), onClick: () => setAllQueue(true) }
              : (!allQueue && queue.length > rowLimit) || data?.moreSteps
              ? { label: t("View all"), onClick: onShowSteps }
              : undefined
          }
        />
        {data?.todoDigest && <TodoDigestCard digest={data.todoDigest} />}
        {todoError && <p role="alert" className="text-xs text-destructive">{t("Could not update the to-do. Try again.")}</p>}
        {removeError && <p role="alert" className="text-xs text-destructive">{t("Could not remove the record. Try again.")}</p>}
        {data && entries.length === 0 && (
          <p className="outcome-dash-empty" role="status">
            <CheckCheck aria-hidden="true" className="size-4" strokeWidth={1.6} />
            {t("You're all caught up.")}
          </p>
        )}
        {focus && (
          <FocusStep
            // A new step is a new card: its decision, selection and request IDs never carry over.
            key={focus.key}
            row={focus}
            inbox={inbox}
            outcomes={outcomes}
            onOpen={() => open(focus)}
            onResolved={() => void load()}
          />
        )}
        {queue.length > 0 && (
          <ul className="outcome-rows outcome-dash-queue">
            {visibleQueue.map((entry) =>
              entry.kind === "request" ? (
                <RequestRow
                  key={entry.key}
                  item={entry.item}
                  botName={bots.find((bot) => bot.id === entry.item.botId)?.name ?? t("Bot")}
                  canOpen={entry.item.link.type === "channel" && onOpenChannel !== undefined}
                  onOpen={() => onOpenChannel?.(entry.item.link.id)}
                  onRemove={outcomes.stopRequest ? () => void removeRequest(entry.item.key) : undefined}
                  removing={removingIds.has(entry.item.key)}
                />
              ) : entry.kind === "todo" ? (
                isTodoOutcome(entry.item.outcome) && <TodoRow key={entry.key} item={entry.item.outcome} attention={entry.item.attention}
                  disabled={todoActing} act={actOnTodo} handoff={todoHandoff}
                  update={(item, followUpAt) => mutateTodo(() => updateTodoFollowUp(outcomes, item, followUpAt))} />
              ) : (
                <li key={entry.key}>
                  <button
                    className="outcome-row outcome-dash-step"
                    data-category={entry.row.category}
                    onClick={() => open(entry.row)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="outcome-row-title">{entry.row.title}</span>
                      <span className="outcome-row-meta">
                        <CategoryTag category={entry.row.category} />
                        {entry.row.next ? ` · ${brief(entry.row.next)}` : ""}
                      </span>
                    </span>
                    <Waiting since={entry.row.since} />
                    <span className="outcome-dash-act">
                      {t(attentionVerbs[entry.row.category])}
                      <ChevronRight aria-hidden="true" className="size-3" />
                    </span>
                  </button>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      <ActivitySection
        sectionRef={inProgressRef}
        title="In progress"
        description={null}
        emptyLabel="No goals in progress."
        items={inProgressItems}
        botName={(botId) => bots.find((bot) => bot.id === botId)?.name ?? t("Bot")}
        cardMaxItems={cardMaxItems}
        showAll={showAll}
        showAllToggle={data?.activity != null}
        onToggleAll={toggleShowAll}
        viewAllAction={stats.total > 0 ? { label: t("View all"), onClick: onShowGoals } : undefined}
        onOpen={openActivity}
        canOpen={canOpenActivity}
        onRemove={outcomes.stopRequest ? (item) => void removeRequest(item.id) : undefined}
        canRemove={(item) => item.type === "request" && Boolean(outcomes.stopRequest)}
        removingIds={removingIds}
      />

      {!!data?.upcoming.length && (
        <section aria-label={t("Upcoming work")} className="outcome-dash-section">
          <SectionHeading title={t("Upcoming work")} count={String(data.upcoming.length)} />
          <ul className="outcome-rows">
            {data.upcoming.map((item) => (
              <li key={item.id}>
                <button type="button" className="outcome-row" onClick={() => onSelectOutcome(item.link.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="outcome-row-title">{item.title}</span>
                    <span className="outcome-row-meta">{bots.find((bot) => bot.id === item.botId)?.name ?? t("Bot")} · <time dateTime={item.runAt}>{new Date(item.runAt).toLocaleString()}</time> · {t(styleForActivity(item.state).label)}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {completedItems.length > 0 && (
        <ActivitySection
          title="Recently completed"
          description={null}
          items={completedItems}
          botName={(botId) => bots.find((bot) => bot.id === botId)?.name ?? t("Bot")}
          cardMaxItems={cardMaxItems}
          showAll={false}
          showAllToggle={false}
          onToggleAll={() => undefined}
          collapsed={!completedExpanded}
          onToggleCollapsed={() => setCompletedExpanded((previous) => !previous)}
          onOpen={openActivity}
          canOpen={canOpenActivity}
          onRemove={outcomes.stopRequest ? (item) => void removeRequest(item.id) : undefined}
          canRemove={(item) => item.type === "request" && Boolean(outcomes.stopRequest)}
          removingIds={removingIds}
        />
      )}
    </section>
  );
}
