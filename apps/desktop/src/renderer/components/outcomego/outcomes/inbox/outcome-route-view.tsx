import { useEffect, useState } from "react";
import { api } from "../../../../client/outcomego-api";
import type { HumanWorkItemView } from "@outcomego/contracts/human-work";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import { DecisionCard } from "./decision-card";
import { OutcomeDetail } from "../detail/outcome-detail";
import { HumanAction } from "../human-work/human-action";
import { useI18n } from "../../../../lib/i18n";
import type { OutcomeExecutionBot } from "../outcome-execution-card";

/** Pages a goal can show inside a modal without leaving the current screen. */
export type OutcomeDetailRoute =
  | { kind: "decision"; id: string }
  | { kind: "outcome"; id: string; reviewRevision?: number }
  | { kind: "human"; id: string };

/** Renders the decision, human task or goal detail body shared by the workspace and chat modals. */
export function OutcomeRouteView({
  route,
  bots,
  onOpen,
  onClose,
}: {
  route: OutcomeDetailRoute;
  bots: OutcomeExecutionBot[];
  onOpen: (route: OutcomeDetailRoute) => void;
  /** Closes the hosting modal; a goal does so once a plan change continues in the background. */
  onClose?: () => void;
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
        onOutcome={review}
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
      reviewRevision={route.reviewRevision}
      onHuman={(id) => onOpen({ kind: "human", id })}
      onDecision={(id) => onOpen({ kind: "decision", id })}
      onReceipt={(revision) => review(route.id, revision)}
      onClose={onClose}
    />
  );
}

function OutcomeWithActions({
  bots,
  outcomeId,
  reviewRevision,
  onHuman,
  onDecision,
  onReceipt,
  onClose,
}: {
  bots: OutcomeExecutionBot[];
  outcomeId: string;
  reviewRevision?: number;
  onHuman: (id: string) => void;
  onDecision: (id: string) => void;
  onReceipt: (revision: number) => void;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<HumanWorkItemView[]>([]);
  const [inbox, setInbox] = useState<OutcomeInboxItemView[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      const [human, page] = await Promise.allSettled([
        api.outcomeInbox.humanItems(outcomeId),
        api.outcomeInbox.forOutcome(outcomeId),
      ]);
      if (!active) return;
      if (human.status === "fulfilled") setItems(human.value);
      if (page.status === "fulfilled")
        setInbox(page.value.items.filter((item) => item.outcomeId === outcomeId));
      setError(human.status === "rejected" || page.status === "rejected");
      setLoading(false);
      timer = setTimeout(read, 10_000);
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [outcomeId]);
  return (
    <div className="space-y-4">
      <OutcomeDetail
        outcomeId={outcomeId}
        bots={bots}
        client={api.outcomes}
        inboxClient={api.outcomeInbox}
        reviewRevision={reviewRevision}
        onReplanStarted={onClose}
        actionItems={inbox.filter((item) => item.requiresAction)}
        actionsError={error}
        actionsLoading={loading}
        onAction={(item) => {
          if (item.decisionId) onDecision(item.decisionId);
          else if (item.category === "human_action_pending" && item.workItemId)
            onHuman(item.workItemId);
          else if (item.category === "acceptance_pending") onReceipt(item.contractRevision);
        }}
      />
      {items.length > 0 && (
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
