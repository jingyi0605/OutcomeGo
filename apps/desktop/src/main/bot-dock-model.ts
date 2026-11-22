/**
 * Pure model of the Bot floating window: the state the signed-in window publishes, its
 * validation, and the placement rules. Nothing here touches Electron, so it is unit tested.
 */

export interface BotDockBot {
  id: string;
  name: string;
  color: string;
  icon: string;
  /** The Bot's direct chat, opened when its avatar is clicked. */
  channelId: string;
  avatarDataUrl?: string;
  /** Unread messages (red badge). */
  messages: number;
  /** Goals waiting on the owner (yellow badge). */
  goals: number;
}

/** A Bot the composer can send to; the first one is the main Bot, the default target. */
export interface BotDockRosterBot {
  id: string;
  name: string;
  color: string;
  icon: string;
  avatarDataUrl?: string;
}

export interface BotDockLabels {
  messages: string;
  goals: string;
  open: string;
  running?: string;
  /** Composer copy. */
  placeholder: string;
  goalPlaceholder?: string;
  chatMode?: string;
  goalMode?: string;
  switchMode?: string;
  send: string;
  to: string;
  failed: string;
  empty: string;
  attachmentInvalid: string;
  removeAttachment: string;
}

export interface BotDockState {
  /** Only Bots that have something to show, most recently active first. */
  bots: BotDockBot[];
  /** Every Bot a message can go to, the main Bot first. */
  roster: BotDockRosterBot[];
  labels: BotDockLabels;
  theme?: "light" | "dark" | "system";
  running?: boolean;
  outcomesEnabled?: boolean;
}

export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DockLayout = "compact" | "invitation" | "composer";

export const BOT_DOCK_MAX_BOTS = 50;
export const BOT_DOCK_MAX_ROSTER = 100;
export const BOT_DOCK_MAX_MESSAGE = 20_000;
/** Attachments in one message (the chat allows 20; the dock is a quick-send surface). */
export const BOT_DOCK_MAX_ATTACHMENTS = 10;
/** Defensive caps, the chat's largest limit (a video); the page applies the chat's own per-file
 * limits first. */
export const BOT_DOCK_MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;
export const BOT_DOCK_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const BOT_DOCK_MAX_COUNT = 99_999;
/** Generous bounds for the window: the capsule grows with its avatars, and the composer adds a panel. */
export const BOT_DOCK_SIZE_LIMITS = {
  minWidth: 40,
  maxWidth: 512,
  minHeight: 32,
  // Tall enough for the composer panel (input, Bot list) above or below the capsule.
  maxHeight: 560,
} as const;
const EDGE_MARGIN = 8;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value : null;

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= BOT_DOCK_MAX_COUNT
    ? value
    : null;

/**
 * Copies only the fields the dock renders. `null` means "nothing to show" (signed out, or the
 * window is closing); an invalid payload is rejected as `undefined` so it can't blank the dock.
 */
export const parseBotDockState = (value: unknown): BotDockState | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.bots) || value.bots.length > BOT_DOCK_MAX_BOTS)
    return undefined;
  const bots: BotDockBot[] = [];
  for (const candidate of value.bots) {
    if (!isRecord(candidate)) return undefined;
    const id = text(candidate.id, 200);
    const name = text(candidate.name, 200);
    const color = text(candidate.color, 40);
    const icon = text(candidate.icon, 60);
    const channelId = text(candidate.channelId, 128);
    const messages = count(candidate.messages);
    const goals = count(candidate.goals);
    if (
      !id ||
      name === null ||
      !color ||
      icon === null ||
      !channelId ||
      messages === null ||
      goals === null
    )
      return undefined;
    // A Bot with nothing waiting has no place in the dock.
    if (messages === 0 && goals === 0) continue;
    const avatar = text(candidate.avatarDataUrl, 400_000);
    bots.push({
      id,
      name,
      color,
      icon,
      channelId,
      messages,
      goals,
      ...(avatar?.startsWith("data:image/") ? { avatarDataUrl: avatar } : {}),
    });
  }
  const rosterInput = value.roster ?? [];
  if (!Array.isArray(rosterInput) || rosterInput.length > BOT_DOCK_MAX_ROSTER) return undefined;
  const roster: BotDockRosterBot[] = [];
  for (const candidate of rosterInput) {
    if (!isRecord(candidate)) return undefined;
    const id = text(candidate.id, 200);
    const name = text(candidate.name, 200);
    const color = text(candidate.color, 40);
    const icon = text(candidate.icon, 60);
    if (!id || name === null || !color || icon === null) return undefined;
    const avatar = text(candidate.avatarDataUrl, 400_000);
    roster.push({
      id,
      name,
      color,
      icon,
      ...(avatar?.startsWith("data:image/") ? { avatarDataUrl: avatar } : {}),
    });
  }
  const labels = isRecord(value.labels) ? value.labels : {};
  const theme =
    value.theme === "light" || value.theme === "dark" || value.theme === "system"
      ? value.theme
      : undefined;
  return {
    bots,
    roster,
    labels: {
      messages: text(labels.messages, 80) ?? "Unread messages",
      goals: text(labels.goals, 80) ?? "Pending action",
      open: text(labels.open, 80) ?? "Open OutcomeGo",
      running: text(labels.running, 80) ?? "Bot activity in progress",
      placeholder: text(labels.placeholder, 160) ?? "Message the main Bot. Type @ to choose a Bot.",
      ...(text(labels.goalPlaceholder, 160)
        ? { goalPlaceholder: text(labels.goalPlaceholder, 160)! }
        : {}),
      ...(text(labels.chatMode, 40) ? { chatMode: text(labels.chatMode, 40)! } : {}),
      ...(text(labels.goalMode, 40) ? { goalMode: text(labels.goalMode, 40)! } : {}),
      ...(text(labels.switchMode, 40) ? { switchMode: text(labels.switchMode, 40)! } : {}),
      send: text(labels.send, 40) ?? "Send",
      to: text(labels.to, 40) ?? "To",
      failed: text(labels.failed, 160) ?? "Couldn’t send. Try again.",
      empty: text(labels.empty, 160) ?? "No Bot is available.",
      attachmentInvalid: text(labels.attachmentInvalid, 160) ?? "That file can’t be attached.",
      removeAttachment: text(labels.removeAttachment, 80) ?? "Remove attachment",
    },
    ...(theme ? { theme } : {}),
    ...(value.running === true ? { running: true } : {}),
    ...(typeof value.outcomesEnabled === "boolean"
      ? { outcomesEnabled: value.outcomesEnabled }
      : {}),
  };
};

/** What a click on the dock should open: the chat when messages wait, otherwise the goals. */
export const botDockOpenTarget = (
  bot: BotDockBot
): { kind: "chat"; channelId: string } | { kind: "goals" } =>
  bot.messages > 0 ? { kind: "chat", channelId: bot.channelId } : { kind: "goals" };

/** The size the page asked for, as a whole number of pixels inside the allowed range. */
export const clampDockSize = (
  width: unknown,
  height: unknown
): { width: number; height: number } | null => {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  )
    return null;
  const limits = BOT_DOCK_SIZE_LIMITS;
  return {
    width: Math.min(limits.maxWidth, Math.max(limits.minWidth, Math.ceil(width))),
    height: Math.min(limits.maxHeight, Math.max(limits.minHeight, Math.ceil(height))),
  };
};

/** Keeps the window fully inside a display's work area (never off the edge of the screen). */
export const clampToWorkArea = (rect: DockRect, workArea: DockRect): DockRect => {
  const maxX = workArea.x + Math.max(0, workArea.width - rect.width);
  const maxY = workArea.y + Math.max(0, workArea.height - rect.height);
  return {
    ...rect,
    x: Math.min(maxX, Math.max(workArea.x, Math.round(rect.x))),
    y: Math.min(maxY, Math.max(workArea.y, Math.round(rect.y))),
  };
};

/** The first placement: the bottom-right corner of the work area, clear of the Dock/taskbar. */
export const defaultDockPosition = (
  size: { width: number; height: number },
  workArea: DockRect
): DockRect =>
  clampToWorkArea(
    {
      ...size,
      x: workArea.x + workArea.width - size.width - EDGE_MARGIN * 3,
      y: workArea.y + workArea.height - size.height - EDGE_MARGIN * 3,
    },
    workArea
  );

/** Which edges stay fixed when the window changes size. */
export interface DockAnchor {
  right: boolean;
  bottom: boolean;
}

/** The anchor a window at this place would get: the horizontal edge nearer the screen's side,
 * and, for the composer, the bottom edge when the window sits in the lower half. */
export const dockAnchorFor = (current: DockRect, workArea: DockRect): DockAnchor => ({
  right: current.x + current.width / 2 > workArea.x + workArea.width / 2,
  bottom: current.y + current.height / 2 > workArea.y + workArea.height / 2,
});

/**
 * A new size for a window that stays put. By default the edge nearer the screen's side stays
 * fixed, so a capsule parked on the right grows leftwards instead of running off the screen.
 */
export const resizeDock = (
  current: DockRect,
  size: { width: number; height: number },
  workArea: DockRect,
  anchor?: DockAnchor
): DockRect => {
  const right = anchor?.right ?? dockAnchorFor(current, workArea).right;
  const bottom = anchor?.bottom ?? false;
  return clampToWorkArea(
    {
      ...size,
      x: right ? current.x + current.width - size.width : current.x,
      y: bottom ? current.y + current.height - size.height : current.y,
    },
    workArea
  );
};

export const resizeDockFromCenter = (
  compact: DockRect,
  size: { width: number; height: number },
  workArea: DockRect
): DockRect =>
  clampToWorkArea(
    {
      ...size,
      x: compact.x + (compact.width - size.width) / 2,
      y: compact.y + (compact.height - size.height) / 2,
    },
    workArea
  );

export const placeDockComposer = (
  dock: DockRect,
  size: { width: number; height: number },
  workArea: DockRect
): DockRect => {
  const anchor = dockAnchorFor(dock, workArea);
  const shadowOverlap = 21;
  return clampToWorkArea(
    {
      ...size,
      x: anchor.right ? dock.x + dock.width - size.width : dock.x,
      y: anchor.bottom ? dock.y - size.height + shadowOverlap : dock.y + dock.height - shadowOverlap,
    },
    workArea
  );
};

export interface BotDockSettings {
  enabled: boolean;
  /** Where the window last was. The width is kept so a window rebuilt at another width
   * stays on the same side of the screen (see `resizeDock`). */
  position: { x: number; y: number; width: number } | null;
  /** Hidden for a while: the time (ms since the epoch) the dock comes back. Kept across
   * restarts, and ignored once it has passed. */
  hiddenUntil: number | null;
}

export const DEFAULT_BOT_DOCK_SETTINGS: BotDockSettings = {
  enabled: false,
  position: null,
  hiddenUntil: null,
};

export type BotDockSnooze = "5m" | "30m" | "1h" | "today";
export const BOT_DOCK_SNOOZES: readonly BotDockSnooze[] = ["5m", "30m", "1h", "today"];

/** When a temporary hide ends: after the given minutes, or at the next local midnight. */
export const snoozeDeadline = (option: BotDockSnooze, now: number): number => {
  if (option === "today") {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime();
  }
  const minutes = { "5m": 5, "30m": 30, "1h": 60 }[option];
  return now + minutes * 60_000;
};

export const isSnoozed = (settings: BotDockSettings, now: number): boolean =>
  settings.hiddenUntil !== null && settings.hiddenUntil > now;

export type BotDockImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The image type the bytes really are, from their signature; never the page's claim. */
export const sniffImageMime = (bytes: Uint8Array): BotDockImageMime | null => {
  const at = (index: number) => bytes[index] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  )
    return "image/webp";
  return null;
};

/** A file pasted or dropped into the composer, checked before it is staged for sending. */
export interface BotDockAttachment {
  bytes: Uint8Array;
  fileName: string;
  /** The real type for an image (from its bytes); for any other file, the page's claim if it is
   * well formed, else a generic one. */
  mimeType: string;
  /** Pixel size, for an image. */
  width?: number;
  height?: number;
}

/** A message typed into the composer, checked before it is handed to the main window. */
export interface BotDockMessage {
  botId: string;
  /** May be empty when files are attached. */
  content: string;
  nonce: string;
  goalMode?: boolean;
  attachments: BotDockAttachment[];
}

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

const parseAttachment = (value: unknown): BotDockAttachment | null => {
  if (!isRecord(value)) return null;
  const raw = value.bytes;
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : ArrayBuffer.isView(raw)
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : null;
  if (!bytes || bytes.byteLength < 1 || bytes.byteLength > BOT_DOCK_MAX_ATTACHMENT_BYTES)
    return null;
  const image = sniffImageMime(bytes);
  const claimed = typeof value.mimeType === "string" ? value.mimeType.trim().toLowerCase() : "";
  // An image is whatever its bytes say; a file never gets to claim to be one.
  const mimeType =
    image ??
    (MIME_PATTERN.test(claimed) && !claimed.startsWith("image/")
      ? claimed
      : "application/octet-stream");
  const dimension = (side: unknown): side is number =>
    typeof side === "number" && Number.isInteger(side) && side > 0 && side <= 100_000;
  const extension = image ? image.slice("image/".length).replace("jpeg", "jpg") : null;
  // No path separators or control characters: this becomes a name shown in the chat.
  const name = text(value.fileName, 255)
    ?.replace(/[\\/\u0000-\u001f]/g, "_")
    .trim();
  return {
    bytes,
    mimeType,
    fileName: name || (extension ? `Image.${extension}` : "Attachment"),
    ...(image && dimension(value.width) && dimension(value.height)
      ? { width: value.width, height: value.height }
      : {}),
  };
};

export const parseBotDockAttachments = (input: unknown): BotDockAttachment[] | null => {
  if (!Array.isArray(input) || input.length > BOT_DOCK_MAX_ATTACHMENTS) return null;
  const attachments: BotDockAttachment[] = [];
  let total = 0;
  for (const candidate of input) {
    const attachment = parseAttachment(candidate);
    if (!attachment) return null;
    total += attachment.bytes.byteLength;
    attachments.push(attachment);
  }
  return total <= BOT_DOCK_MAX_TOTAL_BYTES ? attachments : null;
};

export const parseBotDockMessage = (value: unknown): BotDockMessage | null => {
  if (!isRecord(value)) return null;
  const botId = text(value.botId, 200);
  const nonce = text(value.nonce, 120);
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const attachments = parseBotDockAttachments(value.attachments ?? []);
  if (
    !botId ||
    !nonce ||
    nonce.length < 8 ||
    content.length > BOT_DOCK_MAX_MESSAGE ||
    !attachments ||
    (!content && attachments.length === 0)
  )
    return null;
  return {
    botId,
    content,
    nonce,
    ...(value.goalMode === true ? { goalMode: true } : {}),
    attachments,
  };
};

export const parseBotDockSettings = (value: unknown): BotDockSettings => {
  if (!isRecord(value)) return DEFAULT_BOT_DOCK_SETTINGS;
  const position = isRecord(value.position) ? value.position : null;
  const finite = (number: unknown): number is number =>
    typeof number === "number" && Number.isFinite(number) && Math.abs(number) < 1e6;
  return {
    enabled: value.enabled === true,
    position:
      position &&
      finite(position.x) &&
      finite(position.y) &&
      finite(position.width) &&
      position.width > 0
        ? { x: position.x, y: position.y, width: position.width }
        : null,
    hiddenUntil:
      typeof value.hiddenUntil === "number" &&
      Number.isFinite(value.hiddenUntil) &&
      value.hiddenUntil > 0
        ? value.hiddenUntil
        : null,
  };
};
