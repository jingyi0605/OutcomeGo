import type { BotView, ChannelMessageView, ChannelView } from "@outcomego/contracts";
import { emptySidebarPreferences } from "@outcomego/contracts/client-preferences";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { OutcomeWorkThreadView } from "@outcomego/contracts/outcomes";
import { OutcomeExecutionDialog } from "../../src/renderer/components/outcomego/outcomes/outcome-execution-card";
import { I18nProvider } from "../../src/renderer/lib/i18n";
import { ChatBranchNavigation, WorkThreadNavigation } from "../../src/renderer/lib/work-thread-navigation";
import "../../src/renderer/styles.css";
import { Inspector } from "../../src/renderer/components/outcomego/inspector";
import { api } from "../../src/renderer/client/outcomego-api";
import { Sidebar } from "../../src/renderer/components/outcomego/sidebar";
import { TooltipProvider } from "../../src/renderer/components/ui/tooltip";
import { useSidebarPreferences } from "../../src/renderer/hooks/use-sidebar-preferences";

// Synthetic roster only: never connect to a user's server or desktop bridge.
window.fetch = async () => {
  throw new Error("Network disabled in sidebar fixture");
};
Object.assign(api, { routines: async () => [] });
const params = new URLSearchParams(location.search);
const workThreads = params.has("work-threads");
if (workThreads) {
  Object.assign(api, {
    chatBranches: async (channelId: string, query: { archived: boolean }) => ({
      items: channelId === "channel-0" ? [{
        id: query.archived ? "old-chat" : "recent-chat",
        messageId: query.archived ? "old-chat-reply" : "recent-chat-reply",
        title: query.archived ? "Archived chat branch" : "Ordinary chat branch",
        updatedAt: "2026-01-01T00:00:00Z",
      }] : [],
      nextBefore: null,
    }),
  });
  const recent = { id: "recent", outcomeId: "goal", outcomeTitle: "Capacity audit", botId: "bot-0", title: "Recent task", status: "running", completedAt: null } as const;
  const archived = { ...recent, id: "archived", title: "Old task", status: "completed", completedAt: "2026-01-01T00:00:00Z" } as const;
  Object.assign(api.outcomes, {
    workThreads: async (botId: string, query: { archived?: boolean }) => {
      window.dispatchEvent(new CustomEvent("work-thread-read", { detail: query.archived ? "archived" : "recent" }));
      return { items: botId === "bot-0" ? [query.archived ? archived : recent] : [], nextCursor: null };
    },
    transcript: async (_outcomeId: string, id: string) => ({
      next_before: null, workItemStatus: "completed",
      rows: [{ id, at: "2026-01-01T00:00:00Z", role: "assistant", status: "completed", content: `Task reply: ${id}` }],
    }),
  });
}
const count = Number(params.get("count") ?? 40);
localStorage.setItem(
  "outcomego:sidebar-preferences",
  JSON.stringify({
    ...emptySidebarPreferences(),
    unreadIds: params.has("read") ? [] : ["channel-2", `channel-${count - 2}`],
  })
);
const channels = Array.from({ length: count }, (_, index) => {
  const date = new Date();
  date.setDate(date.getDate() - index);
  return {
    id: `channel-${index}`,
    name: index === 0 ? "Parity Probe v3" : `Memory Scope ${index}`,
    kind: index === 1 || index === 4 || index === 5 ? "group" : "bot_dm",
    members:
      index === 5
        ? []
        : index === 1
          ? [{ botId: `bot-${index}` }, { botId: `bot-${index + 1}` }]
          : [{ botId: `bot-${index}` }],
    createdAt: date.toISOString(),
    updatedAt: date.toISOString(),
  } as ChannelView;
});
const bots = new Map(
  channels.map((channel, index) => [
    `bot-${index}`,
    {
      id: `bot-${index}`,
      name: channel.name,
      icon: ["hex-visor", "pod", "classic", "terminal"][index % 4],
      color: "#4b8efb",
      status: "active",
      dmChannelId: channel.id,
      conversationId: `conversation-${index}`,
      title: "", description: "",
      notificationsEnabled: true, draftingDisabled: false, draftAllowedRecipients: [],
    } as BotView,
  ])
);
const latest = new Map(
  channels
    .filter((_, index) => index !== 3)
    .map((channel) => [
      channel.id,
      {
        id: `message-${channel.id}`,
        channelId: channel.id,
        content: "Got it: alpha, beta, and Gamma.",
        createdAt: channel.createdAt,
        senderKind: "bot",
        attachments: [],
      } as unknown as ChannelMessageView,
    ])
);
const noop = () => {};
function Fixture() {
  const preferences = useSidebarPreferences();
  const [thread, setThread] = useState<OutcomeWorkThreadView | null>(null);
  const [branchMessage, setBranchMessage] = useState<string>();
  if (params.has("settings")) return (
    <TooltipProvider>
      <div style={{ width: 420, height: "100vh" }}>
        <Inspector channel={channels[0]!} botById={bots} active screenEnabled={false} mode="settings"
          onEnableScreen={noop} onModeChange={noop} onUpdateBot={async () => bots.get("bot-0")!}
          onRetryBot={async () => {}} onOutcomeGo={noop} onSetGroupAvatar={async () => {}}
          onSetGroupNotificationMute={async () => {}}
          onSetMembers={async () => {}} onUpdateGroupProfile={async () => channels[0]!}
          onBotAction={noop} />
      </div>
    </TooltipProvider>
  );
  return (
    <TooltipProvider>
      <ChatBranchNavigation.Provider value={workThreads ? (_channelId, messageId) => { setThread(null); setBranchMessage(messageId); } : null}>
      <WorkThreadNavigation.Provider value={workThreads ? setThread : null}>
      <div style={{ display: "flex", height: "100vh" }}>
        <Sidebar
          channels={channels}
          botById={bots}
          latestMessageByChannel={latest}
          activeRunByChannel={new Map()}
          activeTaskChannelIds={new Set()}
          activeThreadChannelIds={workThreads ? new Set(["channel-0"]) : new Set()}
          selectedId="channel-0"
          preferences={preferences}
          onPreloadSearch={noop}
          onSearch={noop}
          onSelect={noop}
          onNewBot={noop}
          onOpenPlugins={noop}
          onOpenSettings={noop}
          onBotAction={noop}
          onDeleteChannel={noop}
          onEditChannel={noop}
        />
        {workThreads && (thread ? (
          <OutcomeExecutionDialog key={thread.id} thread={thread} bot={bots.get(thread.botId)} client={api.outcomes} open onOpenChange={() => setThread(null)} />
        ) : <p>{branchMessage ? `Selected chat branch: ${branchMessage}` : "Main conversation only"}</p>)}
      </div>
      </WorkThreadNavigation.Provider>
      </ChatBranchNavigation.Provider>
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
