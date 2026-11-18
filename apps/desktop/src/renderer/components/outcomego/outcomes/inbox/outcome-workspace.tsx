import { useEffect, useRef, useState } from "react";
import { Inbox, Lightbulb, ListChecks, Plus, Target } from "lucide-react";
import { api } from "../../../../client/outcomego-api";
import type { DesktopOutcomeTarget } from "../../../../lib/outcome-target";
import type { HumanWorkItemView } from "@outcomego/contracts/human-work";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import { OutcomeInbox } from "./outcome-inbox";
import { DecisionCard } from "./decision-card";
import { OutcomeDetail } from "../detail/outcome-detail";
import { HumanAction } from "../human-work/human-action";
import { useI18n } from "../../../../lib/i18n";
import { ExplorePanel } from "../explore/explore-panel";
import { OutcomeList } from "../outcome-list";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { PlanningWizard } from "../planning/planning-wizard";
import { OutcomeButton } from "../outcome-ui";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../../ui/dialog";

type Route =
  | { kind: "all" }
  | { kind: "new" }
  | { kind: "inbox" }
  | { kind: "explore" }
  | { kind: "decision"; id: string }
  | { kind: "outcome"; id: string; reviewRevision?: number }
  | { kind: "human"; id: string };
const routeFor = (target: DesktopOutcomeTarget): Route =>
  target.decisionId
    ? { kind: "decision", id: target.decisionId }
    : target.outcomeId
      ? { kind: "outcome", id: target.outcomeId }
      : { kind: "all" };
export default function OutcomeWorkspace({
  target,
  onClose,
  bots,
}: {
  target: DesktopOutcomeTarget;
  onClose: () => void;
  bots: OutcomeExecutionBot[];
}) {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(() => routeFor(target));
  const workspace = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openRoute = (next: Route) => {
    if (
      ["all", "inbox", "explore"].includes(route.kind) &&
      document.activeElement instanceof HTMLElement
    )
      opener.current = document.activeElement;
    setRoute(next);
  };
  const [version, setVersion] = useState(0);
  const [botId, setBotId] = useState("");
  const [origin, setOrigin] = useState<"all" | "inbox" | "explore">("all");
  useEffect(() => {
    setRoute(routeFor(target));
    setOrigin(target.decisionId ? "inbox" : "all");
    // Reading the notification changes only its read marker, never the business state.
    if (target.channelId && target.notificationSequence)
      void api
        .markChannelRead(target.channelId, "0", target.notificationSequence)
        .catch(() => undefined);
  }, [target]);
  const select = (item: OutcomeInboxItemView) => {
    openRoute(
      item.decisionId
        ? { kind: "decision", id: item.decisionId }
        : item.category === "human_action_pending" && item.workItemId
          ? { kind: "human", id: item.workItemId }
          : {
              kind: "outcome",
              id: item.outcomeId,
              ...(item.category === "acceptance_pending"
                ? { reviewRevision: item.contractRevision }
                : {}),
            }
    );
  };
  const review = (id: string, reviewRevision?: number) =>
    openRoute({ kind: "outcome", id, reviewRevision });
  const selectedBotId = bots.some((bot) => bot.id === botId) ? botId : (bots[0]?.id ?? "");
  const tab =
    route.kind === "all" || route.kind === "inbox" || route.kind === "explore"
      ? route.kind
      : origin;
  const modalOpen = route.kind !== "all" && route.kind !== "inbox" && route.kind !== "explore";
  const closeModal = () => {
    setVersion((value) => value + 1);
    setRoute({ kind: origin });
  };
  return (
    <section
      ref={workspace}
      aria-label={t("Outcome workspace")}
      className="outcome-page flex min-h-0 flex-1 flex-col"
    >
      <header className="outcome-page-header">
        <div className="outcome-page-titlebar electron-drag">
          <h1>
            <Target
              aria-hidden="true"
              className="size-[17px] text-foreground-secondary"
              strokeWidth={1.6}
            />
            {t("Outcomes")}
          </h1>
          <OutcomeButton
            className="electron-no-drag"
            variant="default"
            onClick={() => {
              setOrigin("all");
              openRoute({ kind: "new" });
            }}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {t("New Outcome")}
          </OutcomeButton>
        </div>
        <nav aria-label={t("Outcome sections")} className="outcome-page-tabs">
          {(
            [
              { kind: "all", label: "All goals", icon: ListChecks },
              { kind: "inbox", label: "Needs attention", icon: Inbox },
              { kind: "explore", label: "Explore ideas", icon: Lightbulb },
            ] as const
          ).map((item) => (
            <button
              key={item.kind}
              aria-current={tab === item.kind ? "page" : undefined}
              onClick={() => {
                setOrigin(item.kind);
                setRoute({ kind: item.kind });
              }}
            >
              <item.icon aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
              {t(item.label)}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="outcome-page-content space-y-5">
          {tab === "all" && (
            <OutcomeList
              client={api.outcomes}
              bots={bots}
              onSelect={review}
              onCreate={() => openRoute({ kind: "new" })}
              refreshVersion={version}
            />
          )}
          {tab === "inbox" && (
            <OutcomeInbox client={api.outcomeInbox} onSelect={select} refreshVersion={version} />
          )}
          {tab === "explore" && (
            <ExplorePanel
              client={api.explore}
              outcomes={api.outcomes}
              bots={bots}
              onOutcome={review}
            />
          )}
        </div>
      </div>
      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent
          className="outcome-modal outcome-page"
          overlayClassName="outcome-modal-overlay"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const fallback = workspace.current?.querySelector<HTMLElement>(
              'nav button[aria-current="page"]'
            );
            (opener.current?.isConnected ? opener.current : fallback)?.focus();
          }}
        >
          <DialogTitle className="sr-only">
            {t(
              route.kind === "new"
                ? "Plan an Outcome"
                : route.kind === "decision"
                  ? "Decision"
                  : route.kind === "human"
                    ? "Human action"
                    : "Goal details"
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("Review the goal and handle current decisions.")}
          </DialogDescription>
          <div className="outcome-page-content outcome-modal-body space-y-5">
            {route.kind === "new" && (
              <div className="outcome-form space-y-5">
                <label className="block text-xs text-foreground-secondary">
                  {t("Execution Bot")}
                  <select
                    aria-label={t("Execution Bot")}
                    className="outcome-control mt-2 block w-full max-w-sm"
                    value={selectedBotId}
                    onChange={(event) => setBotId(event.target.value)}
                    disabled={bots.length === 0}
                  >
                    {bots.length === 0 && <option value="">{t("No Bots available")}</option>}
                    {bots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedBotId ? (
                  <PlanningWizard
                    key={selectedBotId}
                    botId={selectedBotId}
                    client={api.outcomes}
                    onDone={(outcome) => review(outcome.id)}
                  />
                ) : (
                  <p role="status">
                    {t("Create a Bot in chat before planning an Outcome.")}{" "}
                    <button className="underline" onClick={onClose}>
                      {t("Back to chats")}
                    </button>
                  </p>
                )}
              </div>
            )}
            {route.kind === "decision" && (
              <DecisionCard
                key={route.id}
                decisionId={route.id}
                client={api.outcomeInbox}
                outcomes={api.outcomes}
                onOutcome={review}
              />
            )}
            {route.kind === "human" && (
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
            )}
            {route.kind === "outcome" && (
              <OutcomeWithActions
                key={`${route.id}:${route.reviewRevision ?? "current"}`}
                bots={bots}
                outcomeId={route.id}
                reviewRevision={route.reviewRevision}
                onHuman={(id) => openRoute({ kind: "human", id })}
                onDecision={(id) => openRoute({ kind: "decision", id })}
                onReceipt={(revision) => review(route.id, revision)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function OutcomeWithActions({
  bots,
  outcomeId,
  reviewRevision,
  onHuman,
  onDecision,
  onReceipt,
}: {
  bots: OutcomeExecutionBot[];
  outcomeId: string;
  reviewRevision?: number;
  onHuman: (id: string) => void;
  onDecision: (id: string) => void;
  onReceipt: (revision: number) => void;
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
