import { useEffect, useRef, useState } from "react";
import { ChevronDown, MessagesSquare } from "lucide-react";
import type { OutcomeDetail } from "@outcomego/contracts/outcomes";
import type { OutcomeClient } from "../../../client/outcome-api";
import { useI18n } from "../../../lib/i18n";
import { MessageResponse } from "../../ai-elements/message";
import { OutcomeButton } from "./outcome-ui";

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

export function OutcomeExecutionCard({
  outcome,
  client,
}: {
  outcome: OutcomeDetail;
  client: Pick<OutcomeClient, "transcript">;
}) {
  const { t } = useI18n();
  const items = outcome.workItems.filter(
    (item) =>
      item.contractRevision === outcome.currentRevision &&
      item.executorType === "agent" &&
      item.rootRunId
  );
  const [selected, setSelected] = useState("");
  const current =
    items.find((item) => item.id === selected) ??
    items.find((item) => item.status === "running") ??
    items.at(-1);
  const [open, setOpen] = useState(false);
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
  if (!current) return null;
  const visible = state?.key === key ? state : undefined;
  return (
    <details
      className="outcome-execution-card"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <MessagesSquare size={15} aria-hidden="true" />
        <span>{t("Execution messages")}</span>
        <span className="outcome-execution-readonly">{t("Read-only")}</span>
        <ChevronDown size={13} className="outcome-execution-chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div className="outcome-execution-body">
          <p className="outcome-execution-note">
            {t("Follow visible messages and tool activity without interrupting the Bot.")}
          </p>
          <div className="outcome-execution-toolbar">
            {items.length > 1 ? (
              <select
                aria-label={t("Execution task")}
                className="outcome-control"
                value={current.id}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setBefore(undefined);
                }}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            ) : (
              <span>{current.title}</span>
            )}
            <OutcomeButton variant="ghost" onClick={() => setRetry((value) => value + 1)}>
              {t("Refresh")}
            </OutcomeButton>
          </div>
          {visible?.error && (
            <p role="alert">{t("Could not load execution messages. Refresh to try again.")}</p>
          )}
          {!visible && <p role="status">{t("Loading execution messages…")}</p>}
          {visible?.page && (
            <>
              <div className="outcome-execution-paging">
                {visible.page.next_before !== null && (
                  <OutcomeButton
                    variant="ghost"
                    onClick={() => setBefore(visible.page!.next_before!)}
                  >
                    {t("Earlier messages")}
                  </OutcomeButton>
                )}
                {before !== undefined && (
                  <OutcomeButton variant="ghost" onClick={() => setBefore(undefined)}>
                    {t("Latest messages")}
                  </OutcomeButton>
                )}
              </div>
              {visible.page.rows.length === 0 && <p>{t("No visible execution messages yet.")}</p>}
              <ol className="outcome-execution-messages" aria-label={t("Execution messages")}>
                {[...visible.page.rows].reverse().map((row) => (
                  <li key={row.id} data-message-role={row.role}>
                    <header>
                      <strong>{t(row.role === "assistant" ? "Bot" : "Tool activity")}</strong>
                      <span>{t(row.status)}</span>
                      <time dateTime={row.at}>
                        {Number.isNaN(Date.parse(row.at))
                          ? ""
                          : new Date(row.at).toLocaleTimeString()}
                      </time>
                    </header>
                    {row.role === "assistant" ? (
                      <MessageResponse>{row.content}</MessageResponse>
                    ) : (
                      <details className="outcome-execution-tool">
                        <summary>{t("View tool activity")}</summary>
                        <pre>{toolText(row.content, t("Private tool details are omitted."))}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </details>
  );
}
