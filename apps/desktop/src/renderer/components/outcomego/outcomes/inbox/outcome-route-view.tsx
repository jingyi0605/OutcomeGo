import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../client/outcomego-api";
import type { OutcomeDetail as OutcomeDetailView } from "@outcomego/contracts/outcomes";
import type { HumanWorkItemView } from "@outcomego/contracts/human-work";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import { DecisionCard } from "./decision-card";
import { HumanAction } from "../human-work/human-action";
import { useI18n } from "../../../../lib/i18n";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { getCachedOutcomeActions, setCachedOutcomeActions } from "./outcome-card-cache";

const OutcomeDetail = lazy(() => import("../detail/outcome-detail").then(module => ({ default: module.OutcomeDetail })));

/** Pages a goal can show inside a modal without leaving the current screen. */
export type OutcomeDetailRoute =
  | { kind: "decision"; id: string }
  | { kind: "outcome"; id: string; reviewRevision?: number }
  | { kind: "human"; id: string };

/** Renders the decision, human task or goal detail body shared by the workspace and chat modals. */
export function OutcomeRouteView({
  route,
  bots,
  initialOutcome,
  active = true,
  onOpen,
  onClose,
  onSubmitted,
  onReady,
  useCache = false,
  inChat = false,
  onOpenDetails,
}: {
  route: OutcomeDetailRoute;
  bots: OutcomeExecutionBot[];
  initialOutcome?: OutcomeDetailView;
  /** Pauses background polling while an inline chat card is collapsed. */
  active?: boolean;
  onOpen: (route: OutcomeDetailRoute) => void;
  /** Closes the hosting modal; a goal does so once a plan change continues in the background. */
  onClose?: () => void;
  /** Collapses and refreshes the inline chat card once an action or choice is submitted. */
  onSubmitted?: () => void;
  /** Called once initial data for the view has settled so chat cards open without flicker. */
  onReady?: () => void;
  useCache?: boolean;
  /** Compact inline mode inside a bot chat message card. */
  inChat?: boolean;
  /** Opens the full goal details in a standalone modal when clicked from chat. */
  onOpenDetails?: () => void;
}) {
  const review = (id: string, reviewRevision?: number) =>
    onOpen({ kind: "outcome", id, reviewRevision });
  if (route.kind === "decision")
    return (
      <DecisionCard
        key={route.id}
        decisionId={route.id}
        client={api.outcomeInbox}
        outcomes={api.outcomes}
        useCache={useCache}
        onReady={onReady}
        onOutcome={review}
        onResolved={onSubmitted}
      />
    );
  if (route.kind === "human")
    return (
      <HumanAction
        key={route.id}
        workItemId={route.id}
        client={api.outcomeInbox}
        materials={api.humanMaterials}
        upload={async (file) => {
          const asset = await api.uploadAsset(file, file.name, file.type);
          return { assetRef: `asset:${asset.assetId}` };
        }}
        onReview={review}
      />
    );
  return (
    <OutcomeWithActions
      key={`${route.id}:${route.reviewRevision ?? "current"}`}
      bots={bots}
      outcomeId={route.id}
      initialOutcome={initialOutcome}
      active={active}
      reviewRevision={route.reviewRevision}
      onHuman={(id) => onOpen({ kind: "human", id })}
      onDecision={(id) => onOpen({ kind: "decision", id })}
      onReceipt={(revision) => review(route.id, revision)}
      onClose={onClose}
      onSubmitted={onSubmitted}
      onReady={onReady}
      useCache={useCache}
      inChat={inChat}
      onOpenDetails={onOpenDetails}
    />
  );
}

function OutcomeWithActions({
  bots,
  outcomeId,
  initialOutcome,
  active = true,
  reviewRevision,
  onHuman,
  onDecision,
  onReceipt,
  onClose,
  onSubmitted,
  onReady,
  useCache = false,
  inChat = false,
  onOpenDetails,
}: {
  bots: OutcomeExecutionBot[];
  outcomeId: string;
  initialOutcome?: OutcomeDetailView;
  active?: boolean;
  reviewRevision?: number;
  onHuman: (id: string) => void;
  onDecision: (id: string) => void;
  onReceipt: (revision: number) => void;
  onClose?: () => void;
  onSubmitted?: () => void;
  onReady?: () => void;
  useCache?: boolean;
  inChat?: boolean;
  onOpenDetails?: () => void;
}) {
  const { t } = useI18n();
  const initialCached = useCache ? getCachedOutcomeActions(outcomeId) : undefined;
  const [items, setItems] = useState<HumanWorkItemView[]>(() => initialCached?.items ?? []);
  const [inbox, setInbox] = useState<OutcomeInboxItemView[]>(() => initialCached?.inbox ?? []);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(() => !initialCached);
  const loadedOnceRef = useRef(Boolean(initialCached));
  useEffect(() => {
    const cached = useCache ? getCachedOutcomeActions(outcomeId) : undefined;
    loadedOnceRef.current = Boolean(cached);
    setItems(cached?.items ?? []);
    setInbox(cached?.inbox ?? []);
    setError(false);
    setLoading(!cached);
  }, [outcomeId, useCache]);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      const [human, page] = await Promise.allSettled([
        api.outcomeInbox.humanItems(outcomeId),
        api.outcomeInbox.forOutcome(outcomeId),
      ]);
      if (!mounted) return;
      const nextItems = human.status === "fulfilled" ? human.value : undefined;
      const nextInbox =
        page.status === "fulfilled"
          ? page.value.items.filter((item) => item.outcomeId === outcomeId)
          : undefined;
      if (nextItems) setItems(nextItems);
      if (nextInbox) setInbox(nextInbox);
      if (useCache && (nextItems || nextInbox)) {
        const existing = getCachedOutcomeActions(outcomeId);
        setCachedOutcomeActions(outcomeId, {
          items: nextItems ?? existing?.items ?? [],
          inbox: nextInbox ?? existing?.inbox ?? [],
        });
      }
      setError(human.status === "rejected" || page.status === "rejected");
      loadedOnceRef.current = true;
      setLoading(false);
      timer = setTimeout(read, 10_000);
    }
    void read();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [outcomeId, active, useCache]);
  const actionItems = useMemo(() => inbox.filter((item) => item.requiresAction), [inbox]);
  return (
    <div className="space-y-4">
      <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
        <OutcomeDetail
          outcomeId={outcomeId}
          bots={bots}
          client={api.outcomes}
          inboxClient={api.outcomeInbox}
          initialOutcome={initialOutcome}
          reviewRevision={reviewRevision}
          onReplanStarted={onClose}
          onActionSubmitted={onSubmitted}
          onReady={onReady}
          useCache={useCache}
          inChat={inChat}
          onOpenDetails={onOpenDetails}
          actionItems={actionItems}
          actionsError={error}
          actionsLoading={loading && !loadedOnceRef.current}
          onAction={(item) => {
            if (item.decisionId) onDecision(item.decisionId);
            else if (item.category === "human_action_pending" && item.workItemId)
              onHuman(item.workItemId);
            else if (item.category === "acceptance_pending") onReceipt(item.contractRevision);
          }}
        />
      </Suspense>
      {!inChat && items.length > 0 && (
        <details className="outcome-disclosure">
          <summary>{t("Human tasks")}</summary>
          {items.map((item) => (
            <button className="outcome-control" key={item.id} onClick={() => onHuman(item.id)}>
              {item.title} · {t(item.status)}
            </button>
          ))}
        </details>
      )}
    </div>
  );
}
