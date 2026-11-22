import { settleTaskProgress, dispatchTaskContinuations, settleRequestProgress, recoverRequestProgress, dispatchRequestChecks, requestWakeAllowed, requestIsStopped, taskProgress, recoverTaskInterruption, TASK_RECOVERY_LOCK, requeueAutomationWake, automationRetryDelay, AUTOMATION_ATTEMPT_LIMIT } from "@outcomego/messaging";
import {
  isManagedDraftWake,
  isTreatmentDraftWake,
  publishMessageNotification,
  turnOwesReplyReminder,
  turnSystemReminder,
  withTurnSystemReminder,
} from "@outcomego/messaging";
import { createHash } from "node:crypto";
import type {
  AssetRef,
  ComputerEvent,
  ComputerTurnRequest,
  RunOrigin,
  RuntimeRequestSource,
  RuntimeInlineImage,
  SubagentType,
} from "@outcomego/contracts";
import { MAX_TURN_INLINE_IMAGE_BYTES, MAX_TURN_INLINE_IMAGES, SEND_TO_USER_REPLY_NUDGE_PROMPT } from "@outcomego/contracts";
import { CLIENT_CAPABILITIES, formatPiModelRef, normalizePiReasoningLevel } from "@outcomego/contracts";
import { checkComputerModelAvailable, resolveRunInference } from "./inference-selection";
import {
  canClaimThreadTurn,
  countThreadLeasesByRole,
  PLANNER_TURN_CONCURRENCY,
  REVIEWER_TURN_CONCURRENCY,
} from "./thread-concurrency";
import { selectTaskConfiguration, parseTaskConfiguration, subagentUsesParentConnectors, type TaskConfiguration, type TaskCapabilities } from "@outcomego/contracts/task-configuration";
import { finalizeInterruptedItems } from "./interrupted-progress";
import { dispatchComputerTurn } from "./runtime-dispatch";
import { subagentTitle } from "@outcomego/contracts/subagent-dispatch";
import {
  COMPUTER_API_PATHS,
  parseAgentDirectorySnapshot,
  type AgentDirectoryRecord,
} from "@outcomego/contracts/service-protocol";
import {
} from "@outcomego/contracts";
import { createPrismaClient, Prisma, type PrismaClient } from "@outcomego/db";
import {
  appendAgentTimelineEvent,
  AgentDataStore,
  AgentMessaging,
  lockAgentLifecycle,
  cleanupRetiredAgent,
  RETIRED_AGENT_CLEANUP_RETRY_MS,
  appendRoutineRunLedger,
  buildSafeTranscript,
  PRIORITY,
  RoutineService,
  renderSubagentRevivalPrompt,
  renderQuietSubagentRevivalPrompt,
  renderQuietRevivalBatchPrompt,
  renderAutomationHandoffPrompt,
  renderRevivalBatchPrompt,
  retimestampUserTurn,
  quietRoutineOriginNote,
  automationContextRoutine,
  automationBackgroundWorkRunning,
  subagentRevivalBlock,
  REVIVAL_HELD_AFTER_MS,
  type RevivalCompletion,
  automationContinuationRoute,
  automationContextRunId,
  reconcileRoutineExecution,
  settleOutcomeWorkItem,
  settleOutcomeThreadTurn,
  settleFinishedOutcomeThreadTurns,
  startOutcomeThreadTurn,
  dispatchQueuedOutcomeWorkItems,
  recoverOutcomeWorkItems,
  outcomeDispatchEnabled,
  isOutcomeDecisionRevisionActive,
  transitionWorkItem,
  groupRoutineState,
  lockGroupExecution,
} from "@outcomego/messaging";
import { fromPrisma, type Job, type JobWithMetadata, PgBoss } from "pg-boss";
import { pluginRuntimeContext, pluginSkillInstructions } from "./plugins";
import type { PluginSkillAgent } from "@outcomego/plugin-sdk";
import { Projection } from "./projection";
import { workContinuously } from "./queue-dispatch";
import { consumeComputerEvents } from "./computer-events";
import { PushNotificationDispatcher } from "./push-notifications";
import { lockWakeAttempt, ownsWakeAttempt, type WakeAttempt } from "./wake-attempt";

export { AUTOMATION_ATTEMPT_LIMIT, AUTOMATION_RETRY_DELAYS_MS } from "@outcomego/messaging";

const LEASE_MS = 2 * 60_000;
/** Tries at a first greeting the computer cut off, the first included. */
export const BOOTSTRAP_ATTEMPT_LIMIT = 4;
/** How often a cut-off greeting asks whether the computer is ready again. */
export const BOOTSTRAP_RETRY_PROBE_MS = 5_000;
export const STALLED_WAKE_SCAN_MS = 30_000;
export const AUTOMATION_RECONCILE_BATCH_SIZE = 8;
export const TRANSCRIPT_FINGERPRINT_TTL_MS = 5_000;
export const TRANSCRIPT_FINGERPRINT_CACHE_MAX_ENTRIES = 1_024;

/** Events that retire a chat for good: an id carrying one of them is never adopted back. */
export const RETIRED_AGENT_EVENT_TOPICS = ["channel.deleted", "bot.archived"] as const;

export const computerEventQueuesPushNotification = (event: ComputerEvent): boolean =>
  event.type === "turn.completed";

interface TranscriptFingerprintEntry {
  value: string;
  expiresAt: number;
}

/** Small per-process LRU used only to suppress duplicate transcript uploads. */
export class TranscriptFingerprintCache {
  private readonly entries = new Map<string, TranscriptFingerprintEntry>();

  constructor(
    readonly maxEntries = TRANSCRIPT_FINGERPRINT_CACHE_MAX_ENTRIES,
    readonly ttlMs = TRANSCRIPT_FINGERPRINT_TTL_MS
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Transcript fingerprint cache maxEntries must be a positive integer");
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("Transcript fingerprint cache ttlMs must be positive");
    }
  }

  matches(botId: string, value: string, now = Date.now()): boolean {
    const entry = this.entries.get(botId);
    if (!entry) return false;
    if (entry.expiresAt <= now) {
      this.entries.delete(botId);
      return false;
    }
    // Reinsert on access so Map insertion order is the LRU order.
    this.entries.delete(botId);
    this.entries.set(botId, entry);
    return entry.value === value;
  }

  remember(botId: string, value: string, now = Date.now()): void {
    this.entries.delete(botId);
    this.entries.set(botId, { value, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export const transcriptEventsFingerprint = (events: unknown): string =>
  createHash("sha256").update(JSON.stringify(events)).digest("hex");

/** Spoken progress lines are chat messages, but never the answer to the user's request. */
export const isVoiceNarration = (metadata: unknown): boolean =>
  Boolean(metadata) && typeof metadata === "object" && !Array.isArray(metadata) &&
  (metadata as { type?: unknown }).type === "voice-narration";

export const voiceTurnPrompt =
  "[SAND_HIDDEN_PROMPT]This is a realtime voice conversation. The user hears your SendToUser messages spoken aloud. Keep each one short, warm and natural, as if talking, with no tables, code blocks or long lists. A separate voice narrator tells the user what you are doing while you work, so do not announce routine tool use yourself. Call SendToUser when you have a result, a question, or something genuinely new to say, and never repeat what the user has already heard. Begin a message with a brief first-person sentence such as \"I'm checking that now\" only when the work will take a while and the narrator has not already said so. This instruction is internal and must not be shown as a chat message.";

const directTextVoicePrompt =
  "[SAND_HIDDEN_PROMPT]The user hears your assistant text spoken aloud. Write short, natural sentences with no tables, code blocks or long lists. A separate narrator covers routine work. Write only a result, a question, or a meaningful update, and never repeat what the user has already heard.";

/** Added in a spoken room, where the speaker turns after a reply are decided by the @ it contains. */
export const voiceRoomPrompt =
  " You are in a spoken room with other participants. To give another participant the next turn, end your message by naming them with @Name; that @ and the name after it are not spoken aloud. Do not @ anyone when you have nothing for them to answer. If you were asked a direct question, always answer it with SendToUser.";

class BotRunLeaseContended extends Error {}

interface WakeData {
  botId: string;
}

interface ProvisionData {
  botId: string;
}

interface TranscriptData {
  botId: string;
}

interface Claimed extends WakeAttempt {
  inboxType: string;
  contextSessionId: string;
  /** The run's own channel; null for a home run. */
  runChannelId: string | null;
  screenBotId: string;
  pluginBotId: string;
  conversationId: string;
  content: string;
  images: RuntimeInlineImage[];
  clientId: string;
  cwd: string;
  instructions: string;
  sessionPath: string | null;
  channelId: string;
  deliveryId: string | null;
  origin: RunOrigin;
  outcomeWorkItemId?: string | null;
  outcomeThreadId?: string | null;
  runtimeProfile: "agent" | "subagent";
  subagentType: SubagentType | null;
  readOnly: boolean;
  inferenceParentRunId: string | null;
  taskConfiguration: TaskConfiguration | null;
  fileAttachments: string[];
  attachmentOwnerBotId: string;
  /** The non-user run this typed message superseded. */
  interruptedRunId: string | null;
}

type SettlementClaim = Pick<Claimed,
  "botId" | "runId" | "inboxId" | "inboxType" | "ownerId" | "attempt" |
  "origin" | "runtimeProfile" | "channelId" | "runChannelId" | "deliveryId"
>;

export const contextScopeForRun = (
  origin: RunOrigin,
  channelId: string | null,
  conversationId: string,
  automationRunId?: string,
  outcomeWorkItemId?: string | null,
  outcomeThreadId?: string | null
): { scope: "home" | "channel" | "automation" | "outcome" | "outcome-thread"; scopeId: string } => {
  if (origin === "outcome_thread") {
    if (!outcomeThreadId) throw new Error("A goal thread turn requires its thread ID");
    return { scope: "outcome-thread", scopeId: outcomeThreadId };
  }
  if (origin === "outcome") {
    if (!outcomeWorkItemId) throw new Error("An Outcome requires its work item ID");
    return { scope: "outcome", scopeId: outcomeWorkItemId };
  }
  if (origin === "routine") {
    if (!automationRunId) throw new Error("An automation requires its own context run ID");
    return { scope: "automation", scopeId: automationRunId };
  }
  return channelId ? { scope: "channel", scopeId: channelId } : { scope: "home", scopeId: conversationId };
};

const REQUEST_SOURCE_BY_ORIGIN = {
  user: "turn",
  bootstrap: "turn",
  agent: "agent",
  group: "agent",
  routine: "automation",
  event: "event",
  connector: "connector",
  background_revival: "background-revival",
  handoff_resume: "handoff-resume",
  broadcast: "broadcast",
  // Outcome sub-threads follow the routine worker contract: no SendToUser, WakeParent for handoffs.
  outcome: "automation",
  // A goal's own thread works quietly like an Outcome sub-thread; its reply is shown with the goal.
  outcome_thread: "automation",
} as const satisfies Record<RunOrigin, RuntimeRequestSource>;

export const runtimeRequestSourceForOrigin = (
  origin: RunOrigin,
  inboxType?: string
): RuntimeRequestSource =>
  origin === "user" && inboxType === "user.reaction"
    ? "event"
    : REQUEST_SOURCE_BY_ORIGIN[origin];

/** Interrupted wakes that run again, and how often: agent messages up to 3 times, the rest once. */
export const WAKE_REDRIVE_LIMITS: Partial<Record<RunOrigin, number>> = {
  agent: 3,
  connector: 1,
  background_revival: 1,
};

export const SUBAGENT_INTERRUPTED_RESULT = "The background task was interrupted before it finished.";

export const runOwesUserDelivery = (origin: RunOrigin): boolean =>
  ["user", "bootstrap", "connector", "handoff_resume", "broadcast"].includes(origin);

export const subagentRuntimeOwners = (
  botId: string,
  identity: { parentBotId: string; subagentType: string } | null
): { screenBotId: string; pluginBotId: string } => ({
  screenBotId: identity?.subagentType === "computerUse" ? identity.parentBotId : botId,
  pluginBotId: subagentUsesParentConnectors(identity?.subagentType) ? identity!.parentBotId : botId,
});

/** Connectors reach the main agent and the workers that use the parent's connectors; graphical and media workers get none. */
export const subagentLoadsPluginContext = (subagentType: SubagentType | null): boolean =>
  subagentType === null || subagentUsesParentConnectors(subagentType);

/** Plugin skills name the agents they are for; the main agent is the default. */
export const pluginSkillAgent = (
  runtimeProfile: "agent" | "subagent",
  subagentType: SubagentType | null
): PluginSkillAgent | null => (runtimeProfile === "agent" ? "main" : subagentType);

export const wakeResetsSelfSummaryCount = (inboxType: string): boolean =>
  ![
    "subagent.completed",
    "subagent.failed",
    "subagent.stopped",
    "subagent.cancelled",
    "timeline.event",
  ].includes(inboxType);

const REVIVAL_WAKES = new Set(["subagent.completed", "subagent.failed", "shell.completed"]);

/** The delivery note a background result started from a group room carries. */
export const groupRoomRevivalNote = (roomName: string): string =>
  `This work belongs to group room ${JSON.stringify(roomName)}. The room has not seen this result. SendToUser in this continuation delivers to that room and wakes its peers; use it once for a useful final result. Do not repeat completed work or deliver stale results after a user cancellation.`;

interface RevivalWake {
  id: string;
  type: string;
  status: string;
  createdAt: Date;
  payload: unknown;
  run: { origin: RunOrigin; channelId: string | null };
}

/** Each card keeps its own receipt; ready draft outcomes share one model continuation. */
export const draftResponseBatch = <T extends RevivalWake>(
  claimed: T,
  pending: readonly T[]
): { content: string; folded: T[] } | null => {
  if (
    claimed.type !== "draft.response" ||
    claimed.status !== "pending" ||
    claimed.run.origin !== "user" ||
    isTreatmentDraftWake(claimed)
  )
    return null;
  const managed = isManagedDraftWake(claimed);
  const folded = pending.filter(
    (wake) =>
      wake.id !== claimed.id &&
      wake.type === "draft.response" &&
      wake.status === "pending" &&
      wake.run.origin === "user" &&
      wake.run.channelId === claimed.run.channelId &&
      !isTreatmentDraftWake(wake) &&
      isManagedDraftWake(wake) === managed
  );
  if (managed) {
    const content =
      claimed.payload && typeof claimed.payload === "object"
        ? (claimed.payload as { content?: unknown }).content
        : undefined;
    return typeof content === "string" ? { content, folded } : null;
  }
  const notices = [claimed, ...folded].map((wake) => {
    const content =
      wake.payload && typeof wake.payload === "object"
        ? (wake.payload as { content?: unknown }).content
        : undefined;
    return typeof content === "string"
      ? content.replace(/^\[SAND_HIDDEN_PROMPT\]/, "")
      : `Draft outcome event ${wake.id}. Read its stored card outcome.`;
  });
  return {
    content: `[SAND_HIDDEN_PROMPT]${folded.length + 1} external message draft outcome(s) are ready. Read the new card outcomes together and continue once. Acknowledge newly settled drafts in one brief SendToUser message. If their result was already reported, do not send another confirmation. Do not infer other cards are still open merely because their outcomes are absent.\n\n${notices.join("\n\n---\n\n")}`,
    folded,
  };
};

/** The raw size of a base64 data URL's payload. */
const dataUrlBytes = (url: string): number => {
  const data = url.slice(url.indexOf(",") + 1);
  return Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
};

const revivalOf = (wake: RevivalWake): RevivalCompletion | null => {
  if (!REVIVAL_WAKES.has(wake.type) || wake.status !== "pending" || !["background_revival", "routine"].includes(wake.run.origin)) return null;
  const revival = (wake.payload as { revival?: RevivalCompletion } | null)?.revival;
  return typeof revival?.block === "string" ? revival : null;
};

/** A background result resumes either the chat it came from or the routine run that started it. */
export const routineRevivalContext = (wake: RevivalWake): string | null =>
  wake.run.origin === "routine" && revivalOf(wake)
    ? ((wake.payload as { automationContextRunId?: unknown }).automationContextRunId as string | undefined) ?? null
    : null;

/**
 * Background results ready in the same channel when the agent becomes free reach it
 * as one revival, as in the reference; a result that waited says how long. Null keeps
 * the claimed wake's own prompt.
 */
export const revivalBatch = <T extends RevivalWake>(claimed: T, pending: readonly T[], now = Date.now()): { content: string; folded: T[] } | null => {
  const batch = revivalBatchContent(claimed, pending, now);
  // The batch keeps the claimed wake's <timestamp> and <user_query> framing.
  const previous = (claimed.payload as { content?: unknown } | null)?.content;
  return batch && { ...batch, content: retimestampUserTurn(typeof previous === "string" ? previous : "", batch.content) };
};

const revivalBatchContent = <T extends RevivalWake>(claimed: T, pending: readonly T[], now: number): { content: string; folded: T[] } | null => {
  if (claimed.type === "automation.wake_parent") {
    if (claimed.status !== "pending") return null;
    const handoff = (claimed.payload as { handoff?: unknown } | null)?.handoff;
    const heldForMs = now - claimed.createdAt.getTime();
    return typeof handoff === "string" && heldForMs >= REVIVAL_HELD_AFTER_MS ? { content: renderAutomationHandoffPrompt(handoff, heldForMs), folded: [] } : null;
  }
  if (!revivalOf(claimed)) return null;
  const routine = routineRevivalContext(claimed);
  if (claimed.run.origin === "routine") {
    // A routine run gets every result of its background work in one quiet turn, never marked held.
    if (!routine) return null;
    const folded = pending.filter((wake) => wake.id !== claimed.id && routineRevivalContext(wake) === routine);
    if (!folded.length) return null;
    const blocks = [claimed, ...folded].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((wake) => revivalOf(wake)!.block);
    return { content: renderQuietRevivalBatchPrompt(blocks), folded };
  }
  const folded = pending.filter((wake) => wake.id !== claimed.id && wake.run.origin === "background_revival" && wake.run.channelId === claimed.run.channelId && revivalOf(wake));
  const completions = [claimed, ...folded]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((wake) => {
      const heldForMs = now - wake.createdAt.getTime();
      return { ...revivalOf(wake)!, ...(heldForMs >= REVIVAL_HELD_AFTER_MS ? { heldForMs } : {}) };
    });
  if (completions.length === 1 && completions[0]!.heldForMs === undefined) return null;
  return { content: renderRevivalBatchPrompt(completions), folded };
};

/** Turn notes (profile and instruction updates, reminders) go in one reminder block ahead of the query. */
export const turnContentWithNotes = (
  input: {
    origin: RunOrigin;
    inboxType?: string;
    appendReplyReminder?: boolean;
    directTextReply?: boolean;
    runtimeProfile: "agent" | "subagent";
    notes: ReadonlyArray<string | null | undefined>;
    unfinishedTasks?: boolean;
  },
  content: string
): string =>
  withTurnSystemReminder(
    turnSystemReminder(input.notes, {
      unfinishedTasks: input.unfinishedTasks,
      reply:
        input.appendReplyReminder === true &&
        !input.directTextReply &&
        input.runtimeProfile === "agent" &&
        turnOwesReplyReminder(input.origin, content, input.inboxType),
    }),
    input.directTextReply && input.inboxType === "ack.redrive" && content === SEND_TO_USER_REPLY_NUDGE_PROMPT
      ? "The user still needs the result of the previous turn. Deliver it directly as assistant text. If the result requires a card or attachment, use SendRichMessageToUser."
      : content
  );

const assetRefs = (value: unknown): AssetRef[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (candidate): candidate is AssetRef =>
        Boolean(candidate) &&
        typeof candidate === "object" &&
        typeof (candidate as { assetId?: unknown }).assetId === "string" &&
        /^[a-f0-9]{64}$/.test((candidate as { assetId: string }).assetId) &&
        typeof (candidate as { fileName?: unknown }).fileName === "string" &&
        typeof (candidate as { mimeType?: unknown }).mimeType === "string" &&
        typeof (candidate as { byteSize?: unknown }).byteSize === "number" &&
        ["image", "video", "audio", "pdf", "text", "file"].includes(
          String((candidate as { kind?: unknown }).kind)
        )
    )
    .slice(0, CLIENT_CAPABILITIES.uploads.maxAttachmentsPerMessage);
};

/** The computer settled the turn as stopped (the cancel-run API), even before the server records the cancel. */
export class TurnStoppedError extends Error {}

export const turnCompletionFailure = (
  event: Extract<ComputerEvent, { type: "turn.completed" }>
): Error | null => {
  if (event.status === "completed") return null;
  const runtimeMessage =
    event.error &&
    typeof event.error === "object" &&
    "message" in event.error &&
    typeof event.error.message === "string"
      ? event.error.message
      : null;
  const message = runtimeMessage ?? `Computer turn ended with status ${event.status}`;
  return event.status === "cancelled" ? new TurnStoppedError(message) : new Error(message);
};

/** The learner reviews every memorable turn: what the bot sent plus all its own text, even when both are empty. */
export const resolveTurnMemoryExchange = (input: {
  visibleUser?: { content: string; createdAt: Date } | null;
  internalUser?: { content: string; createdAt: Date } | null;
  visibleAssistant: Array<{ content: string }>;
  internalAssistant: Array<{ content: string }>;
}): { user: string; assistant: string; occurredAt: number } | null => {
  const user = input.visibleUser?.content.trim() || input.internalUser?.content.trim() || "";
  const assistant = [...input.visibleAssistant, ...input.internalAssistant]
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");
  if (!user) return null;
  return {
    user,
    assistant,
    occurredAt: (
      input.visibleUser?.createdAt ??
      input.internalUser?.createdAt ??
      new Date()
    ).getTime(),
  };
};

export const terminalRoutineExecutionStatus = (
  runStatus: string
): "completed" | "failed" | "cancelled" | null => {
  if (runStatus === "completed") return "completed";
  if (runStatus === "cancelled") return "cancelled";
  if (runStatus === "failed" || runStatus === "interrupted") return "failed";
  return null;
};

export const terminalGroupRoutineExecutionStatus = (
  roundStatus: string,
  deliveryStatuses: readonly string[]
): "completed" | "failed" | null => {
  if (roundStatus === "failed") return "failed";
  if (roundStatus !== "completed") return null;
  return deliveryStatuses.some(status => status === "failed") ||
    (deliveryStatuses.length > 0 && deliveryStatuses.every((status) => status === "skipped"))
    ? "failed"
    : "completed";
};

export class WakeWorker {
  private readonly concurrentAutomations = new Set<Promise<void>>();
  private stopping = false;
  readonly prisma: PrismaClient;
  readonly boss: PgBoss;
  readonly projection: Projection;
  readonly computerUrl: string;
  readonly controlToken: string;
  readonly workspaceRoot: string;
  readonly agentData: AgentDataStore;
  readonly messaging: AgentMessaging;
  readonly routines: RoutineService;
  readonly pushNotifications: PushNotificationDispatcher;
  private routineTimer: ReturnType<typeof setInterval> | null = null;
  private agentStoreTimer: ReturnType<typeof setInterval> | null = null;
  private pushNotificationTimer: ReturnType<typeof setInterval> | null = null;
  private memoryReviewTimer: ReturnType<typeof setInterval> | null = null;
  private memoryReviewScanActive = false;
  private memoryReviewCursor: string | null = null;
  private readonly memoryReviews = new Map<string, Promise<void>>();
  private stalledWakeTimer: ReturnType<typeof setInterval> | null = null;
  private stalledWakeScanActive = false;
  private reconcilingAgentStores = false;
  private routinePassActive = false;
  private automationReconcileCursor: string | null = null;
  private agentStoreEtag: string | null = null;
  private pendingAgentStoreRecords = new Map<string, AgentDirectoryRecord>();
  private readonly transcriptFingerprints = new TranscriptFingerprintCache();

  constructor() {
    const databaseUrl = process.env.DATABASE_URL ?? "";
    this.prisma = createPrismaClient(databaseUrl);
    this.boss = new PgBoss({ connectionString: databaseUrl, useListenNotify: true });
    this.computerUrl = process.env.OUTCOMEGO_COMPUTER_URL ?? "http://127.0.0.1:8790";
    this.controlToken = process.env.OUTCOMEGO_CONTROL_TOKEN ?? "local-compose-only-change-me";
    this.workspaceRoot = process.env.OUTCOMEGO_WORKSPACE_ROOT ?? "/workspace";
    this.agentData = new AgentDataStore(this.prisma, {
      // Memory extraction runs on the main model, like the turn it reviews.
      memoryInference: async (request) => {
        const inference = await this.agentData.loadInferenceSettings();
        const { signal, ...inferenceRequest } = request;
        const response = await fetch(`${this.computerUrl}${COMPUTER_API_PATHS.inference}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.controlToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...inferenceRequest,
            model: formatPiModelRef(inference),
            reasoning: inference.reasoning,
          }),
          signal: AbortSignal.any([
            AbortSignal.timeout(request.timeoutMs),
            ...(signal ? [signal] : []),
          ]),
        });
        const body = (await response.json()) as { text?: unknown; error?: unknown };
        if (!response.ok || typeof body.text !== "string") {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : `Memory inference failed (${response.status})`
          );
        }
        return body.text;
      },
    });
    this.projection = new Projection(this.prisma, this.agentData);
    this.messaging = new AgentMessaging(this.prisma, this.boss, this.agentData);
    this.agentData.setTimelineEventSink((tx, input) =>
      appendAgentTimelineEvent(tx, this.messaging, input)
    );
    this.routines = new RoutineService(this.prisma, this.messaging, this.agentData);
    this.messaging.onGroupRoutineSettled = (settled) => this.routines.afterGroupExecution(settled);
    this.pushNotifications = new PushNotificationDispatcher(this.prisma);
    this.boss.on("error", (error) => console.error("pg-boss", error));
  }

  async start(): Promise<void> {
    await this.boss.start();
    for (const name of ["bot-wake", "bot-provision", "transcript-project", "routine-dispatch"]) {
      await this.boss.createQueue(name, { notify: true });
      // createQueue does not update queues created by an earlier version.
      await this.boss.updateQueue(name, { notify: true });
    }
    await this.boss.schedule("routine-dispatch", "* * * * *");
    await this.messaging.recoverRounds();
    await this.recoverDurableWork();
    await this.recoverMemoryReviews();
    await this.kickStalledWakes();
    await dispatchTaskContinuations(this.prisma, this.messaging);
    await dispatchRequestChecks(this.prisma, this.messaging);
    await recoverRequestProgress(this.prisma, this.messaging);
    await this.recoverRoutineExecutions();
    while (this.outcomeRecoveryCursor) await this.recoverOutcomeWorkItems();
    await this.reconcileRetiredAgents();
    await this.reconcileAgentStores();
    await this.agentData.reconcileAllActiveBots();
    await this.pushNotifications.drain();
    await workContinuously<WakeData>(
      this.boss,
      "bot-wake",
      Number(process.env.OUTCOMEGO_WORKER_CONCURRENCY ?? 8),
      (job) => this.handle(job)
    );
    await workContinuously<ProvisionData>(
      this.boss,
      "bot-provision",
      1,
      (job) => this.handleProvision(job)
    );
    await workContinuously<TranscriptData>(this.boss, "transcript-project", 1,
      (job) => this.handleTranscript(job));
    await workContinuously(this.boss, "routine-dispatch", 1,
      () => this.dispatchRoutinePass());
    this.routineTimer = setInterval(() => {
      void this.dispatchRoutinePass().catch((error) => console.error("routine-dispatch", error));
    }, 1_000);
    this.routineTimer.unref();
    this.agentStoreTimer = setInterval(() => {
      if (this.reconcilingAgentStores) return;
      this.reconcilingAgentStores = true;
      void this.reconcileRetiredAgents()
        .then(() => this.reconcileAgentStores(false))
        .then(async (adopted) => {
          if (adopted > 0) await this.agentData.reconcileAllActiveBots();
        })
        .catch((error) => console.error("agent-store-reconcile", error))
        .finally(() => {
          this.reconcilingAgentStores = false;
        });
    }, 5_000);
    this.agentStoreTimer.unref();
    this.pushNotificationTimer = setInterval(() => {
      void this.pushNotifications
        .drain()
        .catch((error) => console.error("push notification delivery", error));
    }, 2_000);
    this.pushNotificationTimer.unref();
    this.memoryReviewTimer = setInterval(() => {
      void this.recoverMemoryReviews().catch((error) => console.error("memory review recovery", error));
    }, 5_000);
    this.memoryReviewTimer.unref();
    this.stalledWakeTimer = setInterval(() => {
      void this.kickStalledWakes().catch((error) => console.error("stalled wake recovery", error));
    }, STALLED_WAKE_SCAN_MS);
    this.stalledWakeTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.routineTimer) clearInterval(this.routineTimer);
    this.routineTimer = null;
    if (this.agentStoreTimer) clearInterval(this.agentStoreTimer);
    this.agentStoreTimer = null;
    if (this.pushNotificationTimer) clearInterval(this.pushNotificationTimer);
    this.pushNotificationTimer = null;
    if (this.memoryReviewTimer) clearInterval(this.memoryReviewTimer);
    this.memoryReviewTimer = null;
    if (this.stalledWakeTimer) clearInterval(this.stalledWakeTimer);
    this.stalledWakeTimer = null;
    await this.boss.stop({ graceful: true });
    await Promise.allSettled([...this.concurrentAutomations]);
    await Promise.allSettled([...this.memoryReviews.values()]);
    await this.prisma.$disconnect();
  }

  private async dispatchRoutinePass(): Promise<void> {
    if (this.routinePassActive) return;
    this.routinePassActive = true;
    try {
      await dispatchTaskContinuations(this.prisma, this.messaging);
      await dispatchRequestChecks(this.prisma, this.messaging);
      await recoverRequestProgress(this.prisma, this.messaging);
      const reconciliation = await this.agentData.reconcileAutomationFilesBatch(
        this.automationReconcileCursor,
        AUTOMATION_RECONCILE_BATCH_SIZE
      );
      this.automationReconcileCursor = reconciliation.nextCursor;
      await this.recoverRoutineExecutions();
      await this.routines.dispatchDue();
    } finally {
      this.routinePassActive = false;
    }
  }

  private async reconcileRetiredAgents(): Promise<void> {
    const pending = await this.prisma.retiredAgent.findMany({
      where: { cleanupPending: true, nextCleanupAt: { lte: new Date() } },
      orderBy: [{ nextCleanupAt: "asc" }, { id: "asc" }],
      take: 4,
      select: { id: true },
    });
    await Promise.all(pending.map(async ({ id }) => {
      try {
        // Rotate failures out of the batch so one broken owner cannot starve cleanup.
        await this.prisma.retiredAgent.update({ where: { id }, data: {
          nextCleanupAt: new Date(Date.now() + RETIRED_AGENT_CLEANUP_RETRY_MS),
        } });
        const warnings = await cleanupRetiredAgent(
          this.prisma, (path, init) => this.computerFetch(path, init), this.agentData, id
        );
        for (const warning of warnings) console.warn(`retired agent cleanup: ${warning}`);
      } catch (error) {
        console.warn(`retired agent cleanup ${id}: ${String(error)}`);
      }
    }));
  }

  /** Durable markers survive event pruning and prevent deleted chats from returning. */
  private async retiredAgentIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const retired = await this.prisma.retiredAgent.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true },
    });
    return new Set(retired.map(({ id }) => id));
  }

  private async reconcileAgentStores(backfill = true): Promise<number> {
    const directoryResponse = await this.computerFetch(COMPUTER_API_PATHS.agentStores, {
      method: "GET",
      headers:
        !backfill && this.agentStoreEtag ? { "if-none-match": this.agentStoreEtag } : undefined,
    });
    if (directoryResponse.status === 304) {
      if (this.pendingAgentStoreRecords.size === 0) return 0;
    } else if (!directoryResponse.ok) {
      throw new Error(`Agent directory discovery failed: ${await directoryResponse.text()}`);
    }
    const responseEtag =
      directoryResponse.status === 304 ? null : directoryResponse.headers.get("etag");
    const directoryPayload =
      directoryResponse.status === 304
        ? null
        : parseAgentDirectorySnapshot(await directoryResponse.json());
    const directories = directoryPayload
      ? directoryPayload.agents.filter((record) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            record.id
          )
        )
      : [...this.pendingAgentStoreRecords.values()];

    let adopted = 0;
    const pending = new Map<string, AgentDirectoryRecord>();
    const agentRecords = directories.filter(({ kind }) => kind === "agent");
    const existingBotIds = new Set(
      agentRecords.length === 0
        ? []
        : (
            await this.prisma.bot.findMany({
              where: { id: { in: agentRecords.map(({ id }) => id) } },
              select: { id: true },
            })
          ).map(({ id }) => id)
    );
    const groupRecords = directories.filter(({ kind }) => kind === "group");
    const existingChannelIds = new Set(
      groupRecords.length === 0
        ? []
        : (
            await this.prisma.channel.findMany({
              where: { id: { in: groupRecords.map(({ id }) => id) } },
              select: { id: true },
            })
          ).map(({ id }) => id)
    );
    // A durable directory is roster authority, but a chat the owner deleted must never be adopted
    // back from the residue a failed cleanup left behind: deleting a chat is final.
    const retired = await this.retiredAgentIds([
      ...agentRecords.filter(({ id }) => !existingBotIds.has(id)).map(({ id }) => id),
      ...groupRecords.filter(({ id }) => !existingChannelIds.has(id)).map(({ id }) => id),
    ]);
    for (const record of agentRecords) {
      if (existingBotIds.has(record.id) || retired.has(record.id)) continue;
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`adopt-agent:${record.id}`}))`;
        await lockAgentLifecycle(tx, record.id);
        if (await tx.retiredAgent.findUnique({ where: { id: record.id } })) return false;
        if (await tx.bot.findUnique({ where: { id: record.id } })) return false;
        await tx.bot.create({
          data: {
            id: record.id,
            name: record.name || "New Bot",
            title: record.title,
            description: record.description,
            namedBy: "user",
            notificationsEnabled: record.notifyOnAgentUpdates,
            hiddenFromSidebar: record.hiddenFromSidebar,
            defaultDirectory: this.workspaceRoot,
            status: "active",
            onboardingStatus: "completed",
            onboardingCompletedAt: new Date(record.createdAt),
            createdAt: new Date(record.createdAt),
            conversation: { create: { createdAt: new Date(record.createdAt) } },
          },
        });
        await tx.channel.create({
          data: {
            kind: "bot_dm",
            name: record.name || "New Bot",
            directKey: `bot:${record.id}`,
            createdAt: new Date(record.createdAt),
            members: { create: { botId: record.id, ordinal: 0 } },
          },
        });
        return true;
      });
      if (created) adopted += 1;
    }

    const missingGroupRecords = groupRecords.filter(
      ({ id }) => !existingChannelIds.has(id) && !retired.has(id)
    );
    const candidateGroupMemberIds = [
      ...new Set(missingGroupRecords.flatMap(({ memberIds }) => memberIds.slice(0, 6))),
    ];
    const activeGroupMemberIds = new Set(
      candidateGroupMemberIds.length === 0
        ? []
        : (
            await this.prisma.bot.findMany({
              where: {
                id: { in: candidateGroupMemberIds },
                status: "active",
                subagentIdentity: { is: null },
              },
              select: { id: true },
            })
          ).map(({ id }) => id)
    );
    for (const record of groupRecords) {
      if (existingChannelIds.has(record.id) || retired.has(record.id)) continue;
      const memberIds = [...new Set(record.memberIds)].slice(0, 6);
      if (memberIds.length === 0) continue;
      if (memberIds.some((memberId) => !activeGroupMemberIds.has(memberId))) {
        pending.set(record.id, record);
        continue;
      }
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`adopt-group:${record.id}`}))`;
        // Discovery is a snapshot; deletion may commit before this transaction runs.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`channel:${record.id}`}))`;
        if (await tx.retiredAgent.findUnique({ where: { id: record.id } })) return false;
        if (await tx.channel.findUnique({ where: { id: record.id } })) return false;
        await tx.channel.create({
          data: {
            id: record.id,
            kind: "group",
            name: record.name || "Group",
            description: record.description,
            workingDirectory: this.workspaceRoot,
            createdAt: new Date(record.createdAt),
            members: {
              create: memberIds.map((botId, ordinal) => ({ botId, ordinal })),
            },
          },
        });
        return true;
      });
      if (created) adopted += 1;
    }

    // A failed DELETE leaves discovery's ETag unchanged. Retain the record so a
    // subsequent 304 still retries disposal instead of permanently hiding it.
    for (const record of directories.filter(({ id }) => retired.has(id))) {
      try {
        const response = await this.computerFetch(COMPUTER_API_PATHS.agentStore(record.id), {
          method: "DELETE", signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      } catch (error) {
        pending.set(record.id, record);
        console.warn(`retired agent store ${record.id} could not be discarded: ${String(error)}`);
      }
    }
    this.pendingAgentStoreRecords = pending;
    if (responseEtag) this.agentStoreEtag = responseEtag;

    if (!backfill) return adopted;

    const [bots, groups] = await Promise.all([
      this.prisma.bot.findMany({
        where: { status: { in: ["active", "provisioning"] }, subagentIdentity: { is: null } },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.channel.findMany({
        where: { kind: "group", archivedAt: null },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    for (const owner of [...bots, ...groups]) {
      const response = await this.computerFetch(COMPUTER_API_PATHS.agentStore(owner.id), {
        method: "PUT",
        body: JSON.stringify({ createdAt: owner.createdAt.getTime() }),
      });
      if (!response.ok) {
        throw new Error(`Agent store backfill failed for ${owner.id}: ${await response.text()}`);
      }
    }
    const response = await this.computerFetch(COMPUTER_API_PATHS.reconcileAgentStores, {
      method: "POST",
      body: JSON.stringify({ ownerIds: [...bots, ...groups].map(({ id }) => id) }),
    });
    if (!response.ok) {
      throw new Error(`Agent store ownership reconciliation failed: ${await response.text()}`);
    }
    for (const bot of bots) {
      await this.boss.send("transcript-project", { botId: bot.id });
    }
    return adopted;
  }

  /** Durable rows survive a missed queue notification, an expired owner and a crash
   * between completion projection and inbox settlement. Never interrupt a live lease. */
  async kickStalledWakes(): Promise<void> {
    if (this.stalledWakeScanActive) return;
    this.stalledWakeScanActive = true;
    try {
      const now = new Date();
      const terminal = await this.prisma.inboxEvent.findMany({
        where: {
          status: "processing",
          run: {
            status: { in: ["completed", "cancelled"] },
            NOT: { lease: { is: { expiresAt: { gt: now } } } },
          },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        include: { run: { include: { lease: true } }, bot: { select: { subagentIdentity: { select: { id: true } } } } },
        take: 100,
      });
      for (const inbox of terminal) {
        try {
          await this.settleCompletedWake({
            botId: inbox.botId, runId: inbox.runId, inboxId: inbox.id, inboxType: inbox.type,
            attempt: inbox.attempts, ownerId: inbox.run.lease?.ownerId ?? "",
            origin: inbox.run.origin, runtimeProfile: inbox.bot.subagentIdentity ? "subagent" : "agent",
            channelId: inbox.run.channelId ?? "", runChannelId: inbox.run.channelId, deliveryId: inbox.run.deliveryId,
          });
        } catch (error) {
          console.error("deferred wake settlement", { runId: inbox.runId, error });
        }
      }
      const stalled = await this.prisma.inboxEvent.findMany({
        where: {
          availableAt: { lte: now }, bot: { status: "active" },
          OR: [
            { status: "pending" },
            { status: "processing", claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
          ],
          run: {
            status: { in: ["queued", "running"] },
            NOT: { lease: { is: { expiresAt: { gt: now } } } },
          },
        },
        orderBy: [{ availableAt: "asc" }, { id: "asc" }],
        distinct: ["botId"], select: { botId: true }, take: 100,
      });
      for (const { botId } of stalled) {
        await this.boss.send("bot-wake", { botId }, {
          retryLimit: 5, retryDelay: 2, retryBackoff: true, expireInSeconds: 3 * 60,
        });
      }
      if (terminal.length || stalled.length) console.info("wake recovery sweep", {
        terminal: terminal.length, queuedBots: stalled.length,
      });
    } finally {
      this.stalledWakeScanActive = false;
    }
  }

  private async recoverDurableWork(): Promise<void> {
    const provisioning = await this.prisma.bot.findMany({
      where: { status: "provisioning" },
      select: { id: true },
    });
    for (const bot of provisioning) {
      await this.boss.send(
        "bot-provision",
        { botId: bot.id },
        {
          retryLimit: 8,
          retryDelay: 2,
          retryBackoff: true,
          expireInSeconds: 3 * 60,
        }
      );
    }

    const bootstrap = await this.prisma.bot.findMany({
      where: { status: "active", onboardingStatus: "pending" },
      select: {
        id: true,
        channelMemberships: {
          where: { channel: { kind: "bot_dm", archivedAt: null } },
          select: { channelId: true },
          take: 1,
        },
      },
    });
    for (const bot of bootstrap) {
      const channelId = bot.channelMemberships[0]?.channelId;
      if (!channelId) continue;
      await this.prisma.$transaction((tx) =>
        this.messaging.enqueueBootstrap(tx, bot.id, channelId)
      );
    }

    const pending = await this.prisma.inboxEvent.findMany({
      where: {
        status: "pending",
        availableAt: { lte: new Date() },
        bot: { status: "active" },
      },
      distinct: ["botId"],
      select: { botId: true },
    });
    for (const event of pending) {
      await this.boss.send(
        "bot-wake",
        { botId: event.botId },
        {
          retryLimit: 5,
          retryDelay: 2,
          retryBackoff: true,
          expireInSeconds: 3 * 60,
        }
      );
    }
  }

  private routineRecoveryCursor: string | null = null;
  private routineFollowUpCursor: string | null = null;

  private async recoverRoutineExecutions(): Promise<void> {
    const executions = await this.prisma.routineExecution.findMany({
      where: {
        status: { in: ["queued", "running"] },
        OR: [{ runId: { not: null } }, { channelMessageId: { not: null } }],
        routine: {
          OR: [{ bot: { status: "active" } }, { channel: { kind: "group", archivedAt: null } }],
        },
        ...(this.routineRecoveryCursor ? { id: { gt: this.routineRecoveryCursor } } : {}),
      },
      select: {
        id: true,
        runId: true,
        channelMessageId: true,
        routine: { select: { botId: true, channelId: true } },
        run: { select: { status: true, completedAt: true, error: true } },
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    this.routineRecoveryCursor = executions.length === 100 ? executions[99]!.id : null;
    for (const execution of executions) {
      try {
        if (execution.runId && execution.run) {
          const updated = await this.prisma.$transaction(async tx => {
            // Follow-up creation takes this gate; archive takes it before
            // stopping runs and executions, so acquire it before settlement.
            await this.lockRoutineRunLifecycle(tx, execution.runId!);
            const settled = await reconcileRoutineExecution(tx, execution.runId!);
            if (settled) await this.routines.afterExecution(tx, settled);
            return settled;
          });
          if (updated && execution.routine.botId) {
            await this.syncRoutineRunFile(execution.routine.botId, execution.runId);
          }
        } else if (execution.channelMessageId && execution.routine.channelId) {
          await this.recoverGroupRoutineExecution(execution.id, execution.channelMessageId);
        }
      } catch (error) {
        console.error("Routine execution recovery deferred", execution.id, error);
      }
    }
    // A follow-up holding coalesced events has no wake or room turn until the run before it settles.
    const followUps = await this.prisma.routineExecution.findMany({
      where: {
        status: "queued", runId: null, channelMessageId: null,
        routine: { OR: [{ bot: { status: "active" } }, { channel: { kind: "group", archivedAt: null } }] },
        ...(this.routineFollowUpCursor ? { id: { gt: this.routineFollowUpCursor } } : {}),
      },
      select: { id: true, routineId: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    this.routineFollowUpCursor = followUps.length === 100 ? followUps[99]!.id : null;
    for (const { routineId } of followUps) {
      try {
        await this.routines.runEventFollowUp(routineId);
      } catch (error) {
        console.error("Routine follow-up recovery deferred", routineId, error);
      }
    }
    await this.recoverOutcomeWorkItems();
    // A turn whose run ended without settling it (a crash in between) is settled here.
    await settleFinishedOutcomeThreadTurns(this.prisma).catch((error) => console.error("goal thread turn recovery", error));
  }

  private outcomeRecoveryCursor: string | null = null;

  private async recoverOutcomeWorkItems(): Promise<void> {
    // Physical cancellation is outside the transaction adapter. The adapter
    // rechecks leases under the Outcome lock before consuming this confirmation.
    const stale = await this.prisma.run.findMany({
      where: { origin: "outcome", outcomeWorkItemId: { not: null },
        AND: [
          { OR: [{ status: "running" }, { status: "queued", inboxEvents: { none: { status: "pending" } } }] },
          { OR: [{ lease: null }, { lease: { expiresAt: { lte: new Date() } } }] },
        ],
        ...(this.outcomeRecoveryCursor ? { outcomeWorkItem: { id: { gt: this.outcomeRecoveryCursor } } } : {}) },
      orderBy: { outcomeWorkItemId: "asc" }, take: 100, select: { id: true },
    });
    const confirmedStoppedRunIds = new Set<string>();
    for (const { id: runId } of stale) {
      try {
        const response = await this.computerFetch(COMPUTER_API_PATHS.turnCancel(runId), { method: "POST", body: JSON.stringify({ recovery: true }) });
        if (response.ok || response.status === 400 && (await response.text()).includes("Run is not actively executing")) confirmedStoppedRunIds.add(runId);
      } catch { /* Keep the old facts until the computer confirms the turn stopped. */ }
    }
    const batch = await recoverOutcomeWorkItems(this.prisma, {
      messaging: this.messaging, workspaceRoot: this.workspaceRoot,
      confirmedStoppedRunIds,
    }, this.outcomeRecoveryCursor);
    this.outcomeRecoveryCursor = batch.nextCursor;
  }

  private async recoverGroupRoutineExecution(
    executionId: string,
    rootMessageId: string
  ): Promise<void> {
    // The round is committed before its initial handoff. Retry that handoff
    // outside the settlement transaction after an interrupted launch.
    const pendingRounds = await this.prisma.channelRound.findMany({
      where: { rootMessageId, status: { in: ["queued", "running"] } },
      select: { id: true },
    });
    for (const round of pendingRounds) await this.messaging.advanceRound(round.id);
    const settled = await this.prisma.$transaction(async (tx) => {
      const execution = await tx.routineExecution.findUnique({
        where: { id: executionId },
        include: { routine: { select: { runLedger: true, channelId: true } } },
      });
      if (
        !execution ||
        !execution.routine.channelId ||
        !["queued", "running"].includes(execution.status)
      ) {
        return;
      }
      const round = await tx.channelRound.findFirst({
        where: { rootMessageId },
        orderBy: { roundIndex: "desc" },
        include: { deliveries: { select: { status: true } } },
      });
      if (!round) return;
      const state = await groupRoutineState(tx, rootMessageId);
      if (state.active) return;
      const status = state.failed ? "failed" : "completed";
      const finishedAt = state.completedAt ?? round.completedAt ?? new Date();
      const errorKind =
        status === "failed"
          ? round.status === "failed"
            ? "group_routine_round_failed"
            : "group_routine_delivery_failed"
          : null;
      const updated = await tx.routineExecution.updateMany({
        where: {
          id: execution.id,
          status: { in: ["queued", "running"] },
        },
        data: {
          status,
          completedAt: finishedAt,
          ...(errorKind ? { error: { code: errorKind } } : {}),
        },
      });
      if (updated.count === 0) return;
      await tx.routine.update({
        where: { id: execution.routineId },
        data: {
          runLedger: appendRoutineRunLedger(execution.routine.runLedger, {
            id: execution.id,
            trigger: execution.kind === "scheduled" ? "schedule" : "manual",
            startedAt: (
              execution.startedAt ??
              execution.enqueuedAt ??
              execution.scheduledFor
            ).getTime(),
            finishedAt: finishedAt.getTime(),
            status: status === "completed" ? "ok" : "error",
            ...(errorKind ? { errorKind } : {}),
          }),
        },
      });
      await tx.event.create({
        data: {
          topic: `routine.execution.${status}`,
          entityId: execution.id,
          payload: {
            executionId: execution.id,
            routineId: execution.routineId,
            channelId: execution.routine.channelId,
            rootMessageId,
            status,
            recovered: true,
          },
        },
      });
      return { executionId: execution.id, routineId: execution.routineId };
    });
    if (settled) await this.routines.afterGroupExecution(settled);
  }

  private async handleProvision(job: JobWithMetadata<ProvisionData>): Promise<void> {
    const botId = job.data.botId;
    const bot = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`provision:${botId}`}))`;
      return tx.bot.findUnique({
        where: { id: botId },
        include: {
          channelMemberships: {
            where: { channel: { kind: "bot_dm", archivedAt: null } },
            select: { channelId: true },
            take: 1,
          },
        },
      });
    });
    if (!bot || bot.status === "archived" || bot.status === "active") return;
    if (bot.status === "failed") return;

    try {
      const response = await this.computerFetch(`/v1/workspaces/${bot.id}`, {
        method: "PUT",
        body: JSON.stringify({ path: bot.defaultDirectory }),
        signal: AbortSignal.timeout(3 * 60_000),
      });
      if (!response.ok) throw new Error(await response.text());
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`provision:${botId}`}))`;
        const current = await tx.bot.findUnique({ where: { id: botId } });
        if (!current || current.status === "archived") return;
        await tx.bot.update({
          where: { id: botId },
          data: { status: "active", provisioningError: Prisma.DbNull },
        });
        await tx.event.create({
          data: {
            topic: "bot.ready",
            entityId: botId,
            payload: { botId, defaultDirectory: bot.defaultDirectory },
          },
        });
        const channelId = bot.channelMemberships[0]?.channelId;
        if (channelId && current.onboardingStatus === "pending") {
          await this.messaging.enqueueBootstrap(tx, botId, channelId);
        }
        const pending = await tx.inboxEvent.count({
          where: {
            botId,
            status: "pending",
            availableAt: { lte: new Date() },
          },
        });
        if (pending > 0) {
          await this.boss.send(
            "bot-wake",
            { botId },
            {
              db: fromPrisma(tx),
              retryLimit: 5,
              retryDelay: 2,
              retryBackoff: true,
              expireInSeconds: 3 * 60,
            }
          );
        }
        await this.messaging.scheduleTranscriptProjection(tx, [botId]);
      });
      await this.agentData.projectBot(botId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finalAttempt = job.retryCount >= job.retryLimit;
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.bot.findUnique({ where: { id: botId } });
        if (!current || current.status === "archived") return;
        await tx.bot.update({
          where: { id: botId },
          data: {
            status: finalAttempt ? "failed" : "provisioning",
            provisioningError: {
              message,
              retryCount: job.retryCount,
              finalAttempt,
            },
          },
        });
        await tx.event.create({
          data: {
            topic: finalAttempt ? "bot.provisioning_failed" : "bot.provisioning_retry",
            entityId: botId,
            payload: {
              botId,
              message,
              retryCount: job.retryCount,
              finalAttempt,
            },
          },
        });
        if (finalAttempt) {
          const subagent = await tx.subagent.findUnique({
            where: { childBotId: botId },
          });
          if (subagent && !["completed", "failed", "stopped"].includes(subagent.status)) {
            const attempt = subagent.currentRunId
              ? await tx.subagentAttempt.findUnique({
                  where: { childRunId: subagent.currentRunId },
                })
              : null;
            await tx.subagent.update({
              where: { id: subagent.id },
              data: {
                status: "failed",
                completedAt: new Date(),
                error: { code: "provisioning_failed", message },
              },
            });
            if (attempt) {
              await tx.subagentAttempt.update({
                where: { id: attempt.id },
                data: {
                  status: "failed",
                  completedAt: new Date(),
                  error: { code: "provisioning_failed", message },
                },
              });
            }
            if (attempt) {
              await this.notifySubagentParent(
                tx,
                {
                  ...subagent,
                  parentRunId: attempt.parentRunId,
                  parentChannelId: attempt.parentChannelId,
                  description: attempt.description,
        prompt: attempt.prompt,
                  currentRunId: attempt.childRunId,
                },
                "failed",
                message
              );
            }
          }
        }
      });
      throw error;
    }
  }

  private async handleTranscript(job: Job<TranscriptData>): Promise<void> {
    const bot = await this.prisma.bot.findUnique({
      where: { id: job.data.botId },
    });
    if (!bot || bot.status === "archived") return;
    const transcript = await buildSafeTranscript(this.prisma, bot.id);
    const fingerprint = transcriptEventsFingerprint(transcript.events);
    if (this.transcriptFingerprints.matches(bot.id, fingerprint)) return;
    const response = await this.computerFetch(`/v1/transcripts/${bot.id}`, {
      method: "PUT",
      body: JSON.stringify(transcript),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Transcript projection failed: ${await response.text()}`);
    this.transcriptFingerprints.remember(bot.id, fingerprint);
  }

  private async handle(job: Job<WakeData>): Promise<void> {
    const botId = job.data.botId;
    while (!this.stopping) {
      const claimed = await this.claim(botId);
      if (!claimed) return;
      if (["routine", "outcome", "outcome_thread"].includes(claimed.origin)) {
        const task = this.execute(claimed).catch((error) => {
          console.warn("Automation execution failed; durable recovery will reconcile its run", {
            runId: claimed.runId, error: error instanceof Error ? error.message : String(error),
          });
        }).finally(() => {
          this.concurrentAutomations.delete(task);
          if (!this.stopping) void this.handle(job).catch(() => { if (!this.stopping) console.warn("Automation queue resume failed", { botId }); });
        });
        this.concurrentAutomations.add(task);
      } else await this.execute(claimed);
    }
  }

  private async claim(botId: string): Promise<Claimed | null> {
    const ownerId = crypto.randomUUID();
    const staleAt = new Date(Date.now() - LEASE_MS);
    try {
      const select = () => this.prisma.$transaction<Claimed | "retry" | null>(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${TASK_RECOVERY_LOCK}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-run-claim:${botId}`}))`;
        // A crash can land between the terminal run event and lease cleanup.
        // Such a lease must not block fresh input until its heartbeat expires.
        await tx.botRunLease.deleteMany({
          where: { botId, OR: [
            { expiresAt: { lt: new Date() } },
            { run: { status: { in: ["completed", "failed", "cancelled", "interrupted"] } } },
          ] },
        });
        const existingLeases = await tx.botRunLease.findMany({ where: { botId } });
        const foregroundBusy = existingLeases.some(lease => lease.scope === "foreground");
        const automations = existingLeases.filter(lease => lease.scope.startsWith("automation:"));
        const outcomes = existingLeases.filter(lease => lease.scope.startsWith("outcome:"));
        const threadLeaseRunIds = existingLeases
          .filter((lease) => lease.scope.startsWith("outcome-thread:"))
          .map((lease) => lease.runId);
        const threadTurnPurposes = threadLeaseRunIds.length
          ? new Map(
              (
                await tx.outcomeThreadTurn.findMany({
                  where: { runId: { in: threadLeaseRunIds } },
                  select: { runId: true, purpose: true },
                })
              ).map((row) => [row.runId!, row.purpose] as const)
            )
          : new Map();
        const threadCounts = countThreadLeasesByRole(threadLeaseRunIds, threadTurnPurposes);
        if (
          foregroundBusy &&
          automations.length >= 4 &&
          outcomes.length >= 2 &&
          threadCounts.planner >= PLANNER_TURN_CONCURRENCY &&
          threadCounts.reviewer >= REVIEWER_TURN_CONCURRENCY
        ) {
          return null;
        }
        const pendingCandidates = await tx.inboxEvent.findMany({
          where: {
            botId,
            OR: [
              { status: "pending" },
              { status: "processing", claimedAt: { lt: staleAt } },
            ],
            availableAt: { lte: new Date() },
            bot: { status: "active" },
            run: {
              status: { in: ["queued", "running"] },
              // Expired Outcome execution is fenced by recovery before a new turn
              // is created. Never dispatch the same running turn to a second owner.
              NOT: { origin: { in: ["outcome", "outcome_thread"] }, status: "running" },
              origin: { notIn: [
                ...(foregroundBusy ? ["user", "agent", "group", "bootstrap", "event", "connector", "background_revival", "handoff_resume", "broadcast"] as const : []),
                ...(automations.length >= 4 ? ["routine"] as const : []),
                ...(outcomes.length >= 2 || !outcomeDispatchEnabled() ? ["outcome"] as const : []),
              ] },
            },
          },
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
          include: {
            bot: { include: { subagentIdentity: true } },
            conversation: true,
            run: { include: { channel: true } },
          },
        });
        const candidates = [];
        for (const candidate of pendingCandidates) {
          // Handoff and Stop serialize on this same bot claim lock. Recheck
          // durable context facts even when the callback was queued earlier.
          let automationEnded = candidate.run.origin === "routine" &&
            !await automationContinuationRoute(tx, botId, candidate.runId);
          if (candidate.type === "automation.wake_parent" && candidate.run.origin === "background_revival") {
            const handoff = await tx.automationResult.findUnique({
              where: { wakeRunId: candidate.runId },
              select: { run: { select: { status: true, error: true, requestStoppedAt: true } } },
            });
            automationEnded = !!handoff && requestIsStopped(handoff.run);
          }
          if (!automationEnded && (candidate.run.origin === "user" || candidate.run.origin === "outcome" || candidate.run.origin === "outcome_thread" || await requestWakeAllowed(tx, candidate))) candidates.push(candidate);
          else {
            const settledAt = new Date();
            const error = { code: automationEnded ? "automation_context_ended" : "request_check_superseded" };
            await tx.inboxEvent.update({ where: { id: candidate.id }, data: { status: "completed", completedAt: settledAt } });
            await tx.run.update({ where: { id: candidate.runId }, data: { status: "cancelled", completedAt: settledAt, error } });
          }
        }
        // As in the reference's automation runs, a routine hears from its background work once
        // none of it is still running; the last result to finish wakes it with all of them.
        const busyRoutines = new Set<string>();
        for (const context of new Set(candidates.flatMap((candidate) => routineRevivalContext(candidate) ?? [])))
          if (await automationBackgroundWorkRunning(tx, botId, context)) busyRoutines.add(context);
        let inbox: typeof candidates[number] | undefined;
        for (const candidate of candidates) {
          // A goal's own thread (specs/004.8): one turn at a time per thread, never blocked by the main chat.
          if (candidate.run.origin === "outcome_thread") {
            if (existingLeases.some(lease => lease.scope === `outcome-thread:${candidate.run.outcomeThreadId}`)) continue;
            const current = await tx.inboxEvent.findUnique({ where: { id: candidate.id }, include: { run: true } });
            if (!current || current.run.status !== "queued"
              || !(current.status === "pending" || current.status === "processing" && current.claimedAt && current.claimedAt < staleAt)) continue;
            const turn = await tx.outcomeThreadTurn.findUnique({
              where: { runId: candidate.runId }, include: { thread: { select: { outcome: { select: { cancelledAt: true, acceptedAt: true } } } } },
            });
            if (!turn || turn.status === "completed" || turn.status === "failed" || turn.thread.outcome.cancelledAt || turn.thread.outcome.acceptedAt) {
              await tx.inboxEvent.updateMany({ where: { id: candidate.id, status: "pending" }, data: { status: "completed", completedAt: new Date() } });
              await tx.run.updateMany({ where: { id: candidate.runId, status: "queued", startedAt: null }, data: { status: "cancelled", completedAt: new Date(), error: { code: "outcome_thread_not_runnable" } } });
              continue;
            }
            if (!canClaimThreadTurn(turn.purpose, threadCounts)) continue;
            inbox = candidate;
            break;
          }
          if (candidate.run.origin !== "outcome") {
            if (candidate.run.origin !== "routine") {
              if (foregroundBusy) continue;
            } else {
              const payload = candidate.payload as { automationContextRunId?: string };
              if (busyRoutines.has(routineRevivalContext(candidate) ?? "")
                || automations.some(lease => lease.scope === `automation:${payload.automationContextRunId ?? candidate.runId}`)) continue;
            }
            if (candidate.type === "user.reaction") {
              const channelId = candidate.run.channelId;
              if (channelId) {
                await lockGroupExecution(tx, channelId);
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`channel:${channelId}`}))`;
              }
              const current = await tx.inboxEvent.findUnique({
                where: { id: candidate.id },
                include: { run: true },
              });
              if (!current ||
                !(current.status === "pending" || current.status === "processing" && current.claimedAt && current.claimedAt < staleAt) ||
                !["queued", "running"].includes(current.run.status)) return "retry";
              if (!channelId || !await tx.channel.count({
                where: { id: channelId, archivedAt: null, members: { some: { botId } } },
              })) {
                const completedAt = new Date();
                const error = { code: "reaction_channel_unavailable" };
                await tx.inboxEvent.update({
                  where: { id: candidate.id },
                  data: { status: "completed", completedAt, error },
                });
                await tx.run.update({
                  where: { id: candidate.runId },
                  data: { status: "cancelled", completedAt, error },
                });
                // Release this room's locks before looking at another candidate.
                return "retry";
              }
            }
            inbox = candidate;
            break;
          }
          if (outcomes.some(lease => lease.scope === `outcome:${candidate.run.outcomeWorkItemId}`)) continue;
          const found = candidate.run.outcomeWorkItemId
            ? await tx.outcomeWorkItem.findUnique({ where: { id: candidate.run.outcomeWorkItemId }, select: { outcomeId: true } }) : null;
          if (found) {
            // A Stop can hold several Outcomes in UUID order. Candidate priority
            // order differs, so never wait while retaining another candidate's lock.
            const [outcomeLock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
              SELECT pg_try_advisory_xact_lock(hashtext(${`outcome:${found.outcomeId}`})) AS locked`;
            if (!outcomeLock?.locked) continue;
            const [itemLock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
              SELECT pg_try_advisory_xact_lock(hashtext(${`outcome-work-item:${candidate.run.outcomeWorkItemId}`})) AS locked`;
            if (!itemLock?.locked) continue;
          }
          const current = await tx.inboxEvent.findUnique({ where: { id: candidate.id }, include: { run: true } });
          if (!current || current.run.status !== "queued"
            || !(current.status === "pending" || current.status === "processing" && current.claimedAt && current.claimedAt < staleAt)) continue;
          const item = candidate.run.outcomeWorkItemId
            ? await tx.outcomeWorkItem.findUnique({ where: { id: candidate.run.outcomeWorkItemId }, include: { outcome: true, contractRevision: true } }) : null;
          if (!item || item.outcome.cancelledAt || item.outcome.acceptedAt || !item.contractRevision.approvedAt
            || !await isOutcomeDecisionRevisionActive(tx, item.outcomeId, item.contractRevisionId, item.id)
            || ["completed", "failed", "cancelled", "waiting_decision", "waiting_human", "needs_review"].includes(item.status)) {
            await tx.inboxEvent.updateMany({ where: { id: candidate.id, status: "pending" }, data: { status: "completed", completedAt: new Date() } });
            await tx.run.updateMany({ where: { id: candidate.runId, status: "queued", startedAt: null }, data: { status: "cancelled", completedAt: new Date(), error: { code: "outcome_not_runnable" } } });
            continue;
          }
          inbox = candidate;
          break;
        }
        if (!inbox) return null;
        const identity = inbox.bot.subagentIdentity;
        if (identity?.subagentType === "computerUse") {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`computer-screen:${identity.parentBotId}`}))`;
          const peers = await tx.subagent.findMany({
            where: { parentBotId: identity.parentBotId, subagentType: "computerUse", childBotId: { not: botId } },
            select: { childBotId: true, parentRunId: true },
          });
          const parentRuns = await tx.run.findMany({ where: { id: { in: [identity.parentRunId, ...peers.map(peer => peer.parentRunId)] } }, select: { id: true, origin: true } });
          const outcomeParents = new Set(parentRuns.filter(run => run.origin === "outcome").map(run => run.id));
          const conflicting = peers.filter(peer => outcomeParents.has(identity.parentRunId) || outcomeParents.has(peer.parentRunId));
          if (await tx.botRunLease.count({ where: { botId: { in: conflicting.map(peer => peer.childBotId) }, expiresAt: { gt: new Date() }, run: { status: "running" } } })) return null;
        }
        if (inbox.run.origin === "bootstrap") {
          // The first user message locks Bot before cancelling the greeting's Run.
          // Claim in that order too, then recheck the snapshot before reviving work.
          const [bot] = await tx.$queryRaw<Array<{ status: string; onboardingStatus: string }>>`
            SELECT "status", "onboardingStatus" FROM "outcomego_bot" WHERE "id" = ${botId} FOR NO KEY UPDATE`;
          const current = await tx.inboxEvent.findUnique({ where: { id: inbox.id }, include: { run: true } });
          if (!bot || bot.status !== "active" || !["pending", "queued", "running"].includes(bot.onboardingStatus) ||
              !current || !["queued", "running"].includes(current.run.status) ||
              !(current.status === "pending" || (current.status === "processing" && current.claimedAt && current.claimedAt < staleAt))) return null;
        }
        if (inbox.run.deliveryId && inbox.run.channelId) {
          // Selection is only a snapshot. Serialize the claim with room
          // supersession before changing any inbox, delivery, or run state.
          await lockGroupExecution(tx, inbox.run.channelId);
          const current = await tx.inboxEvent.findUnique({
            where: { id: inbox.id },
            include: { run: { include: { delivery: true } } },
          });
          if (!current ||
              !(current.status === "pending" || (current.status === "processing" && current.claimedAt && current.claimedAt < staleAt)) ||
              !["queued", "running"].includes(current.run.status) ||
              !["queued", "processing"].includes(current.run.delivery?.status ?? "")) return null;
        }
        const payload = inbox.payload as {
          content?: string;
          attachments?: unknown;
          clientId?: string;
          channelId?: string;
          automationContextRunId?: string;
          interruptedRunId?: unknown;
        };
        if (!payload.content || !payload.clientId) {
          await tx.inboxEvent.update({
            where: { id: inbox.id },
            data: { status: "failed", error: { code: "invalid_payload" } },
          });
          return null;
        }
        const lease = await tx.botRunLease.createMany({
          data: {
            botId,
            scope: inbox.run.origin === "outcome_thread" ? `outcome-thread:${inbox.run.outcomeThreadId}` : inbox.run.origin === "outcome" ? `outcome:${inbox.run.outcomeWorkItemId}` : inbox.run.origin === "routine" ? `automation:${payload.automationContextRunId ?? inbox.runId}` : "foreground",
            runId: inbox.runId,
            ownerId,
            expiresAt: new Date(Date.now() + LEASE_MS),
          },
          skipDuplicates: true,
        });
        if (lease.count === 0) throw new BotRunLeaseContended();
        await tx.inboxEvent.update({
          where: { id: inbox.id },
          data: {
            status: "processing",
            claimedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
        const batch = draftResponseBatch(inbox, candidates) ?? revivalBatch(inbox, candidates);
        if (batch) {
          const settledAt = new Date();
          const folded = batch.folded.map((wake) => wake.id);
          await tx.inboxEvent.updateMany({ where: { id: { in: folded } }, data: { status: "completed", claimedAt: settledAt, completedAt: settledAt } });
          await tx.run.updateMany({ where: { id: { in: batch.folded.map((wake) => wake.runId) } }, data: { status: "completed", startedAt: settledAt, completedAt: settledAt } });
          for (const wake of batch.folded) {
            await tx.inboxEvent.update({
              where: { id: wake.id },
              data: { payload: { ...(wake.payload as Prisma.JsonObject), batchedIntoRunId: inbox.runId } },
            });
            await tx.event.create({ data: { topic: "inbox.completed", entityId: wake.id, payload: { inboxId: wake.id, runId: wake.runId, batchedIntoRunId: inbox.runId } } });
          }
          // The claimed wake carries the whole batch from now on, also if it is claimed again.
          await tx.inboxEvent.update({ where: { id: inbox.id }, data: { payload: { ...(inbox.payload as Prisma.JsonObject), content: batch.content } } });
          const messageId = (inbox.payload as { messageId?: unknown }).messageId;
          if (typeof messageId === "string") await tx.message.update({ where: { id: messageId }, data: { content: batch.content } });
        }
        if (inbox.run.deliveryId) {
          const delivery = await tx.channelDelivery.update({
            where: { id: inbox.run.deliveryId },
            data: { status: "processing", startedAt: new Date() },
            include: { round: { select: { rootMessageId: true } } },
          });
          await tx.routineExecution.updateMany({ where: { channelMessageId: delivery.round.rootMessageId, status: "queued" }, data: { status: "running", startedAt: new Date() } });
        }
        await tx.run.update({
          where: { id: inbox.runId },
          data: { status: "running", startedAt: new Date() },
        });
        if (
          inbox.bot.subagentIdentity?.currentRunId === inbox.runId &&
          ["provisioning", "queued"].includes(inbox.bot.subagentIdentity.status)
        ) {
          await tx.subagent.update({
            where: { id: inbox.bot.subagentIdentity.id },
            data: { status: "running", startedAt: new Date() },
          });
          await tx.subagentAttempt.updateMany({
            where: {
              subagentId: inbox.bot.subagentIdentity.id,
              childRunId: inbox.runId,
              status: { in: ["provisioning", "queued"] },
            },
            data: { status: "running", startedAt: new Date() },
          });
        }
        await tx.routineExecution.updateMany({
          where: { runId: inbox.runId, status: "queued" },
          data: { status: "running", startedAt: new Date() },
        });
        if (inbox.run.origin === "outcome_thread") await startOutcomeThreadTurn(tx, inbox.runId);
        if (inbox.run.origin === "outcome") {
          const item = await tx.outcomeWorkItem.findUniqueOrThrow({ where: { id: inbox.run.outcomeWorkItemId! } });
          if (item.status !== "running") await transitionWorkItem(tx, { workItemId: item.id, to: "running", reason: "lease_acquired", actor: "system:worker" });
        }
        if (inbox.run.origin === "bootstrap") {
          await tx.bot.update({
            where: { id: botId },
            data: { onboardingStatus: "running" },
          });
          await tx.event.create({
            data: {
              topic: "bot.bootstrap.started",
              entityId: botId,
              payload: { botId, runId: inbox.runId },
            },
          });
        }
        await tx.event.create({
          data: {
            topic: "inbox.claimed",
            entityId: inbox.id,
            payload: { inboxId: inbox.id, runId: inbox.runId, ownerId },
          },
        });
        const runtimeOwners = subagentRuntimeOwners(botId, inbox.bot.subagentIdentity);
        const contextAddress = contextScopeForRun(
          inbox.run.origin,
          inbox.run.channelId,
          inbox.conversationId,
          payload.automationContextRunId ?? inbox.runId,
          inbox.run.outcomeWorkItemId,
          inbox.run.outcomeThreadId
        );
        const contextSession = await tx.contextSession.upsert({
          where: {
            botId_scope_scopeId: {
              botId,
              scope: contextAddress.scope,
              scopeId: contextAddress.scopeId,
            },
          },
          create: {
            botId,
            scope: contextAddress.scope,
            scopeId: contextAddress.scopeId,
            ...(contextAddress.scope === "home"
              ? {
                  runtimeSessionId: inbox.bot.runtimeSessionId,
                  runtimeSessionPath: inbox.bot.runtimeSessionPath,
                  compactionEpoch: inbox.conversation.compactionEpoch,
                }
              : {}),
          },
          update: {},
        });
        return {
          runChannelId: inbox.run.channelId,
          inboxId: inbox.id,
          inboxType: inbox.type,
          runId: inbox.runId,
          botId,
          contextSessionId: contextSession.id,
          ...runtimeOwners,
          conversationId: inbox.conversationId,
          ownerId,
          attempt: inbox.attempts + 1,
          content: batch?.content ?? payload.content,
          interruptedRunId: typeof payload.interruptedRunId === "string" ? payload.interruptedRunId : null,
          images: await this.messaging.assets.runtimeImages(assetRefs(payload.attachments)),
          clientId: payload.clientId,
          cwd: this.workspaceRoot,
          instructions: inbox.bot.instructions,
          sessionPath: contextSession.runtimeSessionPath,
          channelId: inbox.run.channelId ?? String(payload.channelId ?? ""),
          deliveryId: inbox.run.deliveryId,
          origin: inbox.run.origin,
          outcomeWorkItemId: inbox.run.outcomeWorkItemId,
          outcomeThreadId: inbox.run.outcomeThreadId,
          runtimeProfile: inbox.bot.subagentIdentity ? "subagent" : "agent",
          subagentType:
            (inbox.bot.subagentIdentity?.subagentType as SubagentType | undefined) ?? null,
          readOnly: inbox.bot.subagentIdentity?.readOnly ?? false,
          inferenceParentRunId: inbox.bot.subagentIdentity?.parentRunId ?? null,
          taskConfiguration: inbox.bot.subagentIdentity?.taskConfiguration ? parseTaskConfiguration(inbox.bot.subagentIdentity.taskConfiguration) : null,
          attachmentOwnerBotId: inbox.bot.subagentIdentity?.parentBotId ?? inbox.bot.id,
          fileAttachments: Array.isArray(inbox.bot.subagentIdentity?.fileAttachments)
            ? inbox.bot.subagentIdentity.fileAttachments.filter(
                (value): value is string => typeof value === "string"
              )
            : [],
        };
      });
      let selected = await select();
      while (selected === "retry") selected = await select();
      return selected;
    } catch (error) {
      if (error instanceof BotRunLeaseContended) return null;
      const code = (error as { code?: string }).code;
      if (code === "P2002") return null;
      throw error;
    }
  }

  private async execute(claimed: Claimed): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.heartbeat(claimed).catch((error) => console.error("run heartbeat", error));
    }, 30_000);
    let completion: Extract<ComputerEvent, { type: "turn.completed" }> | null = null;
    try {
      const skillAgent = pluginSkillAgent(claimed.runtimeProfile, claimed.subagentType);
      const [pluginContext, inference, configuredTasks, capabilities] = await Promise.all([
        subagentLoadsPluginContext(claimed.subagentType)
          ? pluginRuntimeContext(this.prisma, claimed.pluginBotId, skillAgent)
          : pluginSkillInstructions(this.prisma, claimed.pluginBotId, skillAgent).then((skillInstructions) => ({
              dynamicNamespaces: [], skillInstructions, pluginRuntimePackages: [],
            })),
        this.agentData.loadInferenceSettings(),
        this.agentData.loadTaskConfiguration(),
        this.loadTaskCapabilities(),
        this.reconcileContextState(claimed),
      ]);
      const taskConfiguration = selectTaskConfiguration(claimed.taskConfiguration ?? configuredTasks, capabilities);
      // Plugin skills are global/read-only inputs. User workflows are rendered
      // later by platformInstructions and therefore win on conflict.
      const platformPrompt = await this.messaging.platformPrompt(claimed.botId, claimed.contextSessionId,
        pluginContext.skillInstructions, claimed.runChannelId, taskConfiguration, claimed.origin, claimed.outcomeWorkItemId ?? undefined, claimed.outcomeThreadId ?? undefined,
        claimed.runtimeProfile === "agent" && !claimed.subagentType && !claimed.readOnly);
      // Replay failed user inputs whose durable-session delivery was never
      // acknowledged, including a turn a typed message superseded before its input
      // reached the model. Runtime message IDs prevent duplication after a lost ack.
      const missed = claimed.runtimeProfile === "agent" && !["routine", "outcome", "outcome_thread"].includes(claimed.origin) ? await this.prisma.inboxEvent.findMany({ where: { botId: claimed.botId, conversationId: claimed.conversationId, runId: { not: claimed.runId }, run: { channelId: claimed.channelId, origin: "user", inputDeliveredAt: null, OR: [{ status: { in: ["failed", "interrupted"] } }, { status: "cancelled", error: { path: ["code"], equals: "priority_peer_interrupt" } }] } }, orderBy: { createdAt: "asc" }, take: 20 }) : [];
      // Replayed inputs travel in the same request as this turn's images, so they share its
      // inline budget (the computer refuses bodies over 128 MiB); this turn's images go first.
      const budget = {
        images: MAX_TURN_INLINE_IMAGES - claimed.images.length,
        bytes: MAX_TURN_INLINE_IMAGE_BYTES - claimed.images.reduce((total, image) => total + dataUrlBytes(image.url), 0),
      };
      const missedMessages: Array<{ id: string; content: string; images: Array<{ url: string; alt?: string }> }> = [];
      for (const event of missed) {
        const payload = event.payload as { content?: string; clientId?: string; attachments?: unknown };
        if (!payload.content || !payload.clientId) continue;
        missedMessages.push({ id: `input:${payload.clientId}`, content: `[SAND_HIDDEN_PROMPT]Earlier user input whose delivery was interrupted:\n${payload.content}`, images: await this.messaging.assets.runtimeImages(assetRefs(payload.attachments), budget) });
      }
      const instructions = platformPrompt.instructions;
      // A goal's own thread tells the computer which goal and turn purpose it works on, so only allowed tools appear.
      const goalTurnRow = claimed.outcomeThreadId
        ? await this.prisma.outcomeThreadTurn.findUnique({
            where: { runId: claimed.runId },
            select: { purpose: true, thread: { select: { outcomeId: true } } },
          })
        : null;
      const goalThread = claimed.outcomeThreadId && goalTurnRow
        ? { threadId: claimed.outcomeThreadId, outcomeId: goalTurnRow.thread.outcomeId, purpose: goalTurnRow.purpose }
        : null;
      // A room turn is woken by a synthetic clientId, so its spoken origin is the message that started the round.
      const triggeringMessage = claimed.deliveryId
        ? await this.prisma.channelDelivery
            .findUnique({ where: { id: claimed.deliveryId }, select: { round: { select: { rootMessageId: true } } } })
            .then((delivery) => delivery
              ? this.prisma.channelMessage.findUnique({ where: { id: delivery.round.rootMessageId }, select: { metadata: true } })
              : null)
        : claimed.channelId
          ? await this.prisma.channelMessage.findUnique({
              where: { channelId_clientId: { channelId: claimed.channelId, clientId: claimed.clientId } },
              select: { metadata: true },
            })
          : null;
      const triggeringMetadata = triggeringMessage?.metadata && typeof triggeringMessage.metadata === "object" && !Array.isArray(triggeringMessage.metadata)
        ? triggeringMessage.metadata as Record<string, unknown>
        : null;
      const voiceTurn = Boolean(triggeringMetadata?.voice && typeof triggeringMetadata.voice === "object" && !Array.isArray(triggeringMetadata.voice));
      const streamReply = platformPrompt.directTextReply && !voiceTurn && claimed.origin === "user" &&
        triggeringMessage && !triggeringMetadata?.branched &&
        !(await this.prisma.externalMessageReceipt.findFirst({
          where: { runId: claimed.runId, status: "accepted", mappingId: { not: null } },
          select: { id: true },
        }));
      const voicePrompt = voiceTurn ? [{ id: `${claimed.clientId}:voice`, content:
        platformPrompt.directTextReply ? directTextVoicePrompt : claimed.deliveryId ? voiceTurnPrompt + voiceRoomPrompt : voiceTurnPrompt }] : [];
      // Spoken progress uses the configured narration model, or the bot's own model, with reasoning off: at the lowest
      // level some models still spend the whole token budget thinking and return no text.
      const narrationSetting = voiceTurn && !claimed.subagentType && claimed.origin === "user"
        ? (await this.prisma.voiceSettings.findUnique({ where: { id: "global" }, select: { narrationModel: true } }))?.narrationModel.trim() ?? ""
        : null;
      // Subagents run on the parent run's recorded model and reasoning, so a
      // settings change mid-run never switches models inside one task tree.
      const [inferenceParent, botInferenceRow, activeThreadTurn] = await Promise.all([
        claimed.inferenceParentRunId
          ? this.prisma.run.findUnique({ where: { id: claimed.inferenceParentRunId } })
          : null,
        this.prisma.bot.findUnique({
          where: { id: claimed.botId },
          select: { inferenceProvider: true, inferenceModel: true, inferenceReasoning: true },
        }),
        claimed.outcomeThreadId
          ? this.prisma.outcomeThreadTurn.findUnique({
              where: { runId: claimed.runId },
              select: { id: true, model: true },
            })
          : null,
      ]);
      const turnModel =
        activeThreadTurn?.model && typeof activeThreadTurn.model === "object" && !Array.isArray(activeThreadTurn.model)
          ? (activeThreadTurn.model as { providerId?: string | null; modelId?: string | null; reasoning?: string | null })
          : null;
      const resolvedInference = await resolveRunInference({
        parentRun: inferenceParent,
        turnModel,
        botModel: botInferenceRow,
        globalInference: inference,
        checkAvailability: (candidate) =>
          checkComputerModelAvailable(this.computerUrl, this.controlToken, candidate),
      });
      const selectedInference = resolvedInference.settings;
      await this.prisma.$transaction(async (tx) => {
        await lockWakeAttempt(tx, claimed);
        if (!(await ownsWakeAttempt(tx, claimed))) throw new Error("Wake attempt was superseded before dispatch");
        await tx.run.update({ where: { id: claimed.runId }, data: {
          inferenceProvider: selectedInference.providerId,
          inferenceModel: selectedInference.modelId,
          inferenceReasoning: selectedInference.reasoning,
          inferenceFallback: resolvedInference.fallback ? JSON.parse(JSON.stringify(resolvedInference.fallback)) : Prisma.DbNull,
          taskConfiguration: JSON.parse(JSON.stringify(taskConfiguration)),
        } });
        if (resolvedInference.fallback) {
          await tx.event.create({
            data: {
              topic: "run.inference_fallback",
              entityId: claimed.runId,
              payload: JSON.parse(
                JSON.stringify({
                  runId: claimed.runId,
                  botId: claimed.botId,
                  ...resolvedInference.fallback,
                })
              ),
            },
          });
          if (activeThreadTurn && resolvedInference.fallback.fromLevel === "role") {
            await tx.outcomeThreadTurn.update({
              where: { id: activeThreadTurn.id },
              data: {
                model: JSON.parse(
                  JSON.stringify({
                    providerId: selectedInference.providerId,
                    modelId: selectedInference.modelId,
                    reasoning: selectedInference.reasoning,
                    fallback: resolvedInference.fallback,
                  })
                ),
              },
            });
          }
        }
      });
      const turnRequest = {
        runId: claimed.runId,
        credentialScopeId: claimed.inferenceParentRunId ?? claimed.runId,
        botId: claimed.botId,
        contextSessionId: claimed.contextSessionId,
        screenBotId: claimed.screenBotId,
        conversationId: claimed.conversationId,
        sessionPath: claimed.sessionPath,
        content: turnContentWithNotes({
          origin: claimed.origin,
          inboxType: claimed.inboxType,
          appendReplyReminder: true,
          directTextReply: platformPrompt.directTextReply,
          runtimeProfile: claimed.runtimeProfile,
          notes: [platformPrompt.automationStatus, platformPrompt.agentProfileUpdate, platformPrompt.instructionsUpdate],
          unfinishedTasks: await this.supersededUnfinishedRun(claimed),
        }, claimed.content),
        prependMessages: [...missedMessages, ...voicePrompt, ...(platformPrompt.ambientContext ? [{
          id: `${claimed.clientId}:ambient`,
          content: `[SAND_HIDDEN_PROMPT]${platformPrompt.ambientContext}`,
        }] : [])],
        images: claimed.images,
        clientMessageId: claimed.clientId,
        cwd: claimed.cwd,
        instructions,
        userInfo: platformPrompt.userInfo,
        userInfoEpoch: platformPrompt.userInfoEpoch ?? undefined,
        connectorInstructions: pluginContext.skillInstructions,
        agentProfileSnapshot: platformPrompt.agentProfileSnapshot ?? undefined,
        todoUpdate: platformPrompt.todoUpdate,
        resetSelfSummaryCount: wakeResetsSelfSummaryCount(claimed.inboxType),
        requestSource: runtimeRequestSourceForOrigin(claimed.origin, claimed.inboxType),
        ...(claimed.outcomeWorkItemId ? { outcomeThread: { workItemId: claimed.outcomeWorkItemId } } : {}),
        ...(goalThread ? { goalThread } : {}),
        channelId: claimed.channelId,
        deliveryId: claimed.deliveryId,
        runtimeProfile: claimed.runtimeProfile,
        subagentType: claimed.subagentType ?? undefined,
        taskConfiguration,
        readOnly: claimed.readOnly,
        timeZone: await this.messaging.userTimeZone(),
        outcomesEnabled: platformPrompt.outcomesEnabled === true,
        groupTasksEnabled: platformPrompt.groupTasksEnabled === true,
        ...(claimed.origin === "group" ? { groupTurn: true } : {}),
        model: formatPiModelRef(selectedInference),
        reasoning: selectedInference.reasoning,
        ...(narrationSetting !== null
          ? { voiceNarration: { model: narrationSetting || formatPiModelRef(selectedInference), reasoning: "off" as const } }
          : {}),
        // A turn in a voice-call room: no narrator, but each sentence of the reply is spoken as it is written.
        ...(voiceTurn && claimed.deliveryId && !claimed.subagentType ? { voiceSpeech: true as const } : {}),
        ...(platformPrompt.directTextReply ? { directTextReply: true as const } : {}),
        ...(streamReply ? { replyPreviewAttempt: claimed.attempt } : {}),
        fileAttachments: claimed.fileAttachments,
        attachmentOwnerBotId: claimed.attachmentOwnerBotId,
        dynamicNamespaces: pluginContext.dynamicNamespaces,
        pluginRuntimePackages: pluginContext.pluginRuntimePackages,
      } satisfies ComputerTurnRequest;
      const streamAbort = new AbortController();
      const response = await dispatchComputerTurn(this.prisma, claimed.runId, (dispatchSignal) => fetch(`${this.computerUrl}${COMPUTER_API_PATHS.turns}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.controlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(turnRequest),
        signal: AbortSignal.any([streamAbort.signal, dispatchSignal, AbortSignal.timeout(24 * 60 * 60_000)]),
      }), 60_000, claimed);
      if (!response.ok || !response.body) {
        throw new Error(`Computer rejected turn: ${response.status} ${await response.text()}`);
      }
      await consumeComputerEvents(response.body, async (event) => {
        const projected = await this.projection.apply(claimed.runId, claimed.conversationId, claimed.botId, event, claimed);
        if (!projected) throw new Error("Wake attempt was superseded during streaming");
        if (event.type === "prompt.delivered") {
          await this.prisma.run.updateMany({ where: { botId: claimed.botId, id: { in: [claimed.runId, ...missed.map((input) => input.runId)] }, inputDeliveredAt: null }, data: { inputDeliveredAt: new Date() } });
          await this.messaging.acknowledgePlatformPrompt(claimed.botId, claimed.contextSessionId, platformPrompt);
        }
        // Only completion transitions can enqueue a push. Token
        // deltas are frequent and previously caused two empty outbox scans
        // per NDJSON event; the 2s safety timer still covers every other path.
        if (computerEventQueuesPushNotification(event)) {
          void this.pushNotifications
            .drain()
            .catch((error) => console.error("push notification delivery", error));
        }
        if (event.type === "turn.completed") completion = event;
      }, () => streamAbort.abort());
      if (!completion)
        throw new Error("Computer stream ended without an authoritative turn completion");
      const completionFailure = turnCompletionFailure(completion);
      if (completionFailure) throw completionFailure;
      await this.settleCompletedWake(claimed);
    } catch (error) {
      // Without a completion the computer never settled the turn: it was
      // unreachable or went away mid-stream. A reported failure is final.
      await this.fail(claimed, error, !completion);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async settleCompletedWake(claimed: SettlementClaim): Promise<void> {
    const needsMemoryReview = claimed.runtimeProfile === "agent" &&
      ["user", "group"].includes(claimed.origin ?? "") && claimed.inboxType !== "user.reaction";
    const settlement = await this.prisma.$transaction(async (tx) => {
      await lockWakeAttempt(tx, claimed);
      if (!(await ownsWakeAttempt(tx, claimed, true))) return null;
      const current = await tx.run.findUnique({ where: { id: claimed.runId } });
      const inbox = await tx.inboxEvent.findUnique({ where: { id: claimed.inboxId } });
      if (!inbox || inbox.status === "failed") return null;
      if (current?.status === "cancelled") return "cancelled" as const;
      if (current?.status !== "completed") return null;
      if (inbox.status === "completed") return "already-settled" as const;
      const completedAt = new Date();
      await tx.inboxEvent.update({
        where: { id: claimed.inboxId },
        data: { status: "completed", completedAt },
      });
      if (needsMemoryReview) {
        // Commit the review intent with settlement, before publication or inference.
        const bot = await tx.bot.findUniqueOrThrow({ where: { id: claimed.botId }, select: { memoryRevision: true } });
        const shared = await tx.memoryRevision.findUnique({ where: { scope: "user" }, select: { revision: true } });
        await tx.run.update({ where: { id: claimed.runId }, data: {
          memoryReviewPending: true,
          memoryReviewRevision: bot.memoryRevision + (shared?.revision ?? 0),
        } });
      }
      const settledRoutine = await reconcileRoutineExecution(tx, claimed.runId);
      if (settledRoutine) await this.routines.afterExecution(tx, settledRoutine);
      await settleOutcomeWorkItem(tx, claimed.runId, { messaging: this.messaging, workspaceRoot: this.workspaceRoot });
      if (claimed.origin === "outcome_thread") await settleOutcomeThreadTurn(tx, claimed.runId, this.messaging);
      if (claimed.origin === "bootstrap") {
        const onboarding = await tx.bot.updateMany({
          where: { id: claimed.botId, onboardingStatus: "running" },
          data: {
            onboardingStatus: "completed",
            onboardingCompletedAt: completedAt,
          },
        });
        if (onboarding.count > 0) {
          await tx.event.create({
            data: {
              topic: "bot.bootstrap.completed",
              entityId: claimed.botId,
              payload: { botId: claimed.botId, runId: claimed.runId },
            },
          });
        }
      }
      await tx.botRunLease.deleteMany({
        where: { botId: claimed.botId, ownerId: claimed.ownerId },
      });
      await tx.event.create({
        data: {
          topic: "inbox.completed",
          entityId: claimed.inboxId,
          payload: { inboxId: claimed.inboxId, runId: claimed.runId },
        },
      });
      await this.messaging.scheduleTranscriptProjection(tx, [claimed.botId]);
      await this.completeSubagent(tx, claimed);
      if (claimed.runtimeProfile !== "subagent" && !["routine", "outcome", "outcome_thread"].includes(claimed.origin ?? "")) await settleRequestProgress(tx, this.messaging, claimed.botId, claimed.runId);
      return "settled" as const;
    });
    if (!settlement) return;
    if (settlement === "cancelled") {
      await this.fail(claimed, new TurnStoppedError("Turn was stopped before completion settled"));
      return;
    }
    // A committed completion remains successful when delivery or file sync needs another pass.
    if (claimed.deliveryId) {
      await this.messaging.completeDelivery(claimed.deliveryId, "completed", undefined, claimed.runId);
    }
    if (settlement === "settled" && needsMemoryReview) await this.reviewMemoryRun(claimed.runId);
    await this.syncRoutineRunFile(claimed.botId, claimed.runId);
  }

  private async reconcileContextState(claimed: Claimed): Promise<void> {
    const response = await this.computerFetch(`/v1/context-sessions/${claimed.contextSessionId}`, {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(
        `Context-state preflight failed: ${response.status} ${await response.text()}`
      );
    }
    const event = (await response.json()) as ComputerEvent;
    if (event.type !== "context.state" || event.contextSessionId !== claimed.contextSessionId) {
      throw new Error("Computer returned an invalid context-state preflight response");
    }
    if (!(await this.projection.apply(claimed.runId, claimed.conversationId, claimed.botId, event, claimed))) {
      throw new Error("Wake attempt was superseded during context reconciliation");
    }
  }

  private async loadTaskCapabilities(): Promise<TaskCapabilities> {
    const response = await this.computerFetch("/v1/task-capabilities", { method: "GET" });
    if (!response.ok) throw new Error("Could not determine Task computer capabilities");
    const capabilities = await response.json() as TaskCapabilities;
    if (typeof capabilities.desktopAvailable !== "boolean" || typeof capabilities.boxAvailable !== "boolean") {
      throw new Error("Invalid Task computer capabilities");
    }
    return capabilities;
  }

  private async heartbeat(claimed: Claimed): Promise<void> {
    const run = await this.prisma.run.findUnique({ where: { id: claimed.runId }, select: { status: true } });
    if (run?.status === "cancelled") {
      // Retry a durable cancellation if the server's first dispatch raced setup
      // or its response was lost. Keep the lease until execute/fail settles it.
      await this.computerFetch(COMPUTER_API_PATHS.turnCancel(claimed.runId), { method: "POST" }).catch(() => undefined);
    }
    const renewed = await this.prisma.botRunLease.updateMany({
      where: { botId: claimed.botId, ownerId: claimed.ownerId, expiresAt: { gt: new Date() },
        ...(claimed.origin === "outcome" || claimed.origin === "outcome_thread" ? { runId: claimed.runId } : {}) },
      data: {
        heartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + LEASE_MS),
      },
    });
    if ((claimed.origin === "outcome" || claimed.origin === "outcome_thread") && renewed.count === 0)
      await this.computerFetch(COMPUTER_API_PATHS.turnCancel(claimed.runId), { method: "POST", body: JSON.stringify({ recovery: true }) }).catch(() => undefined);
  }

  private computerFetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.computerUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.controlToken}`,
        "content-type": "application/json",
        // Reconciliation must recover cleanly after the computer firewall or
        // container route is recreated; stale pooled sockets can otherwise
        // turn a transient disconnect into repeated timeouts.
        connection: "close",
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
  }

  /**
   * A first greeting cut off by the computer is still owed. Put the same run
   * back in line instead of failing it; the computer's input receipt resumes
   * it without repeating the prompt, and a user who speaks first still skips it.
   */
  private async requeueInterruptedBootstrap(claimed: SettlementClaim, error: unknown): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockWakeAttempt(tx, claimed);
      if (!(await ownsWakeAttempt(tx, claimed))) return false;
      // lockWakeAttempt takes the same bot row as skipBootstrapForUser, before Run.
      const bot = await tx.bot.findUnique({
        where: { id: claimed.botId },
        select: { status: true, onboardingStatus: true },
      });
      const run = await tx.run.findUnique({
        where: { id: claimed.runId },
        select: { status: true },
      });
      const inbox = await tx.inboxEvent.findUnique({
        where: { id: claimed.inboxId },
        select: { attempts: true },
      });
      const greeting = await tx.channelMessage.findFirst({
        where: { sourceRunId: claimed.runId, sender: "agent", senderBotId: claimed.botId },
        select: { id: true },
      });
      if (
        bot?.status !== "active" ||
        bot.onboardingStatus !== "running" ||
        run?.status !== "running" ||
        greeting ||
        !inbox ||
        inbox.attempts >= BOOTSTRAP_ATTEMPT_LIMIT
      ) {
        return false;
      }
      await finalizeInterruptedItems(tx, claimed.runId, false);
      await tx.botRunLease.deleteMany({
        where: { botId: claimed.botId, ownerId: claimed.ownerId },
      });
      // Not claimable until the first readiness probe, so this worker's wake
      // loop does not spend the remaining attempts while the computer is down.
      await tx.inboxEvent.update({
        where: { id: claimed.inboxId },
        data: {
          status: "pending",
          claimedAt: null,
          availableAt: new Date(Date.now() + BOOTSTRAP_RETRY_PROBE_MS),
        },
      });
      await tx.run.update({ where: { id: claimed.runId }, data: { status: "queued" } });
      await tx.bot.update({ where: { id: claimed.botId }, data: { onboardingStatus: "queued" } });
      await tx.event.create({
        data: {
          topic: "bot.bootstrap.retry_queued",
          entityId: claimed.botId,
          payload: {
            botId: claimed.botId,
            runId: claimed.runId,
            attempts: inbox.attempts,
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
      await this.messaging.scheduleTranscriptProjection(tx, [claimed.botId]);
      return true;
    });
  }

  /** Wakes a requeued greeting once the computer reports ready, however long that takes. */
  private async wakeBootstrapWhenComputerReady(
    botId: string,
    probeMs = BOOTSTRAP_RETRY_PROBE_MS
  ): Promise<void> {
    while (!this.stopping) {
      await new Promise((resolve) => setTimeout(resolve, probeMs));
      try {
        const health = await fetch(`${this.computerUrl}/health`, {
          signal: AbortSignal.timeout(probeMs),
        });
        await health.body?.cancel();
        if (!health.ok) continue;
        await this.boss.send(
          "bot-wake",
          { botId },
          { retryLimit: 5, retryDelay: 2, retryBackoff: true, expireInSeconds: 3 * 60 }
        );
        return;
      } catch {
        // The computer or the queue is still unavailable; probe again.
      }
    }
  }

  /** The run this typed message superseded had dispatched (its input reached the model) and was cut off, as the reference requires. */
  private async supersededUnfinishedRun(claimed: Claimed): Promise<boolean> {
    if (!claimed.interruptedRunId) return false;
    const run = await this.prisma.run.findFirst({
      where: { id: claimed.interruptedRunId, botId: claimed.botId },
      select: { status: true, inputDeliveredAt: true, requestStoppedAt: true, error: true },
    });
    return Boolean(run?.inputDeliveredAt && !requestIsStopped(run) && ["cancelled", "interrupted"].includes(run.status));
  }

  /** A wake cut off by a typed or priority message runs again after it, a bounded number of times. */
  private async redriveSupersededWake(tx: Prisma.TransactionClient, claimed: SettlementClaim): Promise<void> {
    const limit = WAKE_REDRIVE_LIMITS[claimed.origin];
    if (!limit) return;
    const inbox = await tx.inboxEvent.findUnique({
      where: { id: claimed.inboxId },
      select: { payload: true, priority: true },
    });
    const payload = (inbox?.payload ?? {}) as {
      content?: string; clientId?: string; channelId?: string; attachments?: unknown;
      timeZone?: string; automationContextRunId?: string; taskContextRunId?: string;
    };
    if (!inbox || !payload.content || !payload.clientId) return;
    const [original, previous] = payload.clientId.match(/^(.*?)(?::redrive:(\d+))?$/)!.slice(1);
    const attempt = Number(previous ?? 0) + 1;
    const clientId = `${original}:redrive:${attempt}`;
    if (attempt > limit) return;
    const [bot, existing] = await Promise.all([
      tx.bot.findUnique({ where: { id: claimed.botId }, select: { status: true } }),
      tx.inboxEvent.findUnique({ where: { idempotencyKey: clientId }, select: { id: true } }),
    ]);
    if (bot?.status !== "active" || existing) return;
    await this.messaging.enqueueWake(tx, {
      botId: claimed.botId,
      channelId: claimed.runChannelId ?? payload.channelId ?? claimed.channelId,
      origin: claimed.origin,
      type: claimed.inboxType,
      content: payload.content,
      attachments: assetRefs(payload.attachments),
      clientId,
      priority: inbox.priority,
      wrapUserContent: false,
      includeAttachmentPaths: false,
      ...(payload.timeZone ? { timeZone: payload.timeZone } : {}),
      ...(payload.automationContextRunId ? { automationContextRunId: payload.automationContextRunId } : {}),
      ...(payload.taskContextRunId ? { taskContextRunId: payload.taskContextRunId } : {}),
    });
  }

  private async lockRoutineRunLifecycle(tx: Prisma.TransactionClient, runId: string): Promise<void> {
    const run = await tx.run.findUnique({
      where: { id: runId },
      select: { origin: true, botId: true },
    });
    // Routine follow-ups acquire this same gate. Take it before Run/Inbox/
    // execution mutations, in the order used by retirement.
    if (run?.origin === "routine") await lockAgentLifecycle(tx, run.botId);
  }

  private async fail(claimed: SettlementClaim, error: unknown, interrupted = false): Promise<void> {
    if (
      interrupted &&
      claimed.origin === "bootstrap" &&
      (await this.requeueInterruptedBootstrap(claimed, error))
    ) {
      void this.wakeBootstrapWhenComputerReady(claimed.botId);
      return;
    }
    if (!(error instanceof TurnStoppedError) && automationRetryDelay(claimed.inboxType, claimed.attempt) !== null) {
      const delay = await this.prisma.$transaction(async (tx) => {
        await lockWakeAttempt(tx, claimed);
        if (!(await ownsWakeAttempt(tx, claimed))) return null;
        return requeueAutomationWake(tx, claimed, error);
      });
      if (delay !== null) {
        console.warn("Automation retry queued", {
          runId: claimed.runId, inboxId: claimed.inboxId, attempt: claimed.attempt,
          nextAttempt: claimed.attempt + 1, attemptLimit: AUTOMATION_ATTEMPT_LIMIT, delayMs: delay,
        });
        await this.boss.send("bot-wake", { botId: claimed.botId }, {
          startAfter: Math.ceil(delay / 1000), retryLimit: 5, retryDelay: 2,
          retryBackoff: true, expireInSeconds: 3 * 60,
        });
        return;
      }
    }
    const details = {
      code: "runtime_interrupted",
      message: error instanceof Error ? error.message : String(error),
    } satisfies Prisma.InputJsonObject;
    let priorityInterrupted = false;
    let projectedCompletion = false;
    let ignored = false;
    await this.prisma.$transaction(async (tx) => {
      await lockWakeAttempt(tx, claimed);
      if (!(await ownsWakeAttempt(tx, claimed, true))) { ignored = true; return; }
      const current = await tx.run.findUnique({ where: { id: claimed.runId } });
      if (current?.status === "completed") { projectedCompletion = true; return; }
      const inbox = await tx.inboxEvent.findUnique({ where: { id: claimed.inboxId }, select: { status: true } });
      if (inbox?.status !== "processing") { ignored = true; return; }
      const currentError =
        current?.error && !Array.isArray(current.error) && typeof current.error === "object"
          ? (current.error as Prisma.InputJsonObject)
          : null;
      // The typed message may land before the server records the cancel; its wake names this run.
      // A run cut off before dispatch is not superseded (the reference lets it go on) unless the server recorded it.
      const supersededByUser = current?.inputDeliveredAt && await tx.inboxEvent.findFirst({
        where: { botId: claimed.botId, payload: { path: ["interruptedRunId"], equals: claimed.runId } },
        select: { id: true },
      });
      const explicitlyStopped = error instanceof TurnStoppedError || (!!current && requestIsStopped(current));
      priorityInterrupted = !explicitlyStopped && (currentError?.code === "priority_peer_interrupt" ||
        (Boolean(supersededByUser) && current?.status !== "failed"));
      const cancellationDetails = current?.status === "cancelled" && currentError?.code !== "priority_peer_interrupt" ? currentError : null;
      const failureDetails = explicitlyStopped
        ? cancellationDetails ?? { code: "cancelled_by_user", message: error instanceof Error ? error.message : "The user stopped this turn" }
        : (priorityInterrupted || current?.status === "cancelled") && currentError ? currentError : details;
      const finalStatus =
        current?.status === "cancelled" || (explicitlyStopped && current?.status !== "failed")
          ? "cancelled"
          : current?.status === "failed"
            ? "failed"
            : "interrupted";
      await tx.run.update({
        where: { id: claimed.runId },
        data: { status: finalStatus, error: failureDetails, completedAt: new Date() },
      });
      await finalizeInterruptedItems(tx, claimed.runId, finalStatus === "cancelled");
      await tx.inboxEvent.update({
        where: { id: claimed.inboxId },
        data: { status: "failed", error: failureDetails, completedAt: new Date() },
      });
      const settledRoutine = await reconcileRoutineExecution(tx, claimed.runId);
      if (settledRoutine) await this.routines.afterExecution(tx, settledRoutine);
      await settleOutcomeWorkItem(tx, claimed.runId, { messaging: this.messaging, workspaceRoot: this.workspaceRoot });
      if (claimed.origin === "outcome_thread") await settleOutcomeThreadTurn(tx, claimed.runId, this.messaging);
      if (priorityInterrupted) await this.redriveSupersededWake(tx, claimed);
      if (claimed.origin === "bootstrap") {
        const onboarding = await tx.bot.updateMany({
          where: { id: claimed.botId, onboardingStatus: "running" },
          data: {
            onboardingStatus: "failed",
            onboardingCompletedAt: new Date(),
          },
        });
        if (onboarding.count > 0) {
          await tx.event.create({
            data: {
              topic: "bot.bootstrap.failed",
              entityId: claimed.botId,
              payload: {
                botId: claimed.botId,
                runId: claimed.runId,
                ...failureDetails,
              },
            },
          });
        }
      }
      await tx.botRunLease.deleteMany({
        where: { botId: claimed.botId, ownerId: claimed.ownerId },
      });
      await tx.event.create({
        data: {
          topic: "run.interrupted",
          entityId: claimed.runId,
          payload: failureDetails,
        },
      });
      if (current && !priorityInterrupted) {
        const [bot, channel] = await Promise.all([
          tx.bot.findUnique({ where: { id: current.botId } }),
          tx.channel.findFirst({
            where: {
              kind: "bot_dm",
              archivedAt: null,
              members: { some: { botId: current.botId } },
            },
          }),
        ]);
        const lastVisible = channel
          ? await tx.channelMessage.findFirst({
              where: {
                channelId: channel.id,
                sourceRunId: claimed.runId,
                sender: "agent",
                senderBotId: current.botId,
              },
              orderBy: { sequence: "desc" },
            })
          : null;
        // Spoken progress narration is not the run's answer, so it never satisfies the delivery owed.
        const lastMessage = lastVisible && isVoiceNarration(lastVisible.metadata)
          ? ((await tx.channelMessage.findMany({
              where: { channelId: channel!.id, sourceRunId: claimed.runId, sender: "agent", senderBotId: current.botId },
              orderBy: { sequence: "desc" },
            })).find((message) => !isVoiceNarration(message.metadata)) ?? null)
          : lastVisible;
        if (
          channel &&
          !lastMessage &&
          finalStatus !== "cancelled" &&
          runOwesUserDelivery(claimed.origin) &&
          claimed.inboxType !== "ack.redrive"
        ) {
          await this.messaging.enqueueWake(tx, {
            botId: current.botId,
            channelId: channel.id,
            origin: "handoff_resume",
            type: "ack.redrive",
            content: SEND_TO_USER_REPLY_NUDGE_PROMPT,
            clientId: `ack-redrive:${claimed.runId}`,
            priority: PRIORITY.agent,
            wrapUserContent: false,
          });
        }
        if (
          bot?.notificationsEnabled &&
          !bot.hiddenFromSidebar &&
          channel?.kind === "bot_dm" &&
          !channel.archivedAt &&
          lastMessage
        ) {
          await publishMessageNotification(tx, lastMessage);
        }
      }
      await this.messaging.scheduleTranscriptProjection(tx, [claimed.botId]);
      await this.failSubagent(tx, claimed, failureDetails, interrupted, finalStatus === "cancelled");
    });
    if (ignored) return;
    if (projectedCompletion) {
      await this.settleCompletedWake(claimed);
      return;
    }
    await this.syncRoutineRunFile(claimed.botId, claimed.runId);
    if (claimed.deliveryId) {
      if (claimed.origin === "group" && priorityInterrupted) {
        await this.messaging.retryInterruptedGroupDelivery(claimed.deliveryId, claimed.runId);
      } else {
        await this.messaging.completeDelivery(claimed.deliveryId, "failed", details, claimed.runId);
      }
    }
  }

  private async syncRoutineRunFile(botId: string, runId: string): Promise<void> {
    const run = await this.prisma.run.findUnique({ where: { id: runId }, include: { inboxEvents: { take: 1, select: { payload: true } } } });
    if (run?.origin === "routine") runId = automationContextRunId(runId, run.inboxEvents[0]?.payload);
    const execution = await this.prisma.routineExecution.findUnique({
      where: { runId },
      select: {
        id: true,
        routineId: true,
        kind: true,
        status: true,
        scheduledFor: true,
        enqueuedAt: true,
        startedAt: true,
        completedAt: true,
        runId: true,
        skipReason: true,
        error: true,
        routine: { select: { runLedger: true } },
      },
    });
    if (!execution) return;
    const status =
      execution.status === "completed"
        ? "ok"
        : execution.status === "queued" ||
            execution.status === "running"
          ? "running"
          : "error";
    await this.prisma.routine.update({
      where: { id: execution.routineId },
      data: {
        runLedger: appendRoutineRunLedger(execution.routine.runLedger, {
          id: execution.id,
          trigger: execution.kind === "scheduled" ? "schedule" : "manual",
          startedAt: (
            execution.startedAt ??
            execution.enqueuedAt ??
            execution.scheduledFor
          ).getTime(),
          finishedAt: execution.completedAt?.getTime() ?? null,
          status,
          ...(execution.skipReason ? { detail: execution.skipReason } : {}),
          ...(execution.error &&
          !Array.isArray(execution.error) &&
          typeof execution.error === "object" &&
          typeof (execution.error as { code?: unknown }).code === "string"
            ? { errorKind: (execution.error as { code: string }).code }
            : {}),
        }),
      },
    });
    await this.agentData.writeRoutine(botId, execution.routineId);
  }

  private async recoverMemoryReviews(): Promise<void> {
    if (this.stopping || this.memoryReviewScanActive) return;
    this.memoryReviewScanActive = true;
    try {
      // Rotate one oldest eligible exchange per bot; a leased backlog must not
      // starve other owners or launch a later exchange ahead of its local review.
      const capacity = Math.max(0, 32 - this.memoryReviews.size);
      if (!capacity) return;
      const cursor = this.memoryReviewCursor;
      const active = [...this.memoryReviews.keys()];
      const pending = await this.prisma.$queryRaw<Array<{ id: string; botId: string }>>`
        SELECT candidate."id", candidate."botId" FROM (
          SELECT DISTINCT ON (r."botId") r."id", r."botId"
          FROM "outcomego_run" r
          WHERE r."memoryReviewPending" = true AND r."status" = 'completed'
            AND EXISTS (SELECT 1 FROM "outcomego_inbox_event" i WHERE i."runId" = r."id" AND i."status" = 'completed')
          ORDER BY r."botId", r."completedAt" ASC NULLS LAST, r."id"
        ) candidate
        WHERE NOT (candidate."id" = ANY(${active}::uuid[]))
        ORDER BY CASE WHEN ${cursor}::uuid IS NULL OR candidate."botId" > ${cursor}::uuid THEN 0 ELSE 1 END,
          candidate."botId"
        LIMIT ${capacity}`;
      if (this.stopping) return;
      for (const run of pending) {
        if (this.memoryReviews.size >= 32) break;
        this.memoryReviewCursor = run.botId;
        void this.reviewMemoryRun(run.id);
      }
    } finally {
      this.memoryReviewScanActive = false;
    }
  }

  private reviewMemoryRun(runId: string): Promise<void> {
    const active = this.memoryReviews.get(runId);
    if (active) return active;
    const review = this.recordMemoryFromRun(runId)
      .catch((error) => console.error(`memory review for run ${runId}`, error))
      .finally(() => this.memoryReviews.delete(runId));
    this.memoryReviews.set(runId, review);
    return review;
  }

  private async recordMemoryFromRun(runId: string): Promise<void> {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      select: {
        id: true, botId: true, channelId: true, deliveryId: true, origin: true,
        status: true, memoryReviewPending: true,
        bot: { select: { subagentIdentity: { select: { id: true } } } },
        inboxEvents: { where: { status: "completed" }, orderBy: { createdAt: "asc" }, take: 1, select: { payload: true, type: true } },
      },
    });
    if (!run?.memoryReviewPending || run.status !== "completed" || !run.inboxEvents.length) return;
    if (run.bot.subagentIdentity || !["user", "group"].includes(run.origin) || run.inboxEvents[0]?.type === "user.reaction") {
      await this.prisma.run.updateMany({ where: { id: runId }, data: { memoryReviewPending: false } });
      return;
    }
    let groupUser: { content: string; createdAt: Date } | null = null;
    if (run.deliveryId) {
      // Settlement can commit before the buffered group reply is published.
      await this.messaging.completeDelivery(run.deliveryId, "completed", undefined, run.id);
      const delivery = await this.prisma.channelDelivery.findUnique({
        where: { id: run.deliveryId },
        select: { status: true, round: { select: { triggerMessage: { select: { sender: true, content: true, createdAt: true } } } } },
      });
      if (!delivery || delivery.status !== "completed") {
        await this.prisma.run.updateMany({ where: { id: runId }, data: { memoryReviewPending: false } });
        return;
      }
      if (delivery.round.triggerMessage.sender === "user") groupUser = delivery.round.triggerMessage;
    }
    const inbox = run.inboxEvents[0];
    const [messages, visibleAssistant] = await Promise.all([
      this.prisma.message.findMany({
        where: { runId: run.id, status: "completed" },
        select: { role: true, content: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.channelMessage.findMany({
        where: {
          sourceRunId: run.id,
          sender: "agent",
          senderBotId: run.botId,
        },
        select: { content: true, metadata: true },
        orderBy: { sequence: "asc" },
      }),
    ]).then(([messages, visible]) => [messages, visible.filter((message) => !isVoiceNarration(message.metadata))] as const);
    const payload =
      inbox?.payload && typeof inbox.payload === "object" && !Array.isArray(inbox.payload)
        ? (inbox.payload as Record<string, unknown>)
        : null;
    const channelId = run.channelId ?? (typeof payload?.channelId === "string" ? payload.channelId : null);
    const visibleUser = groupUser ?? (
      channelId && typeof payload?.clientId === "string"
        ? await this.prisma.channelMessage.findUnique({
            where: {
              channelId_clientId: {
                channelId,
                clientId: payload.clientId,
              },
            },
            select: { content: true, createdAt: true },
          })
        : null);
    const internalUser = messages.find((message) => message.role === "user");
    const internalAssistant = messages.filter((message) => message.role === "assistant");
    const exchange = resolveTurnMemoryExchange({
      visibleUser,
      internalUser,
      visibleAssistant,
      internalAssistant,
    });
    const reviewed = !exchange || await this.agentData.recordTurnMemory(run.botId, {
      runId: run.id,
      requirePendingRun: true,
      timeZone: await this.messaging.userTimeZone(),
      user: exchange.user,
      assistant: exchange.assistant,
      occurredAt: exchange.occurredAt,
    });
    if (reviewed) await this.prisma.run.updateMany({ where: { id: runId }, data: { memoryReviewPending: false } });
  }

  private async completeSubagent(tx: Prisma.TransactionClient, claimed: SettlementClaim): Promise<void> {
    const subagent = await tx.subagent.findFirst({
      where: { childBotId: claimed.botId, currentRunId: claimed.runId },
    });
    const attempt = await tx.subagentAttempt.findUnique({
      where: { childRunId: claimed.runId },
    });
    if (
      !subagent ||
      !attempt ||
      ["completed", "failed", "stopped", "waiting"].includes(subagent.status) ||
      ["completed", "failed", "stopped", "waiting"].includes(attempt.status)
    ) {
      return;
    }
    const finalMessage = await tx.message.findFirst({
      where: { runId: claimed.runId, role: "assistant", status: "completed" },
      orderBy: { updatedAt: "desc" },
    });
    // The parent gets the worker's own report, as in the reference.
    const result = finalMessage?.content.trim() ?? "";
    if (await settleTaskProgress(tx, this.messaging, subagent, attempt.id, claimed.runId, result)) {
      if (taskProgress(subagent.progress)?.tracking === "initial") {
        const current = await tx.subagent.findUnique({ where: { id: subagent.id } });
        if (current?.status === "waiting" && current.currentRunId === claimed.runId && current.result === result) {
          // Preserve the reference's partial/blocked revival and redispatch cap
          // while keeping the unfinished logical task visible and owned.
          await this.notifySubagentParent(tx, {
            ...subagent, parentRunId: attempt.parentRunId, parentChannelId: attempt.parentChannelId,
            description: attempt.description, prompt: attempt.prompt, currentRunId: attempt.childRunId,
          }, "completed", result, true);
        }
      }
      return;
    }
    // A parent's message can move the worker to a new turn after the read above; that turn reports instead.
    const completed = await tx.subagent.updateMany({
      where: { id: subagent.id, currentRunId: claimed.runId, status: { notIn: ["completed", "failed", "stopped"] } },
      data: {
        status: "completed",
        ...(taskProgress(subagent.progress)?.tracking === "initial" ? { progress: { ...JSON.parse(JSON.stringify(subagent.progress)), state: "complete", remaining: [], evidence: [`run:${claimed.runId}:final-report`], summary: "Worker returned its final report; see the report for its verified and pending outcomes." } } : {}),
        result,
        error: Prisma.DbNull,
        completedAt: new Date(),
      },
    });
    if (completed.count === 0) return;
    await tx.subagentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "completed",
        result,
        error: Prisma.DbNull,
        completedAt: new Date(),
      },
    });
    await tx.event.create({
      data: {
        topic: "subagent.completed",
        entityId: subagent.id,
        payload: {
          subagentId: subagent.id,
          parentBotId: subagent.parentBotId,
          childBotId: subagent.childBotId,
          runId: claimed.runId,
          attemptId: attempt.id,
          parentToolCallId: attempt.parentToolCallId,
        },
      },
    });
    await this.notifySubagentParent(
      tx,
      {
        ...subagent,
        parentRunId: attempt.parentRunId,
        parentChannelId: attempt.parentChannelId,
        description: attempt.description,
        prompt: attempt.prompt,
        currentRunId: attempt.childRunId,
      },
      "completed",
      result
    );
  }

  private async failSubagent(
    tx: Prisma.TransactionClient,
    claimed: SettlementClaim,
    details: Prisma.InputJsonObject,
    interrupted: boolean,
    stopped = false
  ): Promise<void> {
    const subagent = await tx.subagent.findFirst({
      where: { childBotId: claimed.botId, currentRunId: claimed.runId },
    });
    const attempt = await tx.subagentAttempt.findUnique({
      where: { childRunId: claimed.runId },
    });
    if (
      !subagent ||
      !attempt ||
      ["completed", "failed", "stopped", "waiting"].includes(subagent.status) ||
      ["completed", "failed", "stopped", "waiting"].includes(attempt.status)
    ) {
      return;
    }
    if (stopped) {
      // A stopped worker is torn down and never reports back, as in the reference.
      const stoppedAt = new Date();
      const updated = await tx.subagent.updateMany({
        where: { id: subagent.id, currentRunId: claimed.runId, status: { notIn: ["completed", "failed", "stopped"] } },
        data: { status: "stopped", stoppedAt, completedAt: stoppedAt },
      });
      if (updated.count === 0) return;
      await tx.subagentAttempt.update({ where: { id: attempt.id }, data: { status: "stopped", stoppedAt, completedAt: stoppedAt } });
      await tx.event.create({
        data: {
          topic: "subagent.stopped",
          entityId: subagent.id,
          payload: { parentBotId: subagent.parentBotId, subagentId: subagent.id, runId: claimed.runId },
        },
      });
      return;
    }
    if (interrupted && taskProgress(subagent.progress)?.remaining.length && await recoverTaskInterruption(tx, this.messaging, subagent.id, claimed.runId, attempt.id, details)) return;
    // A run the computer never settled reads as interrupted; a reported failure gives its error.
    const result = interrupted ? SUBAGENT_INTERRUPTED_RESULT : String(details.message ?? "");
    const failed = await tx.subagent.updateMany({
      where: { id: subagent.id, currentRunId: claimed.runId, status: { notIn: ["completed", "failed", "stopped"] } },
      data: { status: "failed", error: details, result, completedAt: new Date() },
    });
    if (failed.count === 0) return;
    await tx.subagentAttempt.update({
      where: { id: attempt.id },
      data: { status: "failed", error: details, result, completedAt: new Date() },
    });
    await tx.event.create({
      data: {
        topic: "subagent.failed",
        entityId: subagent.id,
        payload: {
          subagentId: subagent.id,
          parentBotId: subagent.parentBotId,
          childBotId: subagent.childBotId,
          runId: claimed.runId,
          attemptId: attempt.id,
          parentToolCallId: attempt.parentToolCallId,
          ...details,
        },
      },
    });
    await this.notifySubagentParent(
      tx,
      {
        ...subagent,
        parentRunId: attempt.parentRunId,
        parentChannelId: attempt.parentChannelId,
        description: attempt.description,
        prompt: attempt.prompt,
        currentRunId: attempt.childRunId,
      },
      "failed",
      result
    );
  }

  private async notifySubagentParent(
    tx: Prisma.TransactionClient,
    subagent: {
      id: string;
      parentBotId: string;
      parentRunId: string;
      parentChannelId: string;
      description: string;
      prompt: string;
      requestRunId?: string | null;
      subagentType: string;
      currentRunId: string | null;
      outputPath: string;
    },
    status: "completed" | "failed",
    result: string,
    pendingTask = false
  ): Promise<void> {
    const parent = await tx.bot.findUnique({
      where: { id: subagent.parentBotId },
    });
    if (!parent || !["active", "provisioning"].includes(parent.status)) return;
    // Delegated work belongs to the automation that launched it. Resume that
    // context unless it already handed responsibility to the main agent.
    const route = await automationContinuationRoute(tx, subagent.parentBotId, subagent.parentRunId);
    if (!route) return;
    const source = await tx.run.findUnique({ where: { id: subagent.parentRunId }, include: { inboxEvents: { take: 1, select: { payload: true } } } });
    const sourcePayload = source?.inboxEvents[0]?.payload as { taskContextRunId?: string } | undefined;
    const room = await tx.channel.findUnique({ where: { id: subagent.parentChannelId }, select: { kind: true, name: true } });
    const note = room?.kind === "group" ? groupRoomRevivalNote(room.name) : undefined;
    // A task a routine started reports back to that routine, which nobody is waiting on.
    const routine = route.origin === "routine" && route.automationContextRunId
      ? await automationContextRoutine(tx, route.automationContextRunId)
      : undefined;
    const revival = { title: subagentTitle(subagent.prompt), subagentType: subagent.subagentType, status, result };
    await this.messaging.enqueueWake(tx, {
      botId: subagent.parentBotId,
      channelId: subagent.parentChannelId,
      ...route,
      ...(route.origin === "outcome" ? {} : { taskContextRunId: subagent.requestRunId ?? sourcePayload?.taskContextRunId ?? subagent.parentRunId }),
      type: `subagent.${status}`,
      content: (routine
        ? renderQuietSubagentRevivalPrompt({ ...revival, routine })
        : renderSubagentRevivalPrompt(revival)) + (note ? `\n\n${note}` : "") +
        (pendingTask ? "\nThe worker turn ended, but its unfinished goal remains parked for your decision with no automatic check. Keep it owned. If you resolve the blocker by replacing it with a new task, stop the obsolete parked task rather than leaving a duplicate pending goal." : ""),
      revival: {
        block: routine ? `${subagentRevivalBlock(revival)}\n${quietRoutineOriginNote(routine)}` : subagentRevivalBlock(revival),
        subagentType: subagent.subagentType,
        ...(note ? { note } : {}),
      },
      clientId: `subagent:${subagent.id}:${status}:${subagent.currentRunId}`,
      priority: 260,
    });
  }
}
