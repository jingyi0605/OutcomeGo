import { Suspense, lazy, useEffect, useState } from "react";
import { useI18n } from "../../../lib/i18n";
import {
  Check,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  LoaderCircle,
  ScanLine,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { outcomeCardStage, type OutcomeChatCard } from "@outcomego/contracts/outcome-chat-card";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import { outcomeStageLabels, outcomeNextSteps } from "./outcome-presentation";
import type { OutcomeClient } from "../../../client/outcome-api";
import "./outcome-ui.css";
import type { InboxClient } from "./inbox/inbox-api";
import type { OutcomeExecutionBot } from "./outcome-execution-card";

// The full detail view is only needed once a card is opened; keep it out of the message list.
const OutcomeDetailModal = lazy(() => import("./inbox/outcome-detail-modal"));

type CardClient = Pick<OutcomeClient, "get" | "brief"> & Partial<Pick<OutcomeClient, "transcript">>;

const icons = {
  analyzing: ScanLine,
  generating: Sparkles,
  plan_ready: FileCheck2,
  draft: FileCheck2,
  ready: Target,
  running: LoaderCircle,
  attention: CircleAlert,
  review: FileCheck2,
  accepted: Check,
  cancelled: X,
  failed: CircleAlert,
};

/** Stages that can still change; settled goals are read once instead of polled. */
const SETTLED_STAGES = ["accepted", "cancelled", "failed"];

/** One-line progress: task steps reported by the executor, else work item counts. */
export function outcomeProgressSummary(outcome: OutcomeDetail) {
  const items = outcome.workItems.filter((item) => item.contractRevision === outcome.currentRevision);
  const steps = items.flatMap((item) => item.progress?.tasks ?? []);
  const active =
    items.find((item) => item.status === "running" && item.progress) ??
    [...items]
      .filter((item) => item.progress)
      .sort((a, b) => (b.progress!.updatedAt > a.progress!.updatedAt ? 1 : -1))[0];
  if (steps.length > 0)
    return {
      phase: active?.progress?.phase,
      done: steps.filter((step) => step.status === "completed").length,
      total: steps.length,
      unit: "steps" as const,
    };
  if (items.length > 0)
    return {
      done: items.filter((item) => item.status === "completed").length,
      total: items.length,
      unit: "work items" as const,
    };
  return null;
}

/**
 * Compact goal card: stage and one progress line only. Everything else lives in the detail
 * modal, which opens in place so the conversation is never replaced by the goals page.
 */
export function OutcomeChatCardView({
  card,
  client,
  bot,
}: {
  card: OutcomeChatCard;
  bot?: OutcomeExecutionBot;
  client?: CardClient;
  /** Accepted for compatibility; the compact card no longer reads the inbox. */
  inboxClient?: Pick<InboxClient, "forOutcome">;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState<OutcomeDetail | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [stale, setStale] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const live = current?.id === card.outcomeId ? current : null;
  // The executor can mark tasks blocked while the goal stays running; that still needs the user.
  const blockedCount =
    live?.status === "running"
      ? live.workItems
          .filter((item) => item.contractRevision === live.currentRevision && item.status === "running")
          .flatMap((item) => item.progress?.tasks ?? [])
          .filter((step) => step.status === "blocked").length
      : 0;
  const stage = blockedCount > 0 ? "attention" : live ? outcomeCardStage(live.status) : card.stage;
  const settled = SETTLED_STAGES.includes(stage);
  useEffect(() => {
    setCurrent(null);
    setUnavailable(false);
  }, [card.outcomeId]);
  useEffect(() => {
    if (!card.outcomeId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      let next = true;
      try {
        const source = client ?? (await import("../../../client/outcomego-api")).api.outcomes;
        const value = await source.get(card.outcomeId!);
        if (active) {
          setCurrent(value);
          setUnavailable(false);
        }
        next = !SETTLED_STAGES.includes(outcomeCardStage(value.status));
      } catch {
        if (active) setUnavailable(true);
      }
      // Hidden windows and settled goals do not need the periodic read.
      if (active && next) timer = setTimeout(read, document.hidden ? 60_000 : 10_000);
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [card.outcomeId, card.updatedAt, client, refresh]);
  useEffect(() => {
    const check = () =>
      setStale(
        ["analyzing", "generating"].includes(card.stage) &&
          Date.now() - Date.parse(card.updatedAt) > 120_000
      );
    check();
    const timer = setInterval(check, 15_000);
    return () => clearInterval(timer);
  }, [card.stage, card.updatedAt]);
  const Icon = icons[stage];
  const progress = live && stage === "running" ? outcomeProgressSummary(live) : null;
  const line = blockedCount > 0
    ? t("{count} task blocked, needs your attention", { count: blockedCount })
    : progress
    ? [
        progress.phase,
        t(progress.unit === "steps" ? "{done}/{total} steps" : "{done}/{total} work items", {
          done: progress.done,
          total: progress.total,
        }),
      ]
        .filter(Boolean)
        .join(" · ")
    : t(stale ? "This step has not been confirmed complete. Check the conversation or reload the goal." : outcomeNextSteps[stage]);
  const body = (
    <>
      <span className="outcome-chat-stage-icon" aria-hidden="true">
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="outcome-chat-eyebrow">
          <Target size={11} aria-hidden="true" />
          {t("Goal")} · {t(outcomeStageLabels[stage])}
        </span>
        <span className="outcome-chat-title">{live?.title ?? card.title}</span>
        <span className="outcome-chat-line" role="status">
          {line}
        </span>
      </span>
      {card.outcomeId && <ChevronRight size={14} className="outcome-chat-chevron" aria-hidden="true" />}
    </>
  );
  return (
    <section
      className="outcome-chat-card"
      aria-label={t("Goal progress")}
      data-stage={stage}
      data-settled={settled ? "true" : undefined}
      data-stale={stale || unavailable ? "true" : undefined}
    >
      {card.outcomeId ? (
        <button
          type="button"
          className="outcome-chat-card-main"
          aria-haspopup="dialog"
          aria-label={`${t("View goal details")}: ${live?.title ?? card.title}`}
          onClick={() => setDetailOpen(true)}
        >
          {body}
        </button>
      ) : (
        <div className="outcome-chat-card-main">{body}</div>
      )}
      {progress && progress.total > 0 && (
        <div
          className="outcome-chat-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
        >
          <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
        </div>
      )}
      {card.suggestions && (
        <details className="outcome-chat-disclosure">
          <summary>{t("View planning suggestions")}</summary>
          {(
            [
              ["Goal", card.suggestions.goals],
              ["Acceptance", card.suggestions.acceptance],
              ["Boundaries", card.suggestions.boundaries],
            ] as const
          ).map(([title, texts]) => (
            <div key={title}>
              <h4>{t(title)}</h4>
              <ul>
                {texts.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
      {unavailable && (
        <div role="alert" className="outcome-chat-summary">
          {t("Could not read the latest state. This is the last saved record.")}
          <button className="outcome-control" onClick={() => setRefresh((v) => v + 1)}>
            {t("Retry")}
          </button>
        </div>
      )}
      {detailOpen && card.outcomeId && (
        <Suspense fallback={null}>
          <OutcomeDetailModal
            outcomeId={card.outcomeId}
            bots={bot ? [bot] : []}
            onClose={() => setDetailOpen(false)}
          />
        </Suspense>
      )}
    </section>
  );
}
