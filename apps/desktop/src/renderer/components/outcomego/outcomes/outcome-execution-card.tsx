import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, LockKeyhole, MessagesSquare } from "lucide-react";
import type { BotView } from "@outcomego/contracts";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../client/outcome-api";
import { useI18n } from "../../../lib/i18n";
import { MessageResponse } from "../../ai-elements/message";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../ui/dialog";
import { OutcomeButton } from "./outcome-ui";

// The avatar pulls in authenticated image loading; load it only once a conversation is opened.
const BotAvatar = lazy(() => import("../avatar").then((module) => ({ default: module.BotAvatar })));
function ExecutionAvatar({ bot }: { bot?: Parameters<typeof BotAvatar>[0]["bot"] }) {
  return (
    <Suspense fallback={<span aria-hidden="true" className="size-[22px] shrink-0" />}>
      <BotAvatar bot={bot} size="sm" />
    </Suspense>
  );
}

/** Bot identity used only for display; avatar fields are optional so name-only lists still work. */
export type OutcomeExecutionBot = { id: string; name: string } & Partial<
  Pick<BotView, "color" | "icon" | "hasAvatar" | "updatedAt">
>;

type TranscriptRow = {
  id: string;
  at: string;
  role: string;
  status: string;
  content: string;
};
type TranscriptPage = { rows: TranscriptRow[]; next_before: number | null };

function transcriptPage(value: unknown): TranscriptPage {
  const page = value as TranscriptPage | null;
  if (
    !page ||
    !Array.isArray(page.rows) ||
    !(page.next_before === null || (Number.isInteger(page.next_before) && page.next_before >= 0)) ||
    !page.rows.every((row) =>
      ["id", "at", "role", "status", "content"].every(
        (key) => typeof row?.[key as keyof TranscriptRow] === "string"
      )
    )
  )
    throw new Error("Invalid Outcome transcript");
  // Run-level user rows include scheduler and execution instructions, not chat replies.
  return {
    ...page,
    rows: page.rows.filter((row) =>
      ["assistant", "tool", "command", "file_change"].includes(row.role)
    ),
  };
}

/** Tool rows are already redacted by the server; expose only its observable projection. */
function toolText(content: string, omitted: string) {
  try {
    const value = JSON.parse(content);
    return [
      typeof value.tool === "string" ? value.tool : "",
      typeof value.command === "string" ? value.command : "",
      typeof value.output === "string" ? value.output : omitted,
    ]
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return content;
  }
}

/** Agent tasks of the current revision that have a Run whose messages can be observed. */
export function observableWorkItems(outcome: OutcomeDetail) {
  return outcome.workItems.filter(
    (item) =>
      item.contractRevision === outcome.currentRevision &&
      item.executorType === "agent" &&
      item.rootRunId
  );
}

/**
 * Read-only conversation with the execution Bot, shaped like the Bot-to-Bot view-only chat.
 * It only issues GET requests and has no composer, so it can never steer or interrupt a Run.
 */
export function OutcomeExecutionDialog({
  outcome,
  client,
  bot,
  open,
  onOpenChange,
}: {
  outcome: OutcomeDetail;
  client: Pick<OutcomeClient, "transcript">;
  bot?: OutcomeExecutionBot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const items = observableWorkItems(outcome);
  const [selected, setSelected] = useState("");
  const current =
    items.find((item) => item.id === selected) ??
    items.find((item) => item.status === "running") ??
    items.at(-1);
  const [before, setBefore] = useState<number>();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    page?: TranscriptPage;
    error?: boolean;
  }>();
  const key = `${outcome.id}:${current?.id}:${before ?? "latest"}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const running = current?.status === "running" || current?.status === "queued";
  useEffect(() => {
    if (!open || !current) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const page = transcriptPage(await client.transcript(outcome.id, current!.id, { before }));
        if (active && keyRef.current === key) setState({ key, page });
      } catch {
        if (active && keyRef.current === key)
          setState((previous) => ({
            key,
            page: previous?.key === key ? previous.page : undefined,
            error: true,
          }));
      }
      if (active && running && before === undefined) timer = setTimeout(read, 5_000);
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, key, retry, client.transcript, running]);
  const visible = state?.key === key ? state : undefined;

  // Follow the newest message like a chat, unless the reader scrolled up to look at history.
  const scroller = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const newest = visible?.page?.rows[0]?.id;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stickToEnd.current) element.scrollTop = element.scrollHeight;
  }, [key, newest, visible?.page?.rows.length]);

  const botName = bot?.name ?? t("Bot");
  // Name-only Bots fall back to the default robot avatar.
  const avatarBot =
    bot && bot.color !== undefined && bot.icon !== undefined
      ? { ...bot, color: bot.color, icon: bot.icon }
      : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="outcome-execution-dialog"
        overlayClassName="outcome-modal-overlay"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("Execution messages")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("Follow visible messages and tool activity without interrupting the Bot.")}
        </DialogDescription>
        <header className="outcome-execution-header">
          <ExecutionAvatar bot={avatarBot} />
          <div className="outcome-execution-heading">
            <strong>{botName}</strong>
            <span>{outcome.title}</span>
          </div>
          {items.length > 1 ? (
            <select
              aria-label={t("Execution task")}
              className="outcome-control"
              value={current?.id}
              onChange={(event) => {
                setSelected(event.target.value);
                setBefore(undefined);
                stickToEnd.current = true;
              }}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          ) : (
            current && <span className="outcome-execution-task">{current.title}</span>
          )}
          <OutcomeButton variant="ghost" onClick={() => setRetry((value) => value + 1)}>
            {t("Refresh")}
          </OutcomeButton>
        </header>
        <div
          ref={scroller}
          className="outcome-execution-scroll"
          onScroll={(event) => {
            const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
            stickToEnd.current = scrollHeight - scrollTop - clientHeight < 48;
          }}
        >
          {!current && <p role="status">{t("No visible execution messages yet.")}</p>}
          {visible?.error && (
            <p role="alert">{t("Could not load execution messages. Refresh to try again.")}</p>
          )}
          {current && !visible && <p role="status">{t("Loading execution messages…")}</p>}
          {visible?.page && (
            <>
              <div className="outcome-execution-paging">
                {visible.page.next_before !== null && (
                  <OutcomeButton
                    variant="ghost"
                    onClick={() => {
                      stickToEnd.current = false;
                      setBefore(visible.page!.next_before!);
                    }}
                  >
                    {t("Earlier messages")}
                  </OutcomeButton>
                )}
                {before !== undefined && (
                  <OutcomeButton
                    variant="ghost"
                    onClick={() => {
                      stickToEnd.current = true;
                      setBefore(undefined);
                    }}
                  >
                    {t("Latest messages")}
                  </OutcomeButton>
                )}
              </div>
              {visible.page.rows.length === 0 && <p>{t("No visible execution messages yet.")}</p>}
              <ol className="outcome-execution-messages" aria-label={t("Execution messages")}>
                {[...visible.page.rows].reverse().map((row) => (
                  <li key={row.id} data-message-role={row.role}>
                    {row.role === "assistant" ? (
                      <>
                        <ExecutionAvatar bot={avatarBot} />
                        <div className="outcome-execution-bubble">
                          <MessageResponse>{row.content}</MessageResponse>
                        </div>
                      </>
                    ) : (
                      <details className="outcome-execution-tool">
                        <summary>{t("View tool activity")}</summary>
                        <pre>{toolText(row.content, t("Private tool details are omitted."))}</pre>
                      </details>
                    )}
                    <footer>
                      <strong>{t(row.role === "assistant" ? "Bot" : "Tool activity")}</strong>
                      <span>{t(row.status)}</span>
                      <time dateTime={row.at}>
                        {Number.isNaN(Date.parse(row.at))
                          ? ""
                          : new Date(row.at).toLocaleTimeString()}
                      </time>
                    </footer>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
        <footer className="outcome-execution-footer">
          <LockKeyhole aria-hidden="true" className="size-3.5" />
          <span>{t("This chat is view-only")}</span>
          <OutcomeButton onClick={() => onOpenChange(false)}>{t("Close Chat")}</OutcomeButton>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** Compact entry that keeps the card short and opens the full read-only conversation. */
export function OutcomeExecutionCard({
  outcome,
  client,
  bot,
}: {
  outcome: OutcomeDetail;
  client: Pick<OutcomeClient, "transcript">;
  bot?: OutcomeExecutionBot;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (observableWorkItems(outcome).length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="outcome-execution-card"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <MessagesSquare size={15} aria-hidden="true" />
        <span>{t("Execution messages")}</span>
        <span className="outcome-execution-readonly">{t("Read-only")}</span>
        <ChevronRight size={13} className="outcome-execution-chevron" aria-hidden="true" />
      </button>
      {open && (
        <OutcomeExecutionDialog
          outcome={outcome}
          client={client}
          bot={bot}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

/**
 * List-row entry: the list only holds summaries, so the goal is read when the viewer is opened.
 * Reads are GET-only and never change the goal, its Run or any decision.
 */
export function OutcomeExecutionListAction({
  outcomeId,
  title,
  client,
  bot,
}: {
  outcomeId: string;
  title: string;
  client: Pick<OutcomeClient, "get" | "transcript">;
  bot?: OutcomeExecutionBot;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<OutcomeDetail>();
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    if (!open) return;
    const id = ++request.current;
    setFailed(false);
    client
      .get(outcomeId)
      .then((value) => request.current === id && setDetail(value))
      .catch(() => request.current === id && setFailed(true));
    return () => {
      request.current++;
    };
  }, [open, outcomeId, client]);
  const label = `${t("Execution messages")} · ${title}`;
  return (
    <>
      <OutcomeButton
        className="outcome-row-action"
        variant="ghost"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <MessagesSquare aria-hidden="true" className="size-3.5" />
        {t("Execution messages")}
      </OutcomeButton>
      {open && detail && (
        <OutcomeExecutionDialog
          outcome={detail}
          client={client}
          bot={bot}
          open
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
              setDetail(undefined);
            }
          }}
        />
      )}
      {open && !detail && (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent
            className="outcome-execution-dialog outcome-execution-dialog-loading"
            overlayClassName="outcome-modal-overlay"
          >
            <DialogTitle className="sr-only">{t("Execution messages")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("Follow visible messages and tool activity without interrupting the Bot.")}
            </DialogDescription>
            <p role={failed ? "alert" : "status"}>
              {failed
                ? t("Could not load execution messages. Refresh to try again.")
                : t("Loading execution messages…")}
            </p>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
