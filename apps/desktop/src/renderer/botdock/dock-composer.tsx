import { attachmentSizeRejection } from "@outcomego/contracts/media-input";
import { normalizeRobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import { FileText } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BotAvatarGlyph } from "../components/outcomego/avatar-picker-icons";
import {
  activeMention,
  composeMessage,
  composeTarget,
  filterComposeBots,
  removeMention,
} from "../lib/bot-dock-compose";
import type { BotDockRosterView, BotDockStateView } from "../lib/bot-dock-state";
import type { BotDockBridge, DockFile } from "./types";

const INPUT_MAX_HEIGHT = 140;
/** Mirror BOT_DOCK_MAX_ATTACHMENTS and BOT_DOCK_MAX_TOTAL_BYTES in the main process, which
 * enforces them. */
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export async function forwardDockFiles(bridge: BotDockBridge, files: readonly File[]) {
  const accepted: DockFile[] = [];
  let total = 0;
  for (const file of files) {
    const fileName = file.name.trim() || "Attachment";
    if (accepted.length >= MAX_ATTACHMENTS) break;
    if (total + file.size > MAX_TOTAL_BYTES || attachmentSizeRejection(fileName, file.size))
      continue;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      accepted.push({ fileName, bytes, mimeType: file.type });
      total += bytes.byteLength;
    } catch {
      continue;
    }
  }
  bridge.attachDroppedFiles(accepted, accepted.length !== files.length);
}

type Status = "idle" | "sending" | "failed" | "invalid";

/** A file pasted or dropped into the draft: its bytes wait here until the message is sent. */
export interface DraftAttachment {
  id: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  /** Pixel size, and an object URL for the thumbnail, for an image this page can draw. */
  width?: number;
  height?: number;
  url?: string;
}

const inputFileName = (file: File | DockFile) =>
  (file instanceof File ? file.name : file.fileName).trim() || "Attachment";

const readAttachment = async (file: File | DockFile): Promise<DraftAttachment | null> => {
  const fileName = inputFileName(file);
  const size = file instanceof File ? file.size : file.bytes.byteLength;
  // Empty, or over the chat's limit for this kind of file.
  if (attachmentSizeRejection(fileName, size)) return null;
  try {
    // A folder (or a file that vanished) cannot be read.
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
    const mimeType = file instanceof File ? file.type : file.mimeType;
    const attachment: DraftAttachment = {
      id: crypto.randomUUID(),
      bytes,
      fileName,
      mimeType,
    };
    if (mimeType.startsWith("image/")) {
      try {
        const image =
          file instanceof File ? file : new Blob([Uint8Array.from(bytes)], { type: mimeType });
        const bitmap = await createImageBitmap(image);
        attachment.width = bitmap.width;
        attachment.height = bitmap.height;
        bitmap.close();
        attachment.url = URL.createObjectURL(image);
      } catch {
        // An image type this page cannot draw (HEIC, say) is still sent, as a plain file.
      }
    }
    return attachment;
  } catch {
    return null;
  }
};

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/**
 * The composer's draft and send. It lives above the panel, so what was typed survives closing
 * the panel, and a send still finishes (or fails visibly) after the person clicked away.
 */
export function useDockComposer(
  bridge: BotDockBridge | undefined,
  roster: BotDockRosterView[],
  outcomesEnabled = true
) {
  const [text, setText] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [goalModeState, setGoalMode] = useState(false);
  const goalMode = outcomesEnabled && goalModeState;
  const [status, setStatus] = useState<Status>("idle");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const attachmentsRef = useRef<DraftAttachment[]>([]);
  attachmentsRef.current = attachments;
  // One id per distinct message: resending the same text after a lost answer is a no-op in the
  // chat, while edited text is a new message.
  const attempt = useRef<{ key: string; nonce: string } | null>(null);
  const busy = useRef(false);

  const change = useCallback((next: string) => {
    setText(next);
    setStatus((current) => (current === "failed" || current === "invalid" ? "idle" : current));
  }, []);

  /** Attaches pasted or dropped files, up to the limits; anything left out is reported. */
  const addFiles = useCallback(async (files: readonly (File | DockFile)[], alreadyRejected = false) => {
    let count = attachmentsRef.current.length;
    let total = attachmentsRef.current.reduce((sum, item) => sum + item.bytes.byteLength, 0);
    const accepted: DraftAttachment[] = [];
    let rejected = alreadyRejected;
    for (const file of files) {
      // Checked before reading, so a huge file is never loaded just to be turned away.
      const size = file instanceof File ? file.size : file.bytes.byteLength;
      if (count >= MAX_ATTACHMENTS || total + size > MAX_TOTAL_BYTES) {
        rejected = true;
        continue;
      }
      const attachment = await readAttachment(file);
      if (!attachment) {
        rejected = true;
        continue;
      }
      accepted.push(attachment);
      count++;
      total += attachment.bytes.byteLength;
    }
    if (accepted.length > 0) setAttachments((current) => [...current, ...accepted]);
    setStatus(rejected ? "invalid" : "idle");
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      for (const item of current) if (item.id === id && item.url) URL.revokeObjectURL(item.url);
      return current.filter((item) => item.id !== id);
    });
    setStatus((current) => (current === "invalid" ? "idle" : current));
  }, []);

  const send = useCallback(async () => {
    if (!bridge || busy.current) return;
    const message = composeMessage(text, roster, targetId, attachments.length > 0);
    if (!message) return;
    const effectiveGoalMode = outcomesEnabled && goalModeState;
    const key = `${effectiveGoalMode ? "goal" : "chat"}\n${message.botId}\n${message.content}\n${attachments.map((item) => item.id).join(",")}`;
    if (attempt.current?.key !== key) attempt.current = { key, nonce: crypto.randomUUID() };
    busy.current = true;
    setStatus("sending");
    const result = await bridge.send({
      ...message,
      ...(effectiveGoalMode ? { goalMode: true } : {}),
      nonce: attempt.current.nonce,
      attachments: attachments.map(({ bytes, fileName, mimeType, width, height }) => ({
        bytes,
        fileName,
        mimeType,
        ...(width && height ? { width, height } : {}),
      })),
    });
    if (!result.ok) {
      busy.current = false;
      setStatus("failed");
      return;
    }
    attempt.current = null;
    bridge.closeComposer();
    for (const item of attachments) if (item.url) URL.revokeObjectURL(item.url);
    setAttachments([]);
    setText("");
    setTargetId(null);
    setGoalMode(false);
    busy.current = false;
    setStatus("idle");
  }, [bridge, attachments, goalModeState, outcomesEnabled, roster, targetId, text]);

  return {
    text,
    change,
    targetId,
    setTargetId,
    goalMode,
    setGoalMode,
    status,
    send,
    attachments,
    addFiles,
    removeAttachment,
  };
}

export type DockComposerModel = ReturnType<typeof useDockComposer>;

export function MiniAvatar({ bot }: { bot: BotDockRosterView }) {
  if (bot.avatarDataUrl)
    return <img alt="" className="dock-mini" draggable={false} src={bot.avatarDataUrl} />;
  return (
    <BotAvatarGlyph
      className="dock-mini"
      color={bot.color}
      shape={normalizeRobotAvatarShape(bot.icon)}
      style={{ width: 20, height: 20, flex: "none" }}
    />
  );
}

/** The panel beside the capsule: an input addressed to the main Bot unless an `@Bot` or the
 * target chip says otherwise. Enter sends, Shift+Enter adds a line, Escape closes. Pasted or
 * dropped files wait under the input as attachments. */
export function DockComposer({
  state,
  bridge,
  model,
}: {
  state: BotDockStateView;
  bridge: BotDockBridge;
  model: DockComposerModel;
}) {
  const { labels, roster } = state;
  const {
    text,
    change,
    targetId,
    setTargetId,
    goalMode,
    setGoalMode,
    status,
    send,
    attachments,
    addFiles,
    removeAttachment,
  } = model;
  const canGoalMode = state.outcomesEnabled !== false;
  const activeGoalMode = canGoalMode && goalMode;
  const chatModeLabel = labels.chatMode ?? "Chat";
  const goalModeLabel = labels.goalMode ?? "Goal";
  const activePlaceholder = activeGoalMode
    ? (labels.goalPlaceholder ?? "Goal mode: describe what to achieve. Type @ to choose a Bot.")
    : labels.placeholder;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(text.length);
  const [chipOpen, setChipOpen] = useState(false);
  // An Escape closes the list for what is typed; typing on opens it again.
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);

  // The window takes focus a moment after the panel appears.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    const blur = () => {
      setChipOpen(false);
      setDismissed(true);
      setIndex(0);
    };
    focus();
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Return focus for a retry after a send fails.
  useEffect(() => {
    if (status === "failed" || status === "invalid") inputRef.current?.focus();
  }, [status]);

  const mention = dismissed ? null : activeMention(text, caret);
  const options = filterComposeBots(roster, mention?.query ?? "");
  const listOpen = options.length > 0 && (chipOpen || mention !== null);

  // Escape closes the list first, then the panel, wherever the focus is.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (listOpen) {
        setChipOpen(false);
        setDismissed(true);
      } else bridge.closeComposer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bridge, listOpen]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, []);

  const target = composeTarget(text, roster, targetId);
  const locked = status === "sending";
  const canSend =
    !locked && composeMessage(text, roster, targetId, attachments.length > 0) !== null;

  const pick = (bot: BotDockRosterView) => {
    let next = text;
    let nextCaret = caret;
    if (mention) {
      const removed = removeMention(text, mention);
      next = removed.text;
      nextCaret = removed.caret;
    }
    change(next);
    setCaret(nextCaret);
    setTargetId(bot.id);
    setChipOpen(false);
    setDismissed(false);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      input?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME is still choosing characters: Enter confirms its candidate, not the message.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (listOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setIndex((current) => (current + step + options.length) % options.length);
        return;
      }
      const selectingMention = event.key === "Enter" && mention !== null;
      if (!event.shiftKey && (event.key === "Tab" || selectingMention)) {
        event.preventDefault();
        if (selectingMention && event.repeat) return;
        const bot = options[Math.min(index, options.length - 1)];
        if (bot) pick(bot);
        return;
      }
    }
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (!event.repeat && canGoalMode) {
        setGoalMode((current) => !current);
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat) void send();
    }
  };

  const statusText =
    status === "failed"
      ? labels.failed
      : status === "invalid"
        ? labels.attachmentInvalid
        : "";

  // Copied files (a screenshot, a picture from a page, files from Finder or Explorer) are
  // attached; anything else pastes as the text it is.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  };

  return (
    <div
      className="dock-composer"
      data-goal-mode={activeGoalMode ? "true" : undefined}
      role="dialog"
    >
      {roster.length === 0 ? (
        <p className="dock-composer-empty">{labels.empty}</p>
      ) : (
        <>
          <textarea
            aria-label={activePlaceholder}
            className="dock-input"
            disabled={locked}
            onChange={(event) => {
              change(event.target.value);
              setCaret(event.target.selectionStart);
              setDismissed(false);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            placeholder={activePlaceholder}
            ref={inputRef}
            rows={3}
            value={text}
          />
          {attachments.length > 0 ? (
            <div className="dock-attachments">
              {attachments.map((item) => (
                <div
                  className="dock-attachment"
                  data-kind={item.url ? "image" : "file"}
                  key={item.id}
                  title={item.fileName}
                >
                  {item.url ? (
                    <img alt="" draggable={false} src={item.url} />
                  ) : (
                    <>
                      <FileText
                        aria-hidden
                        className="dock-file-icon"
                        size={18}
                        strokeWidth={1.8}
                      />
                      <span className="dock-file-text">
                        <span className="dock-file-name">{item.fileName}</span>
                        <span className="dock-file-size">{formatBytes(item.bytes.byteLength)}</span>
                      </span>
                    </>
                  )}
                  <button
                    aria-label={labels.removeAttachment}
                    className="dock-attachment-remove"
                    disabled={locked}
                    onClick={() => removeAttachment(item.id)}
                    onMouseDown={(event) => event.preventDefault()}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {listOpen ? (
            <div className="dock-picker" role="listbox">
              {options.map((bot, position) => (
                <div
                  aria-selected={position === Math.min(index, options.length - 1)}
                  className="dock-picker-item"
                  data-active={position === Math.min(index, options.length - 1)}
                  key={bot.id}
                  onMouseDown={(event) => {
                    // Keep the focus in the input.
                    event.preventDefault();
                    pick(bot);
                  }}
                  onMouseEnter={() => setIndex(position)}
                  role="option"
                  tabIndex={-1}
                >
                  <MiniAvatar bot={bot} />
                  <span className="dock-picker-name">{bot.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="dock-composer-bar">
            <button
              aria-expanded={listOpen}
              className="dock-target"
              onClick={() => {
                setIndex(0);
                setChipOpen((open) => !open);
              }}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              {target ? <MiniAvatar bot={target} /> : null}
              <span className="dock-target-label">
                {labels.to} {target?.name ?? ""}
              </span>
            </button>
            <span className="dock-status" data-status={status} role="status">
              {statusText}
            </span>
            <button
              aria-label={activeGoalMode ? goalModeLabel : chatModeLabel}
              aria-pressed={activeGoalMode}
              className="dock-mode-pill"
              data-mode={activeGoalMode ? "goal" : "chat"}
              disabled={locked || !canGoalMode}
              onClick={() => {
                if (!canGoalMode) return;
                setGoalMode((current) => !current);
                inputRef.current?.focus();
              }}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              {canGoalMode ? (
                <kbd aria-hidden="true" className="dock-mode-kbd">
                  Tab
                </kbd>
              ) : null}
              <span>{activeGoalMode ? goalModeLabel : chatModeLabel}</span>
            </button>
            <button
              className="dock-send"
              disabled={!canSend}
              onClick={() => void send()}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              {labels.send}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
