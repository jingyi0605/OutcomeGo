import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CalendarDays, Inbox, Lightbulb, LayoutDashboard, ListChecks, Plus, Target } from "lucide-react";
import { resolveTaskPolicy } from "@outcomego/contracts/task-policy";
import { api } from "../../../../client/outcomego-api";
import { useFeatureSettings } from "../../../../hooks/use-feature-settings";
import type { DesktopOutcomeTarget, OutcomeWorkspaceSection } from "../../../../lib/outcome-target";
import type { OutcomeInboxItemView } from "@outcomego/contracts/outcome-inbox";
import { OutcomeInbox } from "./outcome-inbox";
import { useI18n } from "../../../../lib/i18n";
import { ExplorePanel } from "../explore/explore-panel";
import { OutcomeList } from "../outcome-list";
import { OutcomeDashboard } from "../dashboard/outcome-dashboard";
import QuickIdeaDialog from "../explore/quick-idea-dialog";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { NewOutcomeForm } from "../thread/new-outcome-form";
import { OutcomeButton } from "../outcome-ui";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../../ui/dialog";
import { ScheduledGoalDetail } from "../detail/scheduled-goal-detail";

const OutcomeRouteView = lazy(() =>
  import("./outcome-route-view").then((module) => ({ default: module.OutcomeRouteView }))
);
const CalendarPage = lazy(() =>
  import("../calendar/calendar-page").then((module) => ({ default: module.CalendarPage }))
);

type Route =
  | { kind: "overview" }
  | { kind: "all" }
  | { kind: "new" }
  | { kind: "inbox" }
  | { kind: "explore" }
  | { kind: "calendar" }
  | { kind: "decision"; id: string }
  | { kind: "outcome"; id: string; reviewRevision?: number }
  | { kind: "scheduledGoal"; id: string }
  | { kind: "human"; id: string };
type Section = OutcomeWorkspaceSection;
const SECTIONS: readonly Section[] = ["overview", "all", "inbox", "explore", "calendar"];
const isSection = (kind: string): kind is Section => (SECTIONS as readonly string[]).includes(kind);
const sectionFor = (target: DesktopOutcomeTarget): Section =>
  target.section && isSection(target.section)
    ? target.section
    : target.decisionId
      ? "inbox"
      : target.outcomeId || target.scheduledGoalId
        ? "all"
        : "overview";
const routeFor = (target: DesktopOutcomeTarget): Route =>
  target.scheduledGoalId
    ? { kind: "scheduledGoal", id: target.scheduledGoalId }
    : target.decisionId
      ? { kind: "decision", id: target.decisionId }
      : target.outcomeId
        ? { kind: "outcome", id: target.outcomeId }
        : { kind: sectionFor(target) };
export default function OutcomeWorkspace({
  target,
  onClose,
  bots,
  onOpenChannel,
  onOpenRoutine,
}: {
  target: DesktopOutcomeTarget;
  onClose: () => void;
  bots: OutcomeExecutionBot[];
  /** Opens a channel's conversation, where a request or a channel routine in the activity area leads. */
  onOpenChannel?: (channelId: string) => void;
  onOpenRoutine?: (routineId: string, botId: string) => void;
}) {
  const { t } = useI18n();
  // The owner's choices for the activity area, each falling back to the policy's initial value.
  const policy = resolveTaskPolicy(useFeatureSettings().taskPolicy);
  const [route, setRoute] = useState<Route>(() => routeFor(target));
  const workspace = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openRoute = (next: Route) => {
    if (
      isSection(route.kind) &&
      document.activeElement instanceof HTMLElement
    )
      opener.current = document.activeElement;
    setRoute(next);
  };
  const [version, setVersion] = useState(0);
  const [botId, setBotId] = useState("");
  const [origin, setOrigin] = useState<Section>(() => sectionFor(target));
  const [ideaOpen, setIdeaOpen] = useState(false);
  useEffect(() => {
    setRoute(routeFor(target));
    setOrigin(sectionFor(target));
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
  const openScheduledGoal = (id: string) => openRoute({ kind: "scheduledGoal", id });
  const selectedBotId = bots.some((bot) => bot.id === botId) ? botId : (bots[0]?.id ?? "");
  const tab: Section = isSection(route.kind) ? route.kind : origin;
  const modalOpen = !isSection(route.kind);
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
              setOrigin(tab);
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
              { kind: "overview", label: "Dashboard", icon: LayoutDashboard },
              { kind: "all", label: "All goals", icon: ListChecks },
              { kind: "inbox", label: "Needs attention", icon: Inbox },
              { kind: "explore", label: "Explore ideas", icon: Lightbulb },
              { kind: "calendar", label: "Calendar", icon: CalendarDays },
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
      {tab === "calendar" ? (
        <div className="outcome-calendar-host flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <p className="grid flex-1 place-items-center text-xs text-foreground-secondary" role="status">
                {t("Loading calendar…")}
              </p>
            }
          >
            <CalendarPage
              embedded
              bots={bots}
              onOpenOutcome={(outcomeId) => {
                if (outcomeId) review(outcomeId);
                else {
                  setOrigin("overview");
                  setRoute({ kind: "overview" });
                }
              }}
              onOpenChannel={onOpenChannel}
              onOpenRoutine={
                onOpenRoutine
                  ? (routineId, botId) => {
                      if (botId) onOpenRoutine(routineId, botId);
                    }
                  : undefined
              }
              onOpenScheduledGoal={openScheduledGoal}
            />
          </Suspense>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="outcome-page-content space-y-5">
            {tab === "overview" && (
              <OutcomeDashboard
                outcomes={api.outcomes}
                inbox={api.outcomeInbox}
                bots={bots}
                onSelectOutcome={review}
                onSelectStep={select}
                onShowSteps={() => {
                  setOrigin("inbox");
                  setRoute({ kind: "inbox" });
                }}
                onShowGoals={() => {
                  setOrigin("all");
                  setRoute({ kind: "all" });
                }}
                onCreateGoal={() => openRoute({ kind: "new" })}
                onCreateIdea={() => setIdeaOpen(true)}
                onOpenChannel={onOpenChannel}
                onOpenRoutine={onOpenRoutine}
                onOpenScheduledGoal={openScheduledGoal}
                activityPolicy={{
                  cardMaxItems: policy["activity.cardMaxItems"] as number,
                  dashboardLayout: policy["activity.dashboardLayout"] as string,
                }}
                refreshVersion={version}
              />
            )}
            {tab === "all" && (
              <OutcomeList
                client={api.outcomes}
                bots={bots}
                onSelect={review}
                onCreate={() => openRoute({ kind: "new" })}
                onOpenScheduledGoal={openScheduledGoal}
                refreshVersion={version}
              />
            )}
            {tab === "inbox" && (
              <OutcomeInbox
                client={api.outcomeInbox}
                todos={api.outcomes.todos}
                todoHandoff={
                  api.outcomes.todos
                    ? {
                        bots,
                        client: api.outcomes.todos,
                        goals: api.outcomes,
                        onOpenChannel,
                        onSelectOutcome: review,
                      }
                    : undefined
                }
                onSelect={select}
                refreshVersion={version}
              />
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
      )}
      {ideaOpen && (
        <QuickIdeaDialog
          open
          onOpenChange={setIdeaOpen}
          bots={bots.filter((bot) => bot.status === undefined || bot.status === "active")}
        />
      )}
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
                    : route.kind === "scheduledGoal" ? "Scheduled goal details" : "Goal details"
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("Review the goal and handle current decisions.")}
          </DialogDescription>
          <div className="outcome-page-content outcome-modal-body space-y-5">
            {route.kind === "scheduledGoal" && <ScheduledGoalDetail key={route.id} id={route.id} bots={bots} />}
            {route.kind === "new" &&
              (bots.length > 0 ? (
                <NewOutcomeForm client={api.outcomes} bots={bots} onCreated={() => closeModal()} />
              ) : (
                <p role="status">
                  {t("Create a Bot in chat before planning an Outcome.")}{" "}
                  <button className="underline" onClick={onClose}>
                    {t("Back to chats")}
                  </button>
                </p>
              ))}
            {(route.kind === "decision" || route.kind === "human" || route.kind === "outcome") && (
              <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
                <OutcomeRouteView route={route} bots={bots} onOpen={openRoute} onClose={closeModal} />
              </Suspense>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
