import type { ChannelView } from "@outcomego/contracts";
import { workThreadCanStop, type OutcomeWorkThreadView } from "@outcomego/contracts/outcomes";
import { Archive, ChevronRight, MessagesSquare, Square } from "lucide-react";
import { outcomeErrorMessage } from "./outcomes/planning/outcome-client";
import { type CSSProperties, useContext, useEffect, useState } from "react";
import { api } from "../../client/outcomego-api";
import { cn } from "../../lib/cn";
import { useI18n } from "../../lib/i18n";
import { ChatBranchNavigation, WorkThreadNavigation } from "../../lib/work-thread-navigation";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

type BranchItem = { id: string; messageId: string; title: string; updatedAt: string; running?: boolean };
type ThreadEntry = { kind: "chat"; branch: BranchItem } | { kind: "outcome"; thread: OutcomeWorkThreadView };
const entryKey = (entry: ThreadEntry) => entry.kind === "chat" ? `chat:${entry.branch.id}` : `outcome:${entry.thread.id}`;

function ThreadList({ channelId, botId, archived, onSelect }: {
  channelId: string;
  botId: string;
  archived: boolean;
  onSelect: (entry: ThreadEntry) => void;
}) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<ThreadEntry[]>();
  const [cursors, setCursors] = useState<{ chat: string | null; outcome: string | null }>();
  const [requested, setRequested] = useState<typeof cursors>();
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(false);
  const [stop, setStop] = useState<{ entry: ThreadEntry; busy: boolean; error?: string }>();
  async function stopThread() {
    if (!stop || stop.busy) return;
    const { entry } = stop;
    setStop({ entry, busy: true });
    try {
      if (entry.kind === "chat") await api.stopChatBranch(channelId, entry.branch.id);
      else await api.outcomes.stopWorkThread!(entry.thread.outcomeId, entry.thread.id);
      setStop(undefined);
      setRequested(undefined);
      setRetry(n => n + 1);
    } catch (error) {
      setStop({ entry, busy: false, error: outcomeErrorMessage(error) });
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const [chat, outcome] = await Promise.allSettled([
        requested?.chat === null ? null : api.chatBranches(channelId, { archived, before: requested?.chat, signal }),
        requested?.outcome === null ? null : api.outcomes.workThreads?.(botId, { archived, cursor: requested?.outcome, signal }),
      ]);
      if (signal.aborted) return;
      const chatPage = chat.status === "fulfilled" ? chat.value : null;
      const outcomePage = outcome.status === "fulfilled" ? outcome.value : null;
      setError(chat.status === "rejected" || outcome.status === "rejected");
      const nextItems: ThreadEntry[] = [
        ...(chatPage?.items.map((branch): ThreadEntry => ({ kind: "chat", branch })) ?? []),
        ...(outcomePage?.items.map((thread): ThreadEntry => ({ kind: "outcome", thread })) ?? []),
      ];
      setItems((previous) => requested
        ? [...new Map([...(previous ?? []), ...nextItems].map((entry) => [entryKey(entry), entry])).values()]
        : nextItems);
      setCursors({ chat: chatPage?.nextBefore ?? null, outcome: outcomePage?.nextCursor ?? null });
      if (!archived && !requested) timer = setTimeout(refresh, 15_000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [channelId, botId, archived, requested, retry]);
  return (
    <>
      {stop && (
        <section aria-label={t("Force end thread")} className="space-y-2 border-b border-border px-2 py-2">
          <p className="text-xs">{t("Stop this thread? Other conversations will continue.")}</p>
          {stop.error && <p role="alert" className="text-xs text-destructive">{t(stop.error)}</p>}
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={stop.busy} onClick={() => setStop(undefined)}>{t("Cancel")}</Button>
            <Button type="button" variant="destructive" size="sm" disabled={stop.busy} onClick={() => void stopThread()}>{t("Force end thread")}</Button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
          {t("Could not load all conversation threads.")} <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>{t("Retry")}</button>
        </p>
      )}
      {!items ? (
        <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">{t("Loading conversation threads…")}</p>
      ) : items.length === 0 && !error ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{t(archived ? "No archived threads" : "No recent conversation threads")}</p>
      ) : null}
      {items && items.length > 0 && (
        <ul className="space-y-0.5">
          {items.map((entry) => {
            const title = entry.kind === "chat" ? entry.branch.title.trim() || t("Chat branch") : entry.thread.title;
            const subtitle = entry.kind === "chat"
              ? `${t("Chat branch")} · ${new Date(entry.branch.updatedAt).toLocaleString(locale)}`
              : `${entry.thread.outcomeTitle} · ${t(entry.thread.waitingOnDependency ? "Waiting for the previous task" : entry.thread.status)}`;
            const canStop = entry.kind === "chat" ? entry.branch.running : workThreadCanStop(entry.thread) && Boolean(api.outcomes.stopWorkThread);
            return (
              <li key={entryKey(entry)} className="flex items-center gap-1">
                <Button type="button" variant="ghost" className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 text-left" onClick={() => onSelect(entry)}>
                  <MessagesSquare aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]" title={title}>{title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
                {canStop && (
                  <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" title={t("Force end thread")} aria-label={`${t("Force end thread")}: ${title}`} disabled={stop?.busy} onClick={() => setStop({ entry, busy: false })}>
                    <Square aria-hidden="true" className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(cursors?.chat || cursors?.outcome) && (
        <Button type="button" variant="ghost" size="sm" disabled={requested === cursors} onClick={() => setRequested(cursors)}>{t("Load more")}</Button>
      )}
    </>
  );
}

/** A sibling of the main conversation button, positioned over its avatar. */
export function WorkThreadAvatarTrigger({
  active = false,
  channel,
  className,
  onOpenMain,
  ringColor = "var(--sidebar)",
  size = "md",
}: {
  active?: boolean;
  channel: ChannelView;
  className: string;
  onOpenMain?: () => void;
  ringColor?: string;
  size?: "md" | "pin";
}) {
  const openWorkThread = useContext(WorkThreadNavigation);
  const openChatBranch = useContext(ChatBranchNavigation);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [archived, setArchived] = useState(false);
  const botId = channel.kind === "bot_dm" ? channel.members[0]?.botId : undefined;
  if ((!openWorkThread && !openChatBranch) || !botId || (!active && !open)) return null;
  const label = t("Conversation threads for {name}", { name: channel.name });
  const toggle = (next: boolean) => { setOpen(next); if (!next) setArchived(false); };
  const select = (entry: ThreadEntry) => {
    toggle(false);
    if (entry.kind === "chat") openChatBranch?.(channel.id, entry.branch.messageId);
    else openWorkThread?.(entry.thread);
  };
  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-work-thread-trigger=""
          style={{ "--thread-dot-ring": ringColor } as CSSProperties}
          className={cn(
            "group absolute z-[15] rounded-full outline-none hover:ring-2 hover:ring-ring/30 focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <span
            aria-hidden="true"
            data-work-thread-dot=""
            className={cn(
              "sidebar-status-reveal pointer-events-none absolute bottom-0.5 left-0.5 block rounded-full bg-[#ff9f0a] transition-transform duration-150 group-hover:scale-125 group-aria-expanded:scale-125 dark:bg-[#ffb020]",
              size === "pin"
                ? "size-2.5 shadow-[0_0_0_3.333px_var(--thread-dot-ring,var(--sidebar))]"
                : "size-2 shadow-[0_0_0_2px_var(--thread-dot-ring,var(--sidebar))]"
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} aria-label={label} className="bot-scrollbar max-h-[min(420px,var(--radix-popover-content-available-height))] w-[300px] max-w-[calc(100vw-80px)] overflow-y-auto rounded-xl p-2">
        <div className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">{label}</div>
        {onOpenMain && (
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start px-2" onClick={() => { toggle(false); onOpenMain(); }}>
            {t("Main chat")}
          </Button>
        )}
        <ThreadList channelId={channel.id} botId={botId} archived={false} onSelect={select} />
        <Button type="button" variant="ghost" size="sm" className="mt-1 w-full justify-start px-2" aria-expanded={archived} onClick={() => setArchived((value) => !value)}>
          <Archive aria-hidden="true" className="size-4" /> {t("Archived threads")}
        </Button>
        {archived && <ThreadList channelId={channel.id} botId={botId} archived onSelect={select} />}
      </PopoverContent>
    </Popover>
  );
}
