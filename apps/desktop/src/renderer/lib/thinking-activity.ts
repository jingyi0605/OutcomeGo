import type { RunItemView } from "@outcomego/contracts";
import { translateCurrent } from "./i18n-catalog";

/** Project only active runtime items; never display tool arguments or reasoning text. */
export function thinkingActivity(items: readonly RunItemView[] = []): string {
  let latest: RunItemView | undefined;
  for (const item of items) {
    if (item.status !== "running" && item.status !== "pending") continue;
    if (
      !latest ||
      item.createdAt > latest.createdAt ||
      (item.createdAt === latest.createdAt && item.updatedAt >= latest.updatedAt)
    )
      latest = item;
  }
  if (!latest) return "Thinking";
  if (latest.kind === "reasoning") return "Thinking";
  if (latest.kind === "command") return translateCurrent("Running commands");
  if (latest.kind === "file_change") return translateCurrent("Drafting the file");
  if (latest.kind === "compaction") return translateCurrent("Organizing context");
  // Runtime agent text is internal, not necessarily a message being sent to the user.
  const content =
    latest.content && typeof latest.content === "object"
      ? (latest.content as Record<string, unknown>)
      : {};
  const tool = typeof content.tool === "string" ? content.tool : (latest.title ?? "");
  switch (tool) {
    case "SendToUser":
      return "Typing";
    case "read":
    case "Read":
    case "ReadFile":
    case "BoxRead":
      return translateCurrent("Reading file");
    case "WebSearch":
    case "web_search":
      return translateCurrent("Searching the web");
    case "WebFetch":
    case "web_fetch":
      return translateCurrent("Reading the web");
    case "write":
    case "edit":
    case "Write":
    case "Edit":
      return translateCurrent("Drafting the file");
    case "Shell":
    case "ExternalShell":
    case "bash":
    case "BoxShell":
      return translateCurrent("Running commands");
    case "Await":
    case "AwaitProcess":
      return translateCurrent("Waiting on a command");
    case "Computer":
    case "Screenshot":
      return translateCurrent("On its computer");
    case "SendToAgent":
    case "UpdateAgent":
      return translateCurrent("Messaging another assistant");
    case "Task":
    case "CheckSubagent":
      return translateCurrent("Waiting on another Bot");
    case "GenerateImage":
      return translateCurrent("Generating a photo");
    default:
      return latest.kind === "agent_message" ? "Thinking" : "Working";
  }
}

export type HeldActivity = { text: string; since: number; previous: string | null };
/** Coalesce rapid updates to the newest caption, without restarting equal captions. */
export function advanceActivity(
  current: HeldActivity,
  text: string,
  now: number,
  hold: number
): HeldActivity {
  return text === current.text || now - current.since < hold
    ? current
    : { text, since: now, previous: current.text };
}
export function activityElapsedLabel(since: number, now: number): string | null {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}
