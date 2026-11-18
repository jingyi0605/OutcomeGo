import { useEffect, useState } from "react";
import { ArrowLeft, Inbox, Lightbulb, ListChecks, Plus, Target } from "lucide-react";
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
import { PlanningWizard } from "../planning/planning-wizard";
import { OutcomeButton } from "../outcome-ui";

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
  bots: Array<{ id: string; name: string }>;
}) {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(() => routeFor(target));
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
    setRoute(
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
    setRoute({ kind: "outcome", id, reviewRevision });
  const selectedBotId = bots.some((bot) => bot.id === botId) ? botId : (bots[0]?.id ?? "");
  const tab = ["all", "inbox", "explore"].includes(route.kind) ? route.kind : origin;
  return (
    <section
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
              setRoute({ kind: "new" });
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
          {!["all", "inbox", "explore"].includes(route.kind) && (
            <OutcomeButton
              variant="ghost"
              className="-ml-2 text-foreground-secondary"
              onClick={() => {
                setVersion((value) => value + 1);
                setRoute({ kind: origin });
              }}
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              {t(
                origin === "inbox"
                  ? "Back to Inbox"
                  : origin === "explore"
                    ? "Back to ideas"
                    : "Back to all goals"
              )}
            </OutcomeButton>
          )}
          {route.kind === "all" && (
            <OutcomeList
              client={api.outcomes}
              bots={bots}
              onSelect={review}
              onCreate={() => setRoute({ kind: "new" })}
            />
          )}
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
          {route.kind === "inbox" && (
            <OutcomeInbox client={api.outcomeInbox} onSelect={select} refreshVersion={version} />
          )}
          {route.kind === "explore" && (
            <ExplorePanel
              client={api.explore}
              outcomes={api.outcomes}
              bots={bots}
              onOutcome={review}
            />
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
              outcomeId={route.id}
              reviewRevision={route.reviewRevision}
              onHuman={(id) => setRoute({ kind: "human", id })}
              onDecision={(id) => setRoute({ kind: "decision", id })}
            />
          )}
        </div>
      </div>
    </section>
  );
}
function OutcomeWithActions({
  outcomeId,
  reviewRevision,
  onHuman,
  onDecision,
}: {
  outcomeId: string;
  reviewRevision?: number;
  onHuman: (id: string) => void;
  onDecision: (id: string) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<HumanWorkItemView[]>([]);
  const [inbox, setInbox] = useState<OutcomeInboxItemView[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api.outcomeInbox.humanItems(outcomeId),
      api.outcomeInbox.forOutcome(outcomeId),
    ]).then(
      ([items, page]) => {
        if (active) {
          setItems(items);
          setInbox(page.items);
        }
      },
      () => {
        if (active) setError(true);
      }
    );
    return () => {
      active = false;
    };
  }, [outcomeId]);
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert">
          {t("Some action links could not be loaded. Reopen this Outcome to retry.")}
        </p>
      )}
      {inbox
        .filter((item) => item.decisionId)
        .map((item) => (
          <button
            className="mr-2 outcome-control"
            key={item.id}
            onClick={() => onDecision(item.decisionId!)}
          >
            {t("Open Decision")}: {item.title}
          </button>
        ))}
      {items.map((item) => (
        <button className="mr-2 outcome-control" key={item.id} onClick={() => onHuman(item.id)}>
          {t("Human action")}: {item.title} · {item.status} · {t("Revision")}{" "}
          {item.contractRevision}
        </button>
      ))}
      <OutcomeDetail outcomeId={outcomeId} client={api.outcomes} reviewRevision={reviewRevision} />
    </div>
  );
}
