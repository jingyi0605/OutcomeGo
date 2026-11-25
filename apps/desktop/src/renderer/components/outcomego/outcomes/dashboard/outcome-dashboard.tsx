import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Hand,
  Lightbulb,
  Plus,
  Target,
  type LucideIcon,
} from "lucide-react";
import { OUTCOME_LIMITS } from "@outcomego/contracts/outcome-view";
import type { OutcomeInboxCategory, OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import type { OutcomeSummary } from "@outcomego/contracts/outcomes";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import type { ActivityItem, NeedsMeItem } from "@outcomego/contracts/task-overview";
import type { TodoAction, TodoActionInput, TodoAttentionItem, TodoDigest, TodoItemView } from "@outcomego/contracts/todo";
import type { OutcomeClient } from "../../../../client/outcome-api";
import { subscribeOutcomeListRefresh } from "../../../../lib/outcome-events";
import { useI18n } from "../../../../lib/i18n";
import type { InboxClient } from "../inbox/inbox-api";
import { outcomeStatusLabels } from "../outcome-list";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { OutcomeButton, OutcomeRefresh } from "../outcome-ui";
import {
  attentionCategoryLabels,
  attentionRows,
  needsMeQueue,
  attentionVerbs,
  BOT_OUTCOME_STATUSES,
  brief,
  DASHBOARD_ROW_LIMIT,
  formatCount,
  laneOutcomes,
  STALE_AFTER_MINUTES,
  STUCK_OUTCOME_STATUSES,
  summarizeOutcomes,
  waitingLabel,
  waitingMinutes,
  type AttentionRow,
} from "./dashboard-state";
import { ActivitySection } from "./activity-section";
import { dashboardSections, styleForActivity } from "./activity-state";
import { GoalFocusDetail, type GoalFocusClient } from "./goal-focus";
import { QuickDecision } from "./quick-decision";
import { TodoPanel, TodoRow, todoAttentionLabels } from "./todo-panel";

interface Loaded {
  outcomes: OutcomeSummary[];
  steps: OutcomeInboxItemView[];
  moreSteps: boolean;
  /** Null when the area is not wanted or this server has no activity call: the area is then left out. */
  activity: ActivityItem[] | null;
  /** Requests waiting on the owner. Empty when this server has no such call or it failed: the steps still show. */
  requests: NeedsMeItem[];
  todos: TodoAttentionItem[];
  todoDigest: TodoDigest | null;
}

// The initial values come from the policy metadata, never from a number written here.
const DEFAULT_POLICY = resolveTaskPolicy({});

const categoryIcons: Record<OutcomeInboxCategory, LucideIcon> = {
  decision_pending: CircleHelp,
  acceptance_pending: ClipboardCheck,
  human_action_pending: Hand,
  completed: CheckCheck,
};

function TodoDigestCard({ digest }: { digest: TodoDigest }) {
  const { t } = useI18n();
  return (
    <aside aria-label={t("To-do morning summary")} className="outcome-dash-focus">
      <h3 className="outcome-dash-focus-title">{t("To-do morning summary")}</h3>
      <dl className="flex flex-wrap gap-3 text-xs">
        {Object.entries(todoAttentionLabels).map(([key, label]) => (
          <div key={key}>
            <dt>{t(label)}</dt>
            <dd>{digest.counts[key as keyof TodoDigest["counts"]]}</dd>
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

/** One quiet number with a label; the "needs you" card is the only one that takes a color. */
function Metric({ label, value, tone }: { label: string; value: string; tone?: "attention" }) {
  return (
    <div className="outcome-dash-metric" data-tone={tone}>
      <span className="outcome-dash-metric-value">{value}</span>
      <span className="outcome-dash-metric-label">{label}</span>
    </div>
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
function RequestRow({ item, botName, canOpen, onOpen }: { item: NeedsMeItem; botName: string; canOpen: boolean; onOpen: () => void }) {
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
    <li data-needs-me-request={item.key} data-zone={item.zone}>
      {canOpen ? (
        <button className="outcome-row outcome-dash-step" onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div className="outcome-row outcome-dash-step">{body}</div>
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

function Lane({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="outcome-dash-lane">
      <h3>
        {title}
        <span>{count}</span>
      </h3>
      {children}
    </div>
  );
}

/**
 * First screen of the goals page. Top: how things stand. Middle: whose turn it is — the owner's list first,
 * led by one focus card that can answer a decision in place. Bottom: what the Bots are doing and what is
 * paused or failed. Each goal shows once; the other tabs hold the complete lists.
 */
export function OutcomeDashboard({
  outcomes,
  inbox,
  bots,
  onSelectOutcome,
  onSelectStep,
  onShowSteps,
  onShowGoals,
  onCreateGoal,
  onCreateIdea,
  onOpenChannel,
  activityPolicy,
  refreshVersion = 0,
}: {
  outcomes: Pick<OutcomeClient, "list" | "activity" | "needsMe" | "todos" | "createThread"> & GoalFocusClient;
  inbox: Pick<InboxClient, "list" | "decision" | "resolve">;
  bots: readonly OutcomeExecutionBot[];
  onSelectOutcome: (id: string) => void;
  onSelectStep: (item: OutcomeInboxItemView) => void;
  onShowSteps: () => void;
  onShowGoals: () => void;
  onCreateGoal: () => void;
  onCreateIdea: () => void;
  /** Opens a channel's conversation: where a request or a channel routine leads. Without it those rows are text only. */
  onOpenChannel?: (channelId: string) => void;
  /** The owner's choices for the activity area; each falls back to the policy's initial value. */
  activityPolicy?: { cardMaxItems?: number | undefined; dashboardLayout?: string | undefined };
  refreshVersion?: number;
}) {
  const { t } = useI18n();
  const layout = dashboardSections(activityPolicy?.dashboardLayout ?? DEFAULT_POLICY["activity.dashboardLayout"]);
  const cardMaxItems = activityPolicy?.cardMaxItems ?? (DEFAULT_POLICY["activity.cardMaxItems"] as number);
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [allQueue, setAllQueue] = useState(false);
  const [todoActing, setTodoActing] = useState(false);
  const [todoError, setTodoError] = useState(false);
  const [todoRefreshVersion, setTodoRefreshVersion] = useState(0);
  const generation = useRef(0);
  async function load() {
    const request = ++generation.current;
    setBusy(true);
    setError(false);
    try {
      const [goals, steps, activity, needsMe] = await Promise.all([
        outcomes.list(new URLSearchParams({ limit: String(OUTCOME_LIMITS.listPageSizeMax) }).toString()),
        // An older server without the Inbox still gets a working dashboard, just without steps.
        inbox.list({ status: "pending" }).catch(() => ({ items: [], nextCursor: null })),
        // The owner's activity is only asked for when it will be shown. A server without it, or one that fails, just
        // leaves the area out: the goals and the owner's list do not depend on it.
        layout.activity && outcomes.activity
          ? outcomes.activity({ includeAll: showAll }).then((response) => response.items ?? null).catch(() => null)
          : Promise.resolve(null),
        // Requests nobody can move join the owner's list. An older server just has none.
        outcomes.needsMe?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      if (generation.current !== request) return;
      setData({ outcomes: goals.items, steps: steps.items, moreSteps: steps.nextCursor !== null, activity,
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
  }, [outcomes, inbox, showAll, layout.activity]);
  useEffect(() => {
    if (refreshVersion > 0) void load();
  }, [refreshVersion]);

  const goals = data?.outcomes ?? [];
  const stats = summarizeOutcomes(goals);
  const attention = attentionRows(data?.steps ?? [], goals);
  const entries = needsMeQueue(attention, data?.requests ?? [], data?.todos);
  const first = entries[0];
  const focus = first?.kind === "step" ? first.row : undefined;
  const queue = focus ? entries.slice(1) : entries;
  const rowLimit = DASHBOARD_ROW_LIMIT - 1;
  const visibleQueue = allQueue ? queue : queue.slice(0, rowLimit);
  const visibleTodos = new Set(visibleQueue.flatMap((entry) => entry.kind === "todo" ? [entry.item.todo.id] : []));
  const working = laneOutcomes(goals, BOT_OUTCOME_STATUSES, attention);
  const stuck = laneOutcomes(goals, STUCK_OUTCOME_STATUSES, attention);
  const attentionCount = data ? `${formatCount(entries.length)}${data.moreSteps ? "+" : ""}` : "–";
  const value = (count: number) => (data ? formatCount(count) : "–");
  const open = (row: AttentionRow) => (row.step ? onSelectStep(row.step) : onSelectOutcome(row.outcomeId));
  async function mutateTodo(write: () => Promise<TodoItemView>) {
    if (todoActing) return false;
    setTodoActing(true);
    setTodoError(false);
    try {
      const updated = await write();
      if (updated.status === "done" || updated.status === "dismissed" || updated.displayState === "snoozed") {
        setData((current) => current && { ...current, todos: current.todos.filter((entry) => entry.todo.id !== updated.id) });
      }
      setTodoRefreshVersion((version) => version + 1);
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
  const actOnTodo = (item: TodoItemView, action: TodoAction, input?: Omit<TodoActionInput, "revision">) =>
    outcomes.todos ? mutateTodo(() => outcomes.todos!.act(item.id, action, { revision: item.revision, ...input })) : Promise.resolve(false);
  const botName = (outcome: OutcomeSummary) =>
    bots.find((bot) => bot.id === outcome.botId)?.name ?? t("Bot");
  const todoHandoff = outcomes.todos && { bots, client: outcomes.todos, goals: outcomes, onOpenChannel, onSelectOutcome };
  const canOpenActivity = (item: ActivityItem) =>
    item.link.type === "outcome" || (item.link.type === "channel" && onOpenChannel !== undefined);
  const openActivity = (item: ActivityItem) => {
    if (item.link.type === "outcome") onSelectOutcome(item.link.id);
    else if (item.link.type === "channel") onOpenChannel?.(item.link.id);
  };
  const lane = (items: { rows: OutcomeSummary[]; total: number }) =>
    items.rows.length === 0 ? (
      <p className="outcome-dash-lane-empty">{t("Nothing here.")}</p>
    ) : (
      <ul className="outcome-rows">
        {items.rows.map((outcome) => (
          <li key={outcome.id}>
            <button className="outcome-row" onClick={() => onSelectOutcome(outcome.id)}>
              <span className="min-w-0 flex-1">
                <span className="outcome-row-title">{outcome.title}</span>
                <span className="outcome-row-meta">
                  {botName(outcome)} · {new Date(outcome.updatedAt).toLocaleString()}
                </span>
              </span>
              <span className="outcome-status" data-outcome-status={outcome.status}>
                {t(outcomeStatusLabels[outcome.status])}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  return (
    <section aria-label={t("Dashboard")} aria-busy={busy} className="outcome-dash">
      <div className="outcome-toolbar">
        <p className="outcome-toolbar-description">{t("Where your goals stand right now.")}</p>
        <div className="outcome-toolbar-controls">
          <OutcomeButton onClick={onCreateIdea}>
            <Lightbulb aria-hidden="true" className="size-3.5" />
            {t("Capture an idea")}
          </OutcomeButton>
          <OutcomeRefresh busy={busy} onRefresh={() => {
            setTodoRefreshVersion((version) => version + 1);
            void load();
          }} />
        </div>
      </div>
      {outcomes.todos && <TodoPanel client={outcomes.todos} hiddenIds={visibleTodos} onChanged={() => void load()} refreshVersion={todoRefreshVersion} handoff={todoHandoff} />}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t("Could not load goals. Try again.")}{" "}
          <OutcomeButton variant="ghost" onClick={() => void load()}>
            {t("Retry")}
          </OutcomeButton>
        </p>
      )}

      <div className="outcome-dash-metrics">
        <Metric label={t("In progress")} value={value(stats.active)} />
        <Metric
          label={t("Needs your action")}
          value={attentionCount}
          tone={entries.length > 0 ? "attention" : undefined}
        />
        <Metric label={t("Accepted")} value={value(stats.accepted)} />
        <Metric label={t("All goals")} value={value(stats.total)} />
      </div>

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
                />
              ) : entry.kind === "todo" ? (
                <TodoRow key={entry.key} item={entry.item.todo} attention={entry.item.attention}
                  disabled={todoActing || !outcomes.todos} act={actOnTodo}
                  handoff={todoHandoff && { ...todoHandoff, change: mutateTodo }}
                  update={outcomes.todos && ((item, input) => mutateTodo(() => outcomes.todos!.update(item.id, input)))} />
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

      {layout.activity && data?.activity != null && (
        <ActivitySection
          items={data.activity}
          botName={(botId) => bots.find((bot) => bot.id === botId)?.name ?? t("Bot")}
          cardMaxItems={cardMaxItems}
          showAll={showAll}
          onToggleAll={() => setShowAll((previous) => !previous)}
          onOpen={openActivity}
          canOpen={canOpenActivity}
        />
      )}

      {layout.lanes && (
      <section aria-label={t("In progress")} className="outcome-dash-section">
        <SectionHeading
          title={t("In progress")}
          count={working.total + stuck.total > 0 ? String(working.total + stuck.total) : undefined}
          action={stats.total > 0 ? { label: t("View all"), onClick: onShowGoals } : undefined}
        />
        {data && working.total + stuck.total === 0 && attention.length === 0 ? (
          <div className="outcome-dash-empty" role="status">
            <Target aria-hidden="true" className="size-4" strokeWidth={1.6} />
            {t("No goals in progress.")}
            <OutcomeButton variant="ghost" onClick={onCreateGoal}>
              <Plus aria-hidden="true" className="size-3.5" />
              {t("New Outcome")}
            </OutcomeButton>
          </div>
        ) : (
          <div className="outcome-dash-lanes">
            <Lane title={t("Bots are working")} count={working.total}>
              {lane(working)}
            </Lane>
            <Lane title={t("Paused or failed")} count={stuck.total}>
              {lane(stuck)}
            </Lane>
          </div>
        )}
      </section>
      )}
    </section>
  );
}
