import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  ListChecks,
  LoaderCircle,
  ShieldCheck,
  Target,
} from "lucide-react";
import { outcomeBriefSource } from "@outcomego/contracts/outcome-view";
import type {
  OutcomeBrief,
  OutcomeBriefItem,
  OutcomeDetail,
  ContractRevisionView,
} from "@outcomego/contracts/outcomes";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import type { OutcomeClient } from "../../../client/outcome-api";
import { useI18n } from "../../../lib/i18n";
import { OutcomeButton } from "./outcome-ui";
import { OutcomeSourceInfo } from "./outcome-source-info";

type Readiness = "met" | "unmet" | "unknown";
type Condition = { title: string; status: Readiness; explanation: string; quote?: string };

function CompletionStatus({ status, label }: { status: string; label?: string }) {
  const { t } = useI18n();
  const Icon =
    status === "completed"
      ? Check
      : status === "running" || status === "in_progress"
        ? LoaderCircle
        : ["failed", "blocked", "rejected"].includes(status)
          ? CircleAlert
          : Circle;
  return (
    <span className="outcome-item-state" data-record-status={status}>
      <Icon size={12} aria-hidden="true" />
      {t(label ?? status)}
    </span>
  );
}
function BriefList({ items, kind }: { items: OutcomeBriefItem[]; kind: "risk" | "task" }) {
  return (
    <ul className="outcome-brief-list">
      {items.map((item, i) => (
        <li key={i}>
          <div className="outcome-item-heading">
            <strong>{item.title}</strong>
            <CompletionStatus
              status={kind === "risk" ? "unknown" : "proposed"}
              label={kind === "risk" ? "Not assessed" : "Not scheduled"}
            />
          </div>
          <p>
            {item.explanation}
            <OutcomeSourceInfo text={item.quote} name={item.title} />
          </p>
        </li>
      ))}
    </ul>
  );
}
export function OutcomeApprovalScope({
  intent,
  revision,
}: {
  intent?: OutcomeBriefItem;
  revision?: ContractRevisionView;
}) {
  const { t } = useI18n();
  const source = revision
    ? [
        `**${t("Goal")}**`,
        ...revision.goal.map((goal) => `- ${goal}`),
        `\n**${t("Acceptance")}**`,
        ...revision.criteria.map(
          (item) => `- **${item.required ? t("Required") : t("Optional")}:** ${item.statement}`
        ),
        `\n**${t("Included")}**`,
        ...revision.boundaries.included.map((text) => `- ${text}`),
        `\n**${t("Excluded")}**`,
        ...revision.boundaries.excluded.map((text) => `- ${text}`),
        ...(revision.budget ? [t("Budget"), JSON.stringify(revision.budget)] : []),
      ].join("\n")
    : intent
      ? `${intent.explanation}\n\n${intent.quote}`
      : undefined;
  return (
    <div className="outcome-plan-scope">
      <span className="outcome-plan-scope-label">{t("Proposed plan")}</span>
      <p>
        {intent?.title ?? revision?.goal[0] ?? t("Check the proposed scope before execution starts.")}
        {source && <OutcomeSourceInfo text={source} name={t("Proposed plan")} />}
      </p>
    </div>
  );
}
function Status({ value }: { value: Readiness }) {
  const { t } = useI18n();
  const Icon = value === "met" ? Check : value === "unmet" ? CircleAlert : Circle;
  return (
    <span className="outcome-brief-status" data-state={value}>
      <Icon size={12} aria-hidden="true" />
      {t(value === "met" ? "Met" : value === "unmet" ? "Not met" : "Not verified")}
    </span>
  );
}
function BriefSection({
  icon: Icon,
  title,
  preview,
  children,
}: {
  icon: typeof Target;
  title: string;
  preview: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [visited, setVisited] = useState(false);
  return (
    <details
      className="outcome-brief-section"
      onToggle={(event) => {
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>
        <Icon size={15} aria-hidden="true" />
        <span className="outcome-brief-label">{t(title)}</span>
        <span className="outcome-brief-preview">{preview}</span>
        <ChevronRight size={13} className="outcome-brief-chevron" aria-hidden="true" />
      </summary>
      {visited && <div className="outcome-brief-body">{children}</div>}
    </details>
  );
}

/** The summary never supplies approval, readiness, task status or Decision authority. */
export function OutcomeBriefView({
  outcome,
  client,
  hideFacts = false,
  children,
}: {
  outcome: OutcomeDetail;
  client: Pick<OutcomeClient, "brief">;
  hideFacts?: boolean;
  children: ReactNode | ((brief: OutcomeBrief | undefined) => ReactNode);
}) {
  const { t } = useI18n();
  const sourceKey = outcomeBriefSource(outcome);
  const [state, setState] = useState<{ key: string; brief?: OutcomeBrief; error?: boolean }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!client.brief) return;
    let active = true;
    setState({ key: sourceKey });
    void client.brief(outcome.id).then(
      (brief) => {
        if (active)
          setState({
            key: sourceKey,
            ...(brief.outcomeId === outcome.id &&
            brief.sourceKey === sourceKey &&
            brief.revisionId === (outcome.currentRevisionView?.id ?? null)
              ? { brief }
              : { error: true }),
          });
      },
      () => {
        if (active) setState({ key: sourceKey, error: true });
      }
    );
    return () => {
      active = false;
    };
  }, [sourceKey, client.brief, retry]);
  const brief = state?.key === sourceKey ? state.brief : undefined;
  // Compact hosts such as the chat card hide the fact list but still need the overview's plan text,
  // so they read the same brief as the full goal page.
  if (hideFacts) {
    return (
      <section className="outcome-brief" aria-label={t("Goal overview")}>
        {typeof children === "function" ? children(brief) : children}
      </section>
    );
  }
  const loading = Boolean(
    client.brief && (state?.key !== sourceKey || (!state?.brief && !state?.error))
  );
  const revision = outcome.currentRevisionView;
  const conditions: Condition[] = [
    {
      title: t("Plan approval"),
      status: revision?.status === "approved" ? "met" : "unmet",
      explanation:
        revision?.status === "approved"
          ? t("The saved contract has been explicitly approved.")
          : t("Review the contract before approving this plan."),
    },
  ];
  for (const item of revision?.conflicts.filter((item) => item.severity === "blocking") ?? [])
    conditions.push({
      title: t("Unresolved planning question"),
      status: "unmet",
      explanation: item.message,
    });
  const tasks = outcome.workItems.filter(
    (item) => item.contractRevision === outcome.currentRevision
  );
  const dependencyIds = new Set(tasks.flatMap((item) => item.dependsOn));
  const progressItem =
    tasks.find((item) => item.status === "running" && item.progress?.tasks.length) ??
    [...tasks].reverse().find((item) => item.progress?.tasks.length);
  // Checks the executing agent reported while working; the generated summary can only list them as unverified.
  const reportedItem = [...tasks].reverse().find((item) => item.progress?.prerequisites?.length);
  const reportedPrerequisites = reportedItem?.progress?.prerequisites ?? [];
  for (const id of dependencyIds) {
    const dependency = outcome.workItems.find((item) => item.id === id);
    conditions.push({
      title: dependency?.title ?? t("Task dependency"),
      status: !dependency ? "unknown" : dependency.status === "completed" ? "met" : "unmet",
      explanation: dependency
        ? t("Saved task status: {status}", { status: t(dependency.status) })
        : t("The prerequisite task could not be verified."),
    });
  }
  for (const check of reportedPrerequisites)
    conditions.push({
      title: check.title,
      status: check.status,
      explanation: check.summary ?? t("Reported by the executing agent"),
      quote: [check.title, check.summary, reportedItem && `WorkItem ${reportedItem.id}`]
        .filter(Boolean)
        .join("\n"),
    });
  const sameCondition = (a: string, b: string) => {
    const [x, y] = [a, b].map((text) => text.toLowerCase().replace(/\s+/g, " ").trim());
    return Boolean(x && y && (x.includes(y) || y.includes(x)));
  };
  for (const item of brief?.prerequisites ?? [])
    if (!reportedPrerequisites.some((check) => sameCondition(check.title, item.title)))
      conditions.push({ ...item, status: "unknown" });
  const notMet = conditions.filter((item) => item.status === "unmet").length;
  const unknown = conditions.filter((item) => item.status === "unknown").length;
  const taskSteps = progressItem?.progress?.tasks ?? null;
  const totalTasks = taskSteps ? taskSteps.length : tasks.length;
  const completedTasks = taskSteps
    ? taskSteps.filter((step) => step.status === "completed").length
    : tasks.filter((item) => item.status === "completed" || item.status === "accepted").length;
  const runningTasks = taskSteps
    ? taskSteps.filter((step) => step.status === "in_progress").length
    : tasks.filter((item) => item.status === "running" || item.status === "in_progress").length;
  return (
    <section className="outcome-brief" aria-label={t("Goal overview")}>
      {typeof children === "function" ? children(brief) : children}
      <div className="outcome-brief-facts" key={sourceKey}>
        <BriefSection
          icon={Target}
          title="Background"
          preview={
            brief?.background.title ??
            t(loading ? "Preparing a short overview…" : "Short overview unavailable")
          }
        >
          <p>
            {brief?.background.explanation ??
              t(
                "The original description is available below; its prerequisites have not been verified."
              )}
            <OutcomeSourceInfo
              text={outcome.description}
              name={t("Background and original request")}
            />
          </p>
        </BriefSection>
        <BriefSection
          icon={ShieldCheck}
          title="Prerequisites"
          preview={
            <>
              <Status
                value={
                  notMet
                    ? "unmet"
                    : unknown ||
                        (!brief && !reportedPrerequisites.length) ||
                        (!brief?.prerequisites.length &&
                          !reportedPrerequisites.length &&
                          !dependencyIds.size)
                      ? "unknown"
                      : "met"
                }
              />
              <span>
                {notMet ? t("{count} pending", { count: notMet }) : t("Plan approved")}
                {unknown > 0
                  ? ` · ${t("{count} not verified", { count: unknown })}`
                  : !notMet && !dependencyIds.size && !reportedPrerequisites.length
                    ? ` · ${t("No prerequisite checks recorded")}`
                    : ""}
              </span>
            </>
          }
        >
          <ul className="outcome-brief-list">
            {conditions.map((item, i) => (
              <li key={i}>
                <div className="outcome-item-heading">
                  <strong>{item.title}</strong>
                  <Status value={item.status} />
                </div>
                <p>
                  {item.explanation}
                  <OutcomeSourceInfo text={item.quote ?? item.explanation} name={item.title} />
                </p>
              </li>
            ))}
          </ul>
          {!brief && <p>{t("Other prerequisites have not been summarized or verified.")}</p>}
        </BriefSection>
        {brief && brief.risks.length > 0 && (
          <BriefSection
            icon={CircleAlert}
            title="Recorded risks"
            preview={
              brief.risks.length === 1
                ? brief.risks[0]!.title
                : t("{count} recorded risks", { count: brief.risks.length })
            }
          >
            <BriefList items={brief.risks} kind="risk" />
          </BriefSection>
        )}
        <BriefSection
          icon={ListChecks}
          title="Tasks"
          preview={
            totalTasks || brief ? (
              <span className="outcome-task-counts">
                {!totalTasks && brief?.proposedTasks.length
                  ? t("{count} suggested tasks", { count: brief.proposedTasks.length })
                  : t("{count} tasks", { count: totalTasks })}
                {" · "}
                {t("{count} completed", { count: completedTasks })}
                {" · "}
                {t("{count} in progress", { count: runningTasks })}
              </span>
            ) : (
              t(loading ? "Preparing task overview…" : "Task overview unavailable")
            )
          }
        >
          {taskSteps?.length ? (
            <ol className="outcome-brief-list">
              {taskSteps.map((step) => (
                <li key={step.id}>
                  <div className="outcome-item-heading">
                    <strong>{step.title}</strong>
                    <CompletionStatus status={step.status} />
                  </div>
                  <p>
                    {step.summary ??
                      (progressItem?.progress?.phase
                        ? `${t("Current phase")}: ${progressItem.progress.phase}`
                        : t("Status comes from the saved task record."))}
                    <OutcomeSourceInfo
                      name={step.title}
                      text={[
                        step.title,
                        step.summary,
                        progressItem?.progress?.phase && `Phase: ${progressItem.progress.phase}`,
                        `Step ${step.id}`,
                        progressItem && `WorkItem ${progressItem.id}`,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    />
                  </p>
                </li>
              ))}
            </ol>
          ) : tasks.length ? (
            <ol className="outcome-brief-list">
              {tasks.map((item) => (
                <li key={item.id}>
                  <div className="outcome-item-heading">
                    <strong>{item.title}</strong>
                    <CompletionStatus status={item.status} />
                  </div>
                  <p>
                    {item.statusReason ?? t("Status comes from the saved task record.")}
                    <OutcomeSourceInfo
                      name={item.title}
                      text={[
                        item.title,
                        item.statusReason,
                        `WorkItem ${item.id}`,
                        `Revision ${item.contractRevision}`,
                        item.rootRunId && `Run ${item.rootRunId}`,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    />
                  </p>
                </li>
              ))}
            </ol>
          ) : brief?.proposedTasks.length ? (
            <>
              <p>{t("Suggested steps, not scheduled work items.")}</p>
              <BriefList items={brief.proposedTasks} kind="task" />
            </>
          ) : (
            <p>
              {t(
                loading
                  ? "Preparing task overview…"
                  : brief
                    ? "No task breakdown is saved. Acceptance criteria are not execution tasks."
                    : "Task overview unavailable"
              )}
            </p>
          )}
        </BriefSection>
      </div>
      {client.brief && state?.key === sourceKey && state.error && (
        <div className="outcome-brief-unavailable" role="status">
          {t("Short overview unavailable")}
          <button onClick={() => setRetry((value) => value + 1)}>{t("Retry summary")}</button>
        </div>
      )}
    </section>
  );
}

function ActionContext({ item }: { item: OutcomeInboxItemView }) {
  const { t } = useI18n();
  const [visited, setVisited] = useState(false);
  return (
    <details
      className="outcome-now-context"
      onToggle={(event) => {
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>{t("What is this decision based on?")}</summary>
      {visited && (
        <dl>
          {[
            ["Completed", item.completed],
            ["Problem", item.problem],
            ["Next", item.next],
          ].map(
            ([label, text]) =>
              text && (
                <div key={label}>
                  <dt>{t(label!)}</dt>
                  <dd>{text}</dd>
                </div>
              )
          )}
        </dl>
      )}
    </details>
  );
}
export function OutcomeActionItems({
  items,
  onSelect,
}: {
  items: OutcomeInboxItemView[];
  onSelect: (item: OutcomeInboxItemView) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {items
        .filter((item) => item.requiresAction)
        .map((item) => (
          <div className="outcome-now-item" key={item.id}>
            <div className="outcome-now-line">
              <h3>{item.title}</h3>
              <OutcomeButton variant="default" onClick={() => onSelect(item)}>
                {t(
                  item.category === "decision_pending"
                    ? "Decide"
                    : item.category === "human_action_pending"
                      ? "Open human task"
                      : "Review results"
                )}
                <ArrowUpRight size={13} aria-hidden="true" />
              </OutcomeButton>
            </div>
            <ActionContext item={item} />
          </div>
        ))}
    </>
  );
}
