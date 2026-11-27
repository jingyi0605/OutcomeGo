import type { AssetRef } from "@outcomego/contracts";
import { attachmentSizeRejection } from "@outcomego/contracts/media-input";
import { FileText, X } from "lucide-react";
import { type ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { OutcomeClient, OutcomePlanned } from "../../../../client/outcome-api";
import { api } from "../../../../client/outcomego-api";
import { mentionHandleFor, type MentionOption } from "../../../../lib/mentions";
import { useI18n } from "../../../../lib/i18n";
import { MentionEditor } from "../../mention-editor";
import { OutcomeButton } from "../outcome-button";
import { OutcomeRequestIds, outcomeErrorMessage } from "../planning/outcome-client";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import { quickIdeaDraft } from "./go-intake-draft";

const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

type PendingFile = { id: string; file: File; fileName: string; preview?: string };

const pastedFileName = (file: File) => {
  const existing = file.name.trim();
  if (existing) return existing;
  const subtype = file.type.startsWith("image/") ? file.type.slice("image/".length).split("+")[0] : "";
  return subtype ? `pasted-image.${subtype}` : "Attachment";
};

const clipboardFiles = (data: DataTransfer | null): File[] => {
  if (!data) return [];
  const direct = [...data.files];
  if (direct.length > 0) return direct;
  const fromItems: File[] = [];
  for (const item of [...(data.items ?? [])]) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return fromItems;
};

/** The shared Go capture surface. It stores the owner's words as an intake note before triage. */
export function GoIntakeForm({
  client,
  bots,
  onCompleted,
  onError,
  onCancel,
}: {
  client: Pick<OutcomeClient, "intake">;
  bots: readonly OutcomeExecutionBot[];
  onCompleted?: (result: OutcomePlanned) => void;
  onError?: (error: unknown) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ids = useRef(new OutcomeRequestIds());
  const inFlight = useRef(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const filesRef = useRef<PendingFile[]>(files);
  filesRef.current = files;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      for (const item of filesRef.current) if (item.preview) URL.revokeObjectURL(item.preview);
    },
    []
  );
  const options = useMemo<MentionOption[]>(
    () => bots.map((bot) => ({
      id: bot.id,
      label: bot.name,
      handle: mentionHandleFor(bot.name),
      kind: "bot",
      color: bot.color,
      icon: bot.icon,
      hasAvatar: bot.hasAvatar,
      updatedAt: bot.updatedAt,
    })),
    [bots]
  );
  const draft = quickIdeaDraft(text, bots);

  const addFiles = (next: readonly File[]) => {
    if (next.length === 0) return;
    let count = filesRef.current.length;
    let total = filesRef.current.reduce((sum, item) => sum + item.file.size, 0);
    const accepted: PendingFile[] = [];
    let rejected = false;
    for (const file of next) {
      const fileName = pastedFileName(file);
      if (count >= MAX_ATTACHMENTS || total + file.size > MAX_TOTAL_BYTES || attachmentSizeRejection(fileName, file.size)) {
        rejected = true;
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        fileName,
        ...(file.type.startsWith("image/") ? { preview: URL.createObjectURL(file) } : {}),
      });
      count++;
      total += file.size;
    }
    if (accepted.length > 0) setFiles((current) => [...current, ...accepted]);
    if (rejected) {
      setError("Some files could not be attached. Check file size and the 10-file limit.");
    } else if (accepted.length > 0) {
      setError(null);
    }
  };
  const removeFile = (id: string) => setFiles((current) => {
    const removed = current.find((item) => item.id === id);
    if (removed?.preview) URL.revokeObjectURL(removed.preview);
    return current.filter((item) => item.id !== id);
  });
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pasted = clipboardFiles(event.clipboardData);
    if (pasted.length === 0) return;
    event.preventDefault();
    addFiles(pasted);
  };

  async function submit() {
    if ((!draft && files.length === 0) || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const botId = draft?.botId ?? undefined;
    const input = { text: draft ? [draft.title, draft.note].filter(Boolean).join("\n\n") : undefined, botId };
    const requestId = ids.current.for("intake", { ...input, files: files.map((item) => `${item.fileName}:${item.file.size}`) });
    try {
      const attachments: AssetRef[] = [];
      for (const item of files) attachments.push(await api.uploadAsset(item.file, item.fileName, item.file.type));
      const planned = await client.intake({ ...input, ...(attachments.length > 0 ? { attachments } : {}), clientRequestId: requestId });
      ids.current.complete("intake");
      onCompleted?.(planned);
    } catch (cause) {
      setError(outcomeErrorMessage(cause));
      onError?.(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      className="outcome-quick-idea space-y-3"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); addFiles([...event.dataTransfer.files]); }}
    >
      <div
        className="rounded-xl bg-field px-3 py-2.5 shadow-[inset_0_0_0_0.5px_var(--input)] focus-within:shadow-[inset_0_0_0_0.5px_var(--ring)]"
        onClick={() => editorRef.current?.focus()}
      >
        <MentionEditor
          className="max-h-60 min-h-[88px] w-full overflow-y-auto bg-transparent text-[14px] leading-6 outline-none"
          disabled={busy}
          editorRef={editorRef}
          onChange={setText}
          onEscape={onCancel}
          onPaste={handlePaste}
          onSubmit={() => void submit()}
          options={options}
          placeholder={t("Write anything. Type @ to choose a Bot, or paste an image/file.")}
          value={text}
        />
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={t("Attachments") }>
          {files.map((item) => (
            <div className="relative flex items-center gap-1 rounded-md bg-subtle px-2 py-1 text-xs" key={item.id}>
              {item.preview ? <img alt="" className="size-8 rounded object-cover" src={item.preview} /> : <FileText aria-hidden className="size-4" />}
              <span className="max-w-40 truncate">{item.fileName}</span>
              <button type="button" aria-label={t("Remove attachment")} onClick={() => removeFile(item.id)} disabled={busy}><X className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInputRef} className="hidden" type="file" multiple onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = ""; }} />
      {error && <p role="alert" className="text-xs text-destructive">{t(error)}</p>}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <OutcomeButton type="button" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={busy}>{t("Add files")}</OutcomeButton>
          <span className="text-xs text-foreground-secondary">{t("Go sends it to the Outcome inbox for sorting.")}</span>
        </div>
        <OutcomeButton variant="default" type="submit" disabled={busy || (!draft && files.length === 0)}>{t("Go")}</OutcomeButton>
      </div>
    </form>
  );
}
