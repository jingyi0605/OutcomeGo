import { useEffect, useState } from "react";
import { useI18n } from "../../../lib/i18n";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  FileCheck2,
  LoaderCircle,
  ScanLine,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { outcomeDeepLink, outcomeDecisionDeepLink } from "@outcomego/contracts/app-deep-links";
import { outcomeCardStage, type OutcomeChatCard } from "@outcomego/contracts/outcome-chat";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import { outcomeStageLabels, outcomeNextSteps } from "./outcome-presentation";
import { OUTCOMEGO_DEEP_LINK_EVENT } from "../../../lib/app-deep-links";
import type { OutcomeClient } from "../../../client/outcome-api";
import { OutcomeButton } from "./outcome-ui";
import "./outcome-ui.css";
import { OutcomeActionItems, OutcomeApprovalScope, OutcomeBriefView } from "./outcome-brief";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import type { InboxClient } from "./inbox/inbox-api";
import { OutcomeExecutionCard } from "./outcome-execution-card";

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

/** Read current facts without promoting generated output to owner acceptance. */
export function OutcomeChatCardView({
  card,
  client,
  inboxClient,
}: {
  card: OutcomeChatCard;
  client?: CardClient;
  inboxClient?: Pick<InboxClient, "forOutcome">;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState<OutcomeDetail | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [stale, setStale] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [source, setSource] = useState<CardClient | null>(client ?? null);
  const [actions, setActions] = useState<OutcomeInboxItemView[]>([]);
  useEffect(() => {
    setCurrent(null);
    setUnavailable(false);
    setActions([]);
  }, [card.outcomeId]);
  useEffect(() => {
    if (!card.outcomeId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const source = client ?? (await import("../../../client/outcomego-api")).api.outcomes;
        const value = await source.get(card.outcomeId!);
        if (active) {
          setSource(source);
          setCurrent(value);
          setUnavailable(false);
        }
        const inbox =
          inboxClient ??
          (!client ? (await import("../../../client/outcomego-api")).api.outcomeInbox : undefined);
        if (inbox) {
          const page = await inbox.forOutcome(card.outcomeId!);
          if (active)
            setActions(
              page.items.filter((item) => item.outcomeId === card.outcomeId && item.requiresAction)
            );
        }
      } catch {
        if (active) setUnavailable(true);
      }
      if (active) timer = setTimeout(read, 10_000);
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [card.outcomeId, card.updatedAt, client, inboxClient, refresh]);
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
  const live = current?.id === card.outcomeId ? current : null;
  const result = live
    ? [...live.outputs]
        .reverse()
        .find((output) =>
          live.workItems.some(
            (item) =>
              item.id === output.workItemId && item.contractRevision === live.currentRevision
          )
        )
    : undefined;
  const stage = live ? outcomeCardStage(live.status) : card.stage;
  const Icon = icons[stage];
  const open = (decisionId?: string) => {
    if (card.outcomeId)
      window.dispatchEvent(
        new CustomEvent(OUTCOMEGO_DEEP_LINK_EVENT, {
          detail: {
            url: decisionId ? outcomeDecisionDeepLink(decisionId) : outcomeDeepLink(card.outcomeId),
          },
        })
      );
  };
  return (
    <section
      className="outcome-chat-card"
      aria-label={t("Goal progress")}
      data-stage={stage}
      data-stale={stale || unavailable ? "true" : undefined}
    >
      <header className="outcome-chat-card-heading">
        <span className="outcome-chat-stage-icon" aria-hidden="true">
          <Icon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="outcome-chat-eyebrow">
            <Target size={11} />
            {t("Goal")} · {t(outcomeStageLabels[stage])}
          </p>
          <h3>{live?.title ?? card.title}</h3>
        </div>
      </header>
      {!live && (
        <div key={stage} className="outcome-chat-stage-content">
          <p className="outcome-chat-next" role="status">
            {t(
              stale
                ? "This step has not been confirmed complete. Check the conversation or reload the goal."
                : outcomeNextSteps[stage]
            )}
          </p>
          <ol className="outcome-chat-steps" aria-label={t("Goal stages")}>
            {["Planning", "Review", "Execution", "Results"].map((label, i) => {
              const index =
                stage === "failed" || stage === "cancelled"
                  ? -1
                  : ["analyzing", "generating", "plan_ready"].includes(stage)
                    ? 0
                    : stage === "draft" || stage === "ready"
                      ? 1
                      : stage === "running" || stage === "attention"
                        ? 2
                        : 3;
              return (
                <li
                  key={t(label)}
                  aria-current={i === index ? "step" : undefined}
                  data-complete={i < index ? "true" : undefined}
                >
                  <span />
                  {t(label)}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {live && source && (
        <div key={stage} className="outcome-chat-stage-content">
          <OutcomeBriefView outcome={live} client={source}>
            {(brief) => (
              <section className="outcome-now" aria-label={t("What needs you now")}>
                <p className="outcome-now-eyebrow">{t("What needs you now")}</p>
                <OutcomeActionItems items={actions} onSelect={(item) => open(item.decisionId)} />
                {actions.length === 0 && (
                  <div className="outcome-now-line">
                    <div>
                      <h3>
                        {t(
                          stage === "draft"
                            ? "Approve this plan?"
                            : stage === "review"
                              ? "Do these results meet your requirements?"
                              : outcomeNextSteps[stage]
                        )}
                      </h3>
                      {stage === "draft" && <OutcomeApprovalScope intent={brief?.intent} />}
                    </div>
                    {["draft", "review", "attention", "ready"].includes(stage) && (
                      <OutcomeButton onClick={() => open()}>
                        {t(
                          stage === "draft"
                            ? "Review goal"
                            : stage === "review"
                              ? "Review results"
                              : "Open goal"
                        )}
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </OutcomeButton>
                    )}
                  </div>
                )}
              </section>
            )}
          </OutcomeBriefView>
        </div>
      )}
      {live && live.outputs.length > 0 && (
        <p className="outcome-chat-summary">
          {t("{count} outputs", { count: live.outputs.length })} ·{" "}
          {t("{count} evidence records", { count: live.evidence.length })}
          {stage !== "accepted" && ` · ${t("Not yet accepted")}`}
        </p>
      )}
      {live && source?.transcript && (
        <OutcomeExecutionCard
          key={`${live.id}:${live.currentRevision}`}
          outcome={live}
          client={{ transcript: source.transcript }}
        />
      )}
      {result && (
        <details
          className="outcome-chat-disclosure"
          onToggle={(event) => setShowResult(event.currentTarget.open)}
        >
          <summary>
            {t("Results")} · {result.title}
          </summary>
          {showResult && (
            <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {result.content || t("Open the goal to inspect this result.")}
            </p>
          )}
        </details>
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
      {card.outcomeId &&
        (!live ||
          actions.length > 0 ||
          !["draft", "review", "attention", "ready"].includes(stage)) && (
          <footer>
            <OutcomeButton onClick={() => open()}>
              {t(
                stage === "draft"
                  ? "Review goal"
                  : stage === "review"
                    ? "Review results"
                    : "Open goal"
              )}
              <ArrowUpRight size={13} />
            </OutcomeButton>
          </footer>
        )}
    </section>
  );
}
