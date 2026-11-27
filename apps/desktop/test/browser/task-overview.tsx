import { useLayoutEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HumanWorkItemDetail } from "@outcomego/contracts/human-work";
import type { OutcomeDetail as Detail, WorkItemView } from "@outcomego/contracts/outcomes";
import type { ActivityItem, NeedsMeItem } from "@outcomego/contracts/task-overview";
import "../../src/renderer/styles.css";
import { api } from "../../src/renderer/client/outcomego-api";
import { OutcomeDashboard } from "../../src/renderer/components/outcomego/outcomes/dashboard/outcome-dashboard";
import { OutcomeDetail } from "../../src/renderer/components/outcomego/outcomes/detail/outcome-detail";
import { HumanAction } from "../../src/renderer/components/outcomego/outcomes/human-work/human-action";
import { SettingsPanel } from "../../src/renderer/components/outcomego/settings/panel";
import { I18nProvider, useI18n } from "../../src/renderer/lib/i18n";
import { TASK_POLICY_FIELDS } from "@outcomego/contracts/task-policy";
import { humanFixture, inboxFixture } from "../outcome-client-fixtures";
import { outcomeFixture } from "../outcome-fixture";

const params = new URLSearchParams(location.search);
if (location.origin !== "https://task-overview.fixture.invalid") {
  throw new Error("Open this fixture with task-overview-runner.ts so every request is intercepted.");
}
const activityThreshold = Number(TASK_POLICY_FIELDS.find((field) => field.key === "activity.cardMaxItems")!.initial);
const settingsTarget = { anchor: "goal-schedule", nonce: 1 } as const;
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");

const now = Date.now();
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
const noop = () => undefined;
const task = (ordinal: number, overrides: Partial<WorkItemView>): WorkItemView => ({
  id: `task-${ordinal}`, contractRevision: 1, executorType: "agent", kind: "initial", title: `Task ${ordinal}`,
  status: "queued", statusReason: null, ordinal, dependsOn: [], rootRunId: null, runIds: [],
  reworkOfWorkItemId: null, startedAt: null, completedAt: null, runSegments: [], createdAt: at(-400),
  updatedAt: at(-10), ...overrides,
});
const first = task(1, {
  status: "completed", startedAt: at(-370), completedAt: at(-220),
  runSegments: [
    { id: "run-a", status: "completed", startedAt: at(-370), completedAt: at(-320) },
    { id: "run-b", status: "completed", startedAt: at(-280), completedAt: at(-220) },
  ],
});
const second = task(2, {
  status: "running", startedAt: at(-200), dependsOn: [first.id], estimateMinutes: 15_000,
  runSegments: [{ id: "run-c", status: "running", startedAt: at(-200), completedAt: null }],
});
const human = task(3, { executorType: "human", kind: "human_action", status: "ready", scheduledAt: at(36), dueAt: at(120) });
const record: Extract<Detail, { kind: "standard" }> = {
  ...outcomeFixture, title: "Fixture Alpha", description: "", status: "running", currentRevisionView: null,
  dueAt: at(220), outputs: [], evidence: [], reviews: [], revisions: [],
  workItems: [first, second, task(4, { dependsOn: [second.id] }), human, task(5, {
    statusReason: "deferred_by_agent", scheduledAt: at(100), startedAt: at(-100),
    runSegments: [{ id: "run-d", status: "completed", startedAt: at(-100), completedAt: at(-60) }],
  })],
};
const activity = (id: number, overrides: Partial<ActivityItem> = {}): ActivityItem => ({
  id: `request:${id}`, type: "request", botId: id % 2 ? "bot-a" : "bot-b", title: `Item ${id}`,
  state: id % 2 ? "in_progress" : "waiting", reason: null, doing: null, progress: null,
  lastActivityAt: at(-id), nextCheckAt: null, needsOwner: false, link: { type: "channel", id: `channel-${id}` },
  ...overrides,
});
const needsMe: NeedsMeItem[] = [{
  key: "request:owner-a", source: "request", botId: "bot-a", title: "Item A", state: "needs_owner", zone: "blocked",
  reason: "<b>Fixture A</b>", since: at(-6), link: { type: "channel", id: "channel-a" },
}, {
  key: "request:owner-b", source: "request", botId: "bot-b", title: "Item B", state: "no_follow_up", zone: "exception",
  reason: "Fixture reason B", since: at(-3), link: { type: "conversation", id: "conversation-b" },
}];
const bots = [{ id: "bot-a", name: "Alpha" }, { id: "bot-b", name: "Beta" }];
const actions = { onSelectOutcome: noop, onSelectStep: noop, onShowSteps: noop, onShowGoals: noop, onCreateGoal: noop, onCreateIdea: noop };
const humanCard: HumanWorkItemDetail = {
  ...humanFixture, id: human.id, title: "Fixture Beta", scheduledAt: at(-30), dueAt: at(-2), overdue: true,
  card: { ...humanFixture.card!, title: "Fixture Beta", purpose: "Fixture description", prerequisites: [], steps: [], inputFields: [], evidenceRequirements: [], references: [], draft: null },
};
const humanClient = { ...api.outcomeInbox, humanItem: async () => humanCard };
const inbox = { ...api.outcomeInbox, list: async () => ({ items: [{ ...inboxFixture, title: "Item C", completed: "", next: "", availableAt: at(-4) }], nextCursor: null }) };

function Fixture() {
  const { setLocale } = useI18n();
  useLayoutEffect(() => setLocale(params.get("lang") === "zh" ? "zh-CN" : "en-US"), []);
  const [detail, setDetail] = useState(record);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [openedChannel, setOpenedChannel] = useState("");
  const [writes, setWrites] = useState(0);
  const clients = useMemo(() => ({
    ...api.outcomes,
    get: async () => detail,
    thread: undefined,
    setWorkItemSchedule: async (_id: string, workItemId: string, patch: Partial<WorkItemView>) => {
      if (params.has("refuse")) throw new Error("Fixture refused the date");
      const changed = { ...detail, workItems: detail.workItems.map((item) => item.id === workItemId ? { ...item, ...patch } : item) };
      setDetail(changed);
      setWrites((value) => value + 1);
      return changed;
    },
    setDue: async (_id: string, patch: { dueAt: string | null }) => {
      const changed = { ...detail, dueAt: patch.dueAt };
      setDetail(changed);
      setWrites((value) => value + 1);
      return changed;
    },
    list: async () => ({ items: [detail, { ...detail, id: "outcome-2", title: "Fixture Beta", status: "failed" as const }], nextCursor: null }),
    activity: async (input?: { includeAll?: boolean }) => ({
      truncated: false,
      items: input?.includeAll ? Array.from({ length: activityThreshold + 1 }, (_, index) => activity(index + 1)) : [
        activity(1, { doing: "<strong>Fixture text A</strong>" }), activity(2, { reason: "Fixture text B" }),
      ],
    }),
    needsMe: async () => ({ items: needsMe }),
  }), [detail]);
  const page = params.get("page");
  return (
    <main className="h-dvh overflow-auto bg-background p-4 text-foreground" data-writes={writes} data-channel={openedChannel}>
      {page === "settings" ? <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} target={settingsTarget} />
        : page === "dashboard" ? <OutcomeDashboard outcomes={clients} inbox={inbox} bots={bots} {...actions} onOpenChannel={setOpenedChannel} />
          : page === "human" ? <HumanAction workItemId={human.id} client={humanClient} materials={api.humanMaterials} upload={async () => ({ assetRef: "asset:fixture" })} onReview={noop} />
            : <OutcomeDetail outcomeId={detail.id} client={clients} initialOutcome={record} bots={bots} />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
