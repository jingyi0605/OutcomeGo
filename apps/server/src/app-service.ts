import { OutcomeService } from "./services/outcome-service";
import { ReplyPreviews } from "./services/reply-previews";
import { lockAssetReferences, referencedAssetIdsSql } from "./services/asset-retention";
import { withdrawSupersededDecisions } from "./services/decision-lifecycle";
import { OutcomeClassificationService } from "./services/outcome-classification";
import { OutcomeThreadService } from "./services/outcome-thread-service";
import { OutcomePlanService } from "./services/outcome-plan-service";
import { ActivityService } from "./services/activity-service";
import { ScheduleService } from "./services/schedule-service";
import { CalendarFeedService } from "./services/calendar-feed-service";
import { ExternalCalendarService } from "./services/external-calendar-service";
import { OutcomeScheduleService } from "./services/outcome-schedule-service";
import { OutcomeTaskReviewService } from "./services/outcome-task-review-service";
import { OutcomeThreadTools } from "./services/outcome-thread-tools";
import { OutcomeRecoveryService } from "./services/outcome-recovery-service";
import { DecisionService } from "./services/decision-service";
import { createOutcomeDecisionTool } from "./services/outcome-decision-tool";
import { createOutcomeProgressTool } from "./services/outcome-progress-tool";
import { createDeferWorkItemTool } from "./services/outcome-defer-tool";
import { createOutcomeCredentialApprovalTool } from "./services/outcome-credential-approval";
import { OutcomeChatTools } from "./services/outcome-chat-tools";
import { GroupTaskTools } from "./services/group-task-tools";
import { OutcomeChatCards } from "./services/outcome-chat-cards";
import { OutcomeInboxService } from "./services/outcome-inbox-service";
import { createHumanWorkServices } from "./services/human-work-factory";
import type { HumanKnowledgeService } from "./services/human-knowledge-service";
import type { HumanWorkService } from "./services/human-work-service";
import type { HumanReceiptService } from "./services/human-receipt-service";
import { OutcomeReviewService } from "./services/outcome-review-service";
import { OutcomeEvidenceConsumer } from "./services/outcome-evidence-consumer";
import { OutcomeResultSummaryWorker } from "./services/outcome-result-summary-worker";
import { outcomeInference } from "./services/outcome-inference";
import { ApnsSettingsStore } from "@outcomego/db/apns-settings";
import { UserLocationService } from "./services/user-location";
import { MachineService } from "./services/machine-service";
import {
  AutomationWebhooksService,
  containsWebhookTrigger,
} from "./services/automation-webhooks";
import {
  ApiError,
  type UpdateFeatureSettingsInput,
  type UpdateUserTimeZoneInput,
  type UploadAssetInput,
} from "@outcomego/contracts";
import type { GroupTaskUserAction } from "@outcomego/contracts/group-tasks";
import { createPrismaClient, Prisma, type PrismaClient } from "@outcomego/db";
import {
  AgentDataStore,
  AgentMessaging,
  appendAgentTimelineEvent,
  AssetStore,
  enqueueOutcomePrereviewIfNeeded,
  GroupTaskService,
  readFeatureSettings,
  type RoutineMutationInput,
  RoutineService,
  updateFeatureSettings,
  userTimeZoneView,
} from "@outcomego/messaging";
import { Effect } from "effect";
import { join, resolve } from "node:path";
import { TranscriptionService } from "./transcription/service";
import { TranscriptionStore } from "./transcription/store";
import { PgBoss } from "pg-boss";
import { EventWakeup } from "./event-wakeup";
import { AdministrationService } from "./services/administration-service";
import { BotService } from "./services/bot-service";
import { ChannelService } from "./services/channel-service";
import { InternalToolService } from "./services/internal-tool-service";
import { NotificationService } from "./services/notification-service";
import { PluginService } from "./services/plugin-service";
import { PluginEventPoller } from "./services/plugin/events";
import {
  ExternalDeliveryService,
  ExternalInboundMessageService,
  ExternalInboundPoller,
  ExternalMediaExchange,
  ExternalMessagingBindingService,
  ExternalReminderService,
} from "./services/external-messaging";
import { provisionDirectories } from "./services/provision-directories";
import { RichMessageService } from "./services/rich-message-service";
import { RunService } from "./services/run-service";
import { ScreenService } from "./services/screen-service";
import { SearchService } from "./services/search-service";
import { ChannelLibraryService } from "./services/channel-library";
import { forwardServiceMethod, serviceEffect } from "./services/service-utils";
import { verifyInferenceModelSelection } from "./services/inference-validation";
import { isBotRunnable } from "./services/outcome-role-service";
import { WebProviderSettingsService } from "./services/web-provider-settings";
import { SettingsService } from "./services/settings-service";
import { SnapshotService } from "./services/snapshot-service";
import { recover } from "./services/startup-recovery";
import { SubagentService } from "./services/subagent/service";
import { TodoService } from "./services/todo-service";
import { DurableStateService } from "./update-state";
import { VoiceService } from "./services/voice-service";
import { ComputerNetworkPolicyService } from "./services/computer-network-policy-service";
import { DingTalkService } from "./services/dingtalk";
import { OutcomeBriefService, prismaOutcomeBriefStore } from "./services/outcome-brief-service";

const COMPUTER_ID = "00000000-0000-0000-0000-000000000001";

const ASSET_ID = /^[a-f0-9]{64}$/;

export class AppService {
  readonly transcription: TranscriptionService;
  readonly apnsSettings: ApnsSettingsStore;
  readonly webProviders: WebProviderSettingsService;
  readonly automationWebhooks: AutomationWebhooksService;
  private readonly settings: SettingsService;

  readonly prisma: PrismaClient;
  readonly boss: PgBoss;
  readonly computerUrl: string;
  readonly controlToken: string;
  readonly workspaceRoot: string;
  readonly screenViewerHost: string;
  readonly agentData: AgentDataStore;
  readonly messaging: AgentMessaging;
  readonly outcomes: OutcomeService;
  readonly outcomeThreads: OutcomeThreadService;
  readonly outcomePlans: OutcomePlanService;
  readonly outcomeSchedule: OutcomeScheduleService;
  readonly activity: ActivityService;
  readonly schedule: ScheduleService;
  readonly calendarFeeds: CalendarFeedService;
  readonly externalCalendar: ExternalCalendarService;
  readonly outcomeTaskReviews: OutcomeTaskReviewService;
  readonly outcomeBriefs: OutcomeBriefService;
  readonly outcomeRecovery: OutcomeRecoveryService;
  readonly outcomeDecisions: DecisionService;
  readonly knowledge: HumanKnowledgeService;
  readonly humanWork: HumanWorkService;
  readonly humanReceipts: HumanReceiptService;
  readonly outcomeReviews: OutcomeReviewService;
  private readonly outcomeEvidence: OutcomeEvidenceConsumer;
  private readonly outcomeResultSummaries: OutcomeResultSummaryWorker;
  readonly routines: RoutineService;
  readonly durableState: DurableStateService;
  readonly bots: BotService;
  readonly channels: ChannelService;
  readonly userLocations: UserLocationService;
  readonly administration: AdministrationService;
  readonly subagents: SubagentService;
  readonly todos: TodoService;
  readonly internalTools: InternalToolService;
  readonly plugins: PluginService;
  readonly dingtalk: DingTalkService;
  readonly machines: MachineService;
  readonly richMessages: RichMessageService;
  readonly runs: RunService;
  readonly voice: VoiceService;
  readonly computerNetworkPolicy: ComputerNetworkPolicyService;
  readonly screens: ScreenService;
  readonly searchIndex: SearchService;
  readonly library: ChannelLibraryService;
  readonly groupTasks: GroupTaskService;
  readonly snapshots: SnapshotService;
  readonly assets: AssetStore;
  readonly notifications: NotificationService;
  readonly eventWakeup: EventWakeup;
  private queueReady = false;
  private deliveryRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  private eventPruneTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pluginEvents: PluginEventPoller;
  private readonly externalBindings: ExternalMessagingBindingService;
  private readonly externalPoller: ExternalInboundPoller;
  private readonly externalDelivery: ExternalDeliveryService;
  private readonly externalReminders: ExternalReminderService;
  private assetCleanupTimer: ReturnType<typeof setInterval> | null = null;
  readonly replyPreviews: ReplyPreviews;

  constructor(
    authMode: import("./services/notification-service").PushAuthenticationMode = "required"
  ) {
    const databaseUrl = process.env.DATABASE_URL;
    this.prisma = createPrismaClient(databaseUrl);
    this.replyPreviews = new ReplyPreviews(this.prisma);
    this.userLocations = new UserLocationService(this.prisma, authMode);
    this.apnsSettings = new ApnsSettingsStore(this.prisma);
    this.webProviders = new WebProviderSettingsService(this.prisma, async (request) => {
      // Checks run in the computer so they exercise the same code as the agent's tools.
      const response = await this.computerFetch("/v1/web-providers/check", {
        method: "POST",
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(75_000),
      });
      if (!response.ok) throw new Error(`Computer check failed with HTTP ${response.status}`);
      return (await response.json()) as { ok: boolean; message: string };
    });
    this.machines = new MachineService(
      this.prisma,
      process.env.OUTCOMEGO_CONTROL_TOKEN ?? "local-compose-only-change-me",
      undefined,
      undefined,
      authMode === "disabled"
    );
    this.boss = new PgBoss(databaseUrl ?? "");
    this.eventWakeup = new EventWakeup(databaseUrl ?? "");
    this.computerUrl = process.env.OUTCOMEGO_COMPUTER_URL ?? "http://127.0.0.1:8790";
    this.controlToken = process.env.OUTCOMEGO_CONTROL_TOKEN ?? "local-compose-only-change-me";
    this.workspaceRoot = resolve(process.env.OUTCOMEGO_WORKSPACE_ROOT ?? "/workspace");
    this.screenViewerHost = process.env.OUTCOMEGO_SCREEN_VIEWER_HOST ?? "127.0.0.1";
    this.computerNetworkPolicy = new ComputerNetworkPolicyService(
      this.prisma,
      () => this.computerNetworkPolicyRuntime()
    );
    this.agentData = new AgentDataStore(this.prisma, {
      workspaceRoot: this.workspaceRoot,
    });
    this.transcription = new TranscriptionService(
      new TranscriptionStore(join(this.agentData.root, "transcription.json"))
    );
    this.screens = new ScreenService(
      this.prisma,
      this.agentData.root,
      this.screenViewerHost,
      (path, init) => this.computerFetch(path, init),
      this.computerUrl
    );
    this.searchIndex = new SearchService(this.prisma);
    this.library = new ChannelLibraryService(this.prisma);
    this.groupTasks = new GroupTaskService(this.prisma);
    this.assets = new AssetStore({
      root: this.agentData.assetRoot,
      agentDataRoot: this.agentData.root,
      allowedFileRoots: [this.workspaceRoot, this.agentData.root],
    });
    this.notifications = new NotificationService(this.prisma, authMode);
    this.messaging = new AgentMessaging(this.prisma, this.boss, this.agentData, this.assets);
    this.agentData.setTimelineEventSink((tx, input) =>
      appendAgentTimelineEvent(tx, this.messaging, input)
    );
    this.bots = new BotService(
      this.prisma,
      this.boss,
      this.workspaceRoot,
      (path, init) => this.computerFetch(path, init),
      this.agentData,
      this.messaging
    );
    this.snapshots = new SnapshotService(
      this.prisma,
      this.workspaceRoot,
      this.computerUrl,
      async () => {
        if (!this.queueReady) return false;
        const result = await this.boss
          .getDb()
          .executeSql(
            "SELECT count(*)::int AS count FROM pgboss.queue WHERE name IN ('bot-wake','bot-provision','transcript-project','outbox-delivery','maintenance')"
          );
        return result.rows[0]?.count === 5;
      },
      2_500,
      () => this.agentData.loadInferenceSettings({ allowUnconfigured: true }),
      () => this.transcription.store.status(),
      authMode
    );
    this.runs = new RunService(
      this.prisma,
      (path, init) => this.computerFetch(path, init)
    );
    const inferOutcome = outcomeInference(this.agentData, (path, init) => this.computerJson(path, init));
    this.outcomeBriefs = new OutcomeBriefService(inferOutcome, prismaOutcomeBriefStore(this.prisma));
    this.outcomeThreads = new OutcomeThreadService(this.prisma, this.messaging);
    this.outcomes = new OutcomeService(this.prisma, this.messaging, this.runs, withdrawSupersededDecisions,
      (outcome) => this.outcomeBriefs.warm(outcome),
      { enqueuePlan: (id, input, actor, context) => this.outcomeThreads.plan(id, input, actor, context) }
    );
    this.channels = new ChannelService(
      this.prisma,
      this.messaging,
      this.workspaceRoot,
      (path, init) => this.computerFetch(path, init),
      this.agentData,
      this.assets,
      this.userLocations,
      async (tx, input, actor) => {
        const outcome = await this.outcomes.createInTransaction(tx, input.outcome, actor);
        const turn = await this.outcomeThreads.planInTransaction(tx, outcome.id, {
          mode: "contract_plan", prompt: input.prompt, expectedRevision: outcome.revision, clientRequestId: input.outcome.clientRequestId,
        }, actor);
        return { outcome, turn };
      }
    );
    this.plugins = new PluginService(
      this.prisma,
      (path, init) => this.computerFetch(path, init ?? {}),
      this.agentData,
      this.agentData
    );
    this.externalCalendar = new ExternalCalendarService(
      this.prisma,
      (connection, toolName, args) => this.plugins.callHostTool(connection, toolName, args),
    );
    this.dingtalk = new DingTalkService(this.prisma, (path, init) => this.computerFetch(path, init));
    this.richMessages = new RichMessageService(
      this.prisma,
      this.messaging,
      this.plugins,
      this.screens,
      this.bots,
      this.machines
    );
    this.outcomePlans = new OutcomePlanService(this.prisma, this.outcomes, this.messaging);
    this.outcomeSchedule = new OutcomeScheduleService(this.prisma, this.outcomes, this.messaging);
    this.activity = new ActivityService(this.prisma);
    this.schedule = new ScheduleService(this.prisma);
    this.calendarFeeds = new CalendarFeedService(this.prisma, this.schedule);
    this.outcomeTaskReviews = new OutcomeTaskReviewService(this.prisma, this.outcomes, this.messaging);
    this.outcomeRecovery = new OutcomeRecoveryService(this.prisma, this.messaging);
    const humanServices = createHumanWorkServices(this.prisma, this.messaging, this.agentData, this.assets);
    this.knowledge = humanServices.knowledge;
    this.humanWork = humanServices.humanWork;
    this.humanReceipts = humanServices.humanReceipts;
    this.outcomeDecisions = new DecisionService(this.prisma, {
      messaging: this.messaging,
      createRevision: this.outcomes.createRevisionInTransaction,
      humanActions: this.humanWork,
      onRevisionCreated: (outcomeId) => {
        void Effect.runPromise(this.outcomes.get(outcomeId)).then(
          (outcome) => this.outcomeBriefs.warm(outcome),
          () => undefined
        );
      },
    });
    this.outcomeReviews = new OutcomeReviewService(this.prisma, this.messaging, inferOutcome, undefined, this.humanReceipts);
    this.outcomeEvidence = new OutcomeEvidenceConsumer(this.prisma, this.outcomeReviews, this.eventWakeup);
    this.outcomeResultSummaries = new OutcomeResultSummaryWorker(this.prisma, this.outcomes,
      (outcomeId, revision) => this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcome:${outcomeId}`}))`;
        return enqueueOutcomePrereviewIfNeeded(tx, this.messaging, outcomeId, revision.id, revision.revision);
      }),
    );
    this.voice = new VoiceService(this.prisma, this.channels, this.runs);
    this.todos = new TodoService(this.prisma);
    this.administration = new AdministrationService(
      this.prisma,
      this.bots,
      this.messaging,
      this.workspaceRoot,
      (path, init) => this.computerFetch(path, init),
      this.agentData
    );
    this.subagents = new SubagentService(
      this.prisma,
      this.messaging,
      this.runs,
      this.workspaceRoot,
      (path, init) => this.computerFetch(path, init),
      this.agentData
    );
    this.routines = new RoutineService(this.prisma, this.messaging, this.agentData);
    this.messaging.onGroupRoutineSettled = (settled) => this.routines.afterGroupExecution(settled);
    this.messaging.onGroupDeliverySettled = (settled) => this.voice.onGroupDeliverySettled(settled);
    this.automationWebhooks = new AutomationWebhooksService(
      this.prisma,
      (owner, event, routineId) =>
        routineId
          ? this.routines.dispatchEventToRoutine(owner, routineId, event)
          : this.routines.dispatchEvent(owner, event)
    );
    this.pluginEvents = new PluginEventPoller(
      this.prisma,
      (connection, toolName, args) => this.plugins.callHostTool(connection, toolName, args),
      (event) => this.routines.dispatchEventToAll(event)
    );
    // External chat services (specs/009). Providers only supply a connector; none of this knows a platform.
    const externalExchange = new ExternalMediaExchange((path, init) => this.computerFetch(path, init ?? {}));
    const instanceId = `server-${process.pid}`;
    this.externalBindings = new ExternalMessagingBindingService(this.prisma);
    this.externalDelivery = new ExternalDeliveryService({
      prisma: this.prisma,
      messaging: this.messaging,
      assets: this.assets,
      exchange: externalExchange,
      callHostTool: (connection, toolName, args) => this.plugins.callHostTool(connection, toolName, args),
      instanceId,
    });
    this.externalReminders = new ExternalReminderService({
      prisma: this.prisma,
      delivery: this.externalDelivery,
      timeZone: () => this.messaging.userTimeZone(),
    });
    this.externalPoller = new ExternalInboundPoller({
      prisma: this.prisma,
      callHostTool: (connection, toolName, args) => this.plugins.callHostTool(connection, toolName, args),
      inbound: new ExternalInboundMessageService({
        prisma: this.prisma,
        messaging: this.messaging,
        assets: this.assets,
        exchange: externalExchange,
        computerFetch: (path, init) => this.computerFetch(path, init),
        interruptRun: (runId) => this.channels.interruptRun(runId, true, true),
      }),
      instanceId,
    });
    this.plugins.beforeConnectionsRemoved = (tx, ids) =>
      ids.reduce<Promise<void>>((done, id) => done.then(() => this.externalDelivery.prepareConnectionRemoval(tx, id)), Promise.resolve());
    this.durableState = new DurableStateService(
      this.prisma,
      this.routines,
      this.agentData,
      this.messaging,
      this.automationWebhooks
    );
    const outcomeChatTools = new OutcomeChatTools(
      this.outcomes,
      new OutcomeChatCards(this.prisma, this.messaging),
      this.outcomeThreads,
      authMode,
    );
    this.internalTools = new InternalToolService(
      this.prisma,
      this.messaging,
      this.durableState,
      (runId) => this.channels.interruptRun(runId),
      this.todos,
      this.subagents,
      this.administration,
      this.plugins,
      this.richMessages,
      (runId, messageId) => this.voice.onVisibleMessage(runId, messageId),
      (runId, callId, text) => this.voice.speakChunk(runId, callId, text),
      this.computerNetworkPolicy,
      this.externalDelivery,
      {
        RequestOutcomeDecision: createOutcomeDecisionTool(this.prisma, this.outcomeDecisions),
        RequestHumanAction: humanServices.humanActionTool,
        ReportOutcomeProgress: createOutcomeProgressTool(this.prisma),
        DeferWorkItem: createDeferWorkItemTool(this.prisma, this.messaging),
        RequestBitwardenReadApproval: createOutcomeCredentialApprovalTool(this.prisma, this.outcomeDecisions),
      },
      outcomeChatTools,
      this.userLocations,
      new OutcomeThreadTools(
        this.prisma,
        this.outcomes,
        this.outcomePlans,
        this.outcomeTaskReviews,
        this.outcomeReviews,
        new OutcomeClassificationService(this.prisma, this.outcomes, (id, input, actor) => this.outcomeThreads.plan(id, input, actor))
      ),
      new GroupTaskTools(this.groupTasks),
      this.replyPreviews
    );
    this.boss.on("error", (error) => console.error("pg-boss", error));

    this.settings = new SettingsService(this.agentData, (path, init) =>
      this.computerJson(path, init)
    );
  }

  boot = () =>
    serviceEffect(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.voice.settings.load();
      await this.automationWebhooks.loadPublicUrl();
      await this.eventWakeup.start();
      await this.voice.startGroupDeliveryWatcher(this.eventWakeup);
      this.outcomeEvidence.start();
      this.outcomeResultSummaries.start();
      await this.snapshots.pruneEvents();
      this.eventPruneTimer = setInterval(() => {
        void this.automationWebhooks
          .renew()
          .catch(() => console.warn("Automation subscription renewal failed"));
        void this.snapshots.pruneEvents().catch((error) => console.error("event retention", error));
      }, 5 * 60_000);
      this.eventPruneTimer.unref?.();
      // Chokidar opens one fs.watch per file, which takes 10+ seconds on a network share, so
      // startup does not wait for it. The watcher compares against a snapshot taken before it
      // opens, so changes made while it is still starting are picked up by its first scan.
      void this.agentData.startWatching().catch((error) => console.error("agent-data watcher", error));
      await this.agentData.migratePrivateSkills().then(
        ({ migrated, failed }) => {
          if (migrated) console.info(`Moved ${migrated} private skill(s) into the shared skill library`);
          for (const message of failed) console.error("private skill migration", message);
        },
        (error) => console.error("private skill migration", error)
      );
      await this.plugins.syncFileCaches();
      // Plugins shipped with this release update with it. Their connections reconnect after the computer
      // is provisioned below, so a failed reconnect never blocks startup.
      const reconnect = await this.plugins.updateReleasedPlugins().catch((error) => {
        console.error("plugin updates", error);
        return [] as string[];
      });
      await this.boss.start();
      await this.boss.createQueue("bot-wake");
      await this.boss.createQueue("bot-provision");
      await this.boss.createQueue("transcript-project");
      await this.boss.createQueue("outbox-delivery");
      await this.boss.createQueue("maintenance");
      this.queueReady = true;
      await this.recover();
      await this.richMessages.recoverPendingDeliveries();
      this.deliveryRecoveryTimer = setInterval(() => {
        void this.richMessages
          .recoverPendingDeliveries()
          .catch((error) => console.error("delivery recovery", error));
      }, 30_000);
      this.deliveryRecoveryTimer.unref?.();
      this.pluginEvents.start();
      this.externalPoller.start();
      // Settles deliveries a previous process left unfinished, now and every 30 seconds.
      this.externalDelivery.startRecovery();
      this.externalReminders.start();
      // Asset pruning can scan a large history and filesystem. Keep the
      // lifecycle behavior without extending the server's critical startup path.
      queueMicrotask(() => {
        void this.pruneUnreferencedAssets().catch((error) => console.error("asset cleanup", error));
      });
      this.assetCleanupTimer = setInterval(
        () => {
          void this.pruneUnreferencedAssets().catch((error) =>
            console.error("asset cleanup", error)
          );
        },
        6 * 60 * 60_000
      );
      this.assetCleanupTimer.unref?.();
      const groups = await this.prisma.channel.findMany({
        where: { kind: "group", archivedAt: null },
        select: { workingDirectory: true },
      });
      try {
        await provisionDirectories(
          (path, init) => this.computerFetch(path, init),
          [
            resolve(this.workspaceRoot, "bots"),
            resolve(this.workspaceRoot, "shared"),
            ...groups.flatMap((group) => (group.workingDirectory ? [group.workingDirectory] : [])),
          ]
        );
      } catch (error) {
        // The computer may still be establishing its management route during
        // startup. Defer directory provisioning until the next runtime action
        // instead of creating a server/computer startup deadlock.
        console.error("computer directory provisioning deferred", error);
      }
      await this.prisma.computer.upsert({
        where: { id: COMPUTER_ID },
        create: {
          id: COMPUTER_ID,
          status: "starting",
          capabilities: {
            headless: false,
            graphical: true,
            browser: "chromium",
            fileManager: "thunar",
          },
        },
        update: {
          capabilities: {
            headless: false,
            graphical: true,
            browser: "chromium",
            fileManager: "thunar",
          },
        },
      });
      if (reconnect.length) queueMicrotask(() => void this.plugins.reconnect(reconnect));
    });

  close = () =>
    Effect.promise(async () => {
      if (this.deliveryRecoveryTimer) {
        clearInterval(this.deliveryRecoveryTimer);
        this.deliveryRecoveryTimer = null;
      }
      if (this.eventPruneTimer) {
        clearInterval(this.eventPruneTimer);
        this.eventPruneTimer = null;
      }
      if (this.assetCleanupTimer) {
        clearInterval(this.assetCleanupTimer);
        this.assetCleanupTimer = null;
      }
      await this.pluginEvents.stop();
      await this.externalPoller.stop();
      this.externalDelivery.stopRecovery();
      this.externalReminders.stop();
      await this.voice.stopGroupDeliveryWatcher();
      await this.outcomeEvidence.stop();
      await this.outcomeResultSummaries.stop();
      await this.eventWakeup.stop();
      await this.agentData.stopWatching();
      await this.boss.stop({ graceful: true });
      await this.plugins.close();
      await this.prisma.$disconnect();
    });

  private async pruneUnreferencedAssets(): Promise<void> {
    // Keep candidate extraction in PostgreSQL, including durable receipt history
    // and knowledge snapshots whose attachments no longer occur in a message.
    const candidates = await this.prisma.$queryRaw<Array<{ assetId: string | null }>>(Prisma.sql`
      ${referencedAssetIdsSql}
    `);
    const referenced = new Set(
      candidates.flatMap(({ assetId }) => (assetId && ASSET_ID.test(assetId) ? [assetId] : []))
    );
    await this.assets.prune(referenced, undefined, (assetId, remove) => this.prisma.$transaction(async tx => {
      await lockAssetReferences(tx, [`asset:${assetId}`]);
      const [current] = await tx.$queryRaw<Array<{ referenced: boolean }>>(Prisma.sql`
        SELECT EXISTS (SELECT 1 FROM (${referencedAssetIdsSql}) AS refs WHERE "assetId" = ${assetId}) AS referenced
      `);
      return current?.referenced ? false : remove();
    }));
  }

  createBot = forwardServiceMethod(() => this.bots.create);

  broadcast = (input: import("@outcomego/contracts").AdminBroadcastInput) =>
    serviceEffect(() => this.messaging.broadcast(input));

  listBots = (includeHidden = false) => this.bots.list(includeHidden);
  listBotMemories = (botId: string) => serviceEffect(() => this.agentData.listBotMemories(botId));
  deleteBotMemories = (botId: string, memoryId?: string) =>
    serviceEffect(() => this.agentData.deleteBotMemories(botId, memoryId));

  updateBot = forwardServiceMethod(() => this.bots.update);

  retryBotProvisioning = forwardServiceMethod(() => this.bots.retryProvisioning);

  botTranscript = forwardServiceMethod(() => this.bots.transcript);

  userTimeZone = async () =>
    userTimeZoneView(await this.prisma.userTimeZoneSettings.findUnique({ where: { id: "global" } }));

  updateUserTimeZone = (input: UpdateUserTimeZoneInput) =>
    this.prisma.$transaction((tx) =>
      this.messaging.updateUserTimeZone(tx, {
        ...(input.detectedTimeZone !== undefined ? { detected: input.detectedTimeZone } : {}),
        ...(input.overrideTimeZone !== undefined ? { override: input.overrideTimeZone } : {}),
      })
    );

  featureSettings = () => readFeatureSettings(this.prisma);

  updateFeatureSettings = async (input: UpdateFeatureSettingsInput) => {
    if (input.environmentNote !== undefined && input.environmentNote !== null && input.environmentNote.length > 8_000) {
      throw new ApiError(400, "invalid_request", "Environment note must be at most 8000 characters");
    }
    if (input.plannerBotId) {
      if (!(await isBotRunnable(this.prisma, input.plannerBotId))) {
        throw new ApiError(409, "bot_not_runnable", "Choose an active, runnable bot for the planning role");
      }
    }
    if (input.reviewerBotId) {
      if (!(await isBotRunnable(this.prisma, input.reviewerBotId))) {
        throw new ApiError(409, "bot_not_runnable", "Choose an active, runnable bot for the review role");
      }
    }
    const plannerModel =
      input.plannerModel === undefined
        ? undefined
        : input.plannerModel === null
          ? null
          : await verifyInferenceModelSelection((path, init) => this.computerFetch(path, init), this.agentData, input.plannerModel).then((v) => ({
              providerId: v.providerId,
              modelId: v.modelId,
              ...(v.reasoning ? { reasoning: v.reasoning } : {}),
            }));
    const reviewerModel =
      input.reviewerModel === undefined
        ? undefined
        : input.reviewerModel === null
          ? null
          : await verifyInferenceModelSelection((path, init) => this.computerFetch(path, init), this.agentData, input.reviewerModel).then((v) => ({
              providerId: v.providerId,
              modelId: v.modelId,
              ...(v.reasoning ? { reasoning: v.reasoning } : {}),
            }));
    const settings = await updateFeatureSettings(this.prisma, {
      ...input,
      ...(plannerModel !== undefined ? { plannerModel } : {}),
      ...(reviewerModel !== undefined ? { reviewerModel } : {}),
    });
    if (input.streamBotReplies === false) this.replyPreviews.clear();
    return settings;
  };

  listRoutines = (botId: string) => serviceEffect(() => this.routines.list(botId));

  listGroupRoutines = (channelId: string) =>
    serviceEffect(() => this.routines.listOwner({ kind: "group", id: channelId }));

  routineDetail = (routineId: string) =>
    serviceEffect(async () =>
      this.routines.detailOwner(await this.routines.owner(routineId), routineId)
    );

  private validateRoutineWebhookInput = (trigger: unknown): void => {
    if (containsWebhookTrigger(trigger)) {
      this.automationWebhooks.validateRoutineWebhookConfiguration();
    }
  };

  private syncRoutineWebhook = async (
    owner: { kind: "bot" | "group"; id: string },
    routineId: string,
    trigger: unknown,
    previousTrigger?: unknown
  ): Promise<void> => {
    if (containsWebhookTrigger(trigger)) {
      await this.automationWebhooks.ensureRoutineWebhook(routineId, owner);
    } else if (containsWebhookTrigger(previousTrigger)) {
      await this.automationWebhooks.removeRoutineWebhook(routineId, owner);
    }
  };

  routineWebhook = (routineId: string) =>
    serviceEffect(async () =>
      this.automationWebhooks.routineWebhook(routineId, await this.routines.owner(routineId))
    );

  createGroupRoutine = (channelId: string, clientId: string, input: RoutineMutationInput) =>
    serviceEffect(async () => {
      const owner = { kind: "group" as const, id: channelId };
      this.validateRoutineWebhookInput(input.trigger);
      const created = await this.routines.mutateOwner(owner, clientId, null, {
        ...input,
        action: "create",
        source: "ui",
      });
      await this.syncRoutineWebhook(owner, String(created.id), created.trigger);
      return this.routines.detailOwner(owner, String(created.id));
    });

  createRoutine = (botId: string, clientId: string, input: RoutineMutationInput) =>
    serviceEffect(async () => {
      this.validateRoutineWebhookInput(input.trigger);
      const owner = { kind: "bot" as const, id: botId };
      const created = await this.routines.mutate(botId, clientId, null, {
        ...input,
        action: "create",
        source: "ui",
      });
      await this.syncRoutineWebhook(owner, String(created.id), created.trigger);
      return this.routines.detail(botId, String(created.id));
    });

  updateRoutine = (routineId: string, clientId: string, input: RoutineMutationInput) =>
    serviceEffect(async () => {
      const owner = await this.routines.owner(routineId);
      const previous = await this.routines.detailOwner(owner, routineId);
      if (input.trigger !== undefined) this.validateRoutineWebhookInput(input.trigger);
      await this.routines.mutateOwner(owner, clientId, null, {
        ...input,
        id: routineId,
        action: "update",
        source: "ui",
      });
      const saved = await this.routines.detailOwner(owner, routineId);
      await this.syncRoutineWebhook(owner, routineId, saved.trigger, previous.trigger);
      return saved;
    });

  routineLifecycle = (
    routineId: string,
    clientId: string,
    action: "pause" | "resume" | "delete",
    expectedRevision?: number
  ) =>
    serviceEffect(async () => {
      const owner = await this.routines.owner(routineId);
      const result = await this.routines.mutateOwner(owner, clientId, null, {
        id: routineId,
        action,
        expectedRevision,
        source: "ui",
      });
      if (action === "pause" || action === "resume") {
        await this.automationWebhooks.setRoutineWebhookEnabled(
          routineId,
          owner,
          action === "resume"
        );
      } else if (action === "delete") {
        await this.automationWebhooks.removeRoutineWebhook(routineId, owner);
      }
      return action === "delete" ? result : this.routines.detailOwner(owner, routineId);
    });

  runRoutineNow = (routineId: string, clientId: string) =>
    serviceEffect(async () =>
      this.routines.runNowOwner(await this.routines.owner(routineId), routineId, clientId)
    );

  routineExecutions = (routineId: string, limit: number) =>
    serviceEffect(async () =>
      this.routines.executionsOwner(await this.routines.owner(routineId), routineId, limit)
    );

  screenStatus = forwardServiceMethod(() => this.screens.status);

  screenFrame = forwardServiceMethod(() => this.screens.frame);

  screenStream = forwardServiceMethod(() => this.screens.stream);

  botAvatar = forwardServiceMethod(() => this.screens.avatar);

  screenAction = forwardServiceMethod(() => this.screens.action);
  screenClipboard = forwardServiceMethod(() => this.screens.clipboard);

  screenTakeover = forwardServiceMethod(() => this.screens.takeover);

  screenActivity = forwardServiceMethod(() => this.screens.reportActivity);

  screenPause = forwardServiceMethod(() => this.screens.pause);

  archiveBot = forwardServiceMethod(() => this.bots.archive);

  sendMessage = forwardServiceMethod(() => this.channels.sendDirectMessage);

  messageDeliveryStatus = forwardServiceMethod(() => this.channels.messageDeliveryStatus);

  createGroup = forwardServiceMethod(() => this.channels.createGroup);

  listGroups = (includeHidden = false) => this.channels.listGroups(includeHidden);

  renameChannel = forwardServiceMethod(() => this.channels.renameDirectChannel);

  updateChannelProfile = forwardServiceMethod(() => this.channels.updateGroupProfile);

  setChannelAvatar = forwardServiceMethod(() => this.channels.setGroupAvatar);

  channelAvatar = forwardServiceMethod(() => this.channels.groupAvatar);

  setChannelMembers = forwardServiceMethod(() => this.channels.setGroupMembers);

  setChannelHidden = forwardServiceMethod(() => this.channels.setGroupHidden);

  deleteGroup = forwardServiceMethod(() => this.channels.deleteGroup);

  sendChannelMessage = forwardServiceMethod(() => this.channels.sendGroupMessage);

  reactToMessage = forwardServiceMethod(() => this.channels.reactToMessage);

  respondToWidget = forwardServiceMethod(() => this.richMessages.respondToWidget);
  mutateSharedTemplate = forwardServiceMethod(() => this.richMessages.sharedTemplates.mutate);
  sharedTemplateRecipe = (id: string, publicOnly = false) =>
    this.richMessages.sharedTemplates.recipe(id, publicOnly);
  mutateExternalDraft = forwardServiceMethod(() => this.richMessages.externalDrafts.mutate);
  mutateIMessageSend = forwardServiceMethod(() => this.richMessages.messagesSends!.mutate);
  submitUserForm = forwardServiceMethod(() => this.richMessages.submitUserForm);
  userFormPrefill = forwardServiceMethod(() => this.richMessages.formPrefill);

  dismissWidget = forwardServiceMethod(() => this.richMessages.dismissWidget);

  submitSecret = forwardServiceMethod(() => this.richMessages.submitSecret);

  mutateComputerHandoff = forwardServiceMethod(() => this.richMessages.mutateComputerHandoff);

  handleDynamicTool = forwardServiceMethod(() => this.internalTools.execute);

  pluginSettings = forwardServiceMethod(() => this.plugins.settings);

  pluginConnectionStatuses = forwardServiceMethod(() => this.plugins.pollConnectionStatuses);

  rootSettings = forwardServiceMethod(() => this.settings.rootSettings);

  serverSettings = forwardServiceMethod(() => this.settings.serverSettings);
  taskSettings = forwardServiceMethod(() => this.settings.taskSettings);
  updateTaskSettings = forwardServiceMethod(() => this.settings.updateTaskSettings);

  updateInferenceSettings = forwardServiceMethod(() => this.settings.updateInferenceSettings);
  testInference = forwardServiceMethod(() => this.settings.testInference);

  startInferenceProviderAuth = forwardServiceMethod(() => this.settings.startInferenceProviderAuth);

  inferenceProviderAuthSession = forwardServiceMethod(
    () => this.settings.inferenceProviderAuthSession
  );

  respondToInferenceProviderAuth = forwardServiceMethod(
    () => this.settings.respondToInferenceProviderAuth
  );

  cancelInferenceProviderAuth = forwardServiceMethod(
    () => this.settings.cancelInferenceProviderAuth
  );

  inferenceProviderPresets = forwardServiceMethod(() => this.settings.inferenceProviderPresets);
  addInferenceProvider = forwardServiceMethod(() => this.settings.addInferenceProvider);
  removeInferenceProvider = forwardServiceMethod(() => this.settings.removeInferenceProvider);
  disconnectInferenceProvider = forwardServiceMethod(
    () => this.settings.disconnectInferenceProvider
  );

  updateSidebarPreferences = forwardServiceMethod(() => this.settings.updateSidebarPreferences);

  activeAgent = forwardServiceMethod(() => this.settings.activeAgent);

  setActiveAgent = forwardServiceMethod(() => this.settings.setActiveAgent);

  installPlugin = forwardServiceMethod(() => this.plugins.install);

  addCustomMcp = forwardServiceMethod(() => this.plugins.addCustomMcp);

  uninstallPlugin = forwardServiceMethod(() => this.plugins.uninstall);

  updatePluginEnvironment = forwardServiceMethod(() => this.plugins.updateEnvironment);

  connectPlugin = forwardServiceMethod(() => this.plugins.connect);

  disconnectPlugin = forwardServiceMethod(() => this.plugins.disconnect);

  addPluginAccount = forwardServiceMethod(() => this.plugins.addAccount);

  configurePluginConnection = forwardServiceMethod(() => this.plugins.configure);

  authenticatePlugin = forwardServiceMethod(() => this.plugins.authenticate);

  finishPluginAuthentication = forwardServiceMethod(() => this.plugins.finishAuthentication);

  restartPluginConnection = forwardServiceMethod(() => this.plugins.restart);

  renamePluginAccount = forwardServiceMethod(() => this.plugins.renameAccount);

  externalMessaging = (connectionId: string) => serviceEffect(() => this.externalBindings.get(connectionId));

  putExternalMessaging = (connectionId: string, input: { enabled: boolean; botId: string; reminder?: { enabled: boolean; time: string } }) =>
    serviceEffect(() => this.externalBindings.put(connectionId, input));

  deleteExternalMessaging = (connectionId: string) =>
    serviceEffect(async () => {
      await this.externalBindings.delete(connectionId);
      return { deleted: true };
    });

  setExternalChannelArchived = (channelId: string, archived: boolean) =>
    serviceEffect(async () => {
      await this.externalDelivery.setChannelArchived(channelId, archived);
      return { archived };
    });

  removePluginAccount = forwardServiceMethod(() => this.plugins.removeAccount);

  setMcpInstructions = forwardServiceMethod(() => this.plugins.setInstructions);

  cancelRun = forwardServiceMethod(() => this.subagents.stopRun);

  stopBot = forwardServiceMethod(() => this.subagents.stopBot);

  busyBots = forwardServiceMethod(() => this.subagents.busyBots);


  snapshot = forwardServiceMethod(() => this.snapshots.full);

  clientSnapshot = forwardServiceMethod(() => this.snapshots.client);

  clientBootstrap = forwardServiceMethod(() => this.snapshots.bootstrap);

  channelHistory = forwardServiceMethod(() => this.snapshots.history);
  chatBranches = forwardServiceMethod(() => this.snapshots.chatBranches);
  cancelChatBranch = forwardServiceMethod(() => this.runs.cancelChatBranch);

  channelMessageContext = forwardServiceMethod(() => this.snapshots.messageContext);

  channelClientState = forwardServiceMethod(() => this.snapshots.channelState);

  clientRuntime = forwardServiceMethod(() => this.snapshots.clientRuntime);

  uploadAsset = (input: UploadAssetInput) => serviceEffect(() => this.assets.decodeUpload(input));

  uploadBinaryAsset = (
    stream: ReadableStream<Uint8Array>,
    contentType: string,
    fileName: string | null,
    signal?: AbortSignal
  ) =>
    serviceEffect(() =>
      this.assets.ingestStream({
        stream,
        mimeType: contentType,
        fileName: fileName ?? "attachment",
        signal,
      })
    );

  registerPushDevice = forwardServiceMethod(() => this.notifications.register);

  unregisterPushDevice = forwardServiceMethod(() => this.notifications.unregister);

  disablePushDevicesForSession = forwardServiceMethod(() => this.notifications.disableForSession);

  markChannelRead = forwardServiceMethod(() => this.notifications.markChannelRead);
  setGroupNotificationMute = forwardServiceMethod(() => this.notifications.setGroupNotificationMute);

  search = forwardServiceMethod(() => this.searchIndex.search);
  channelLibrary = forwardServiceMethod(() => this.library.list);
  groupTaskBoard = (channelId: string, includeClosed: boolean) =>
    serviceEffect(() => this.groupTasks.list(channelId, { kind: "user" }, { includeClosed }));
  actOnGroupTask = (channelId: string, number: number, input: GroupTaskUserAction) =>
    serviceEffect(async () => ({ task: await this.groupTasks.userAct(channelId, number, input) }));

  health = forwardServiceMethod(() => this.snapshots.health);

  eventsAfter = (sequence: bigint) => this.snapshots.eventsAfter(sequence);

  eventWindowAfter = (sequence: bigint, limit?: number) =>
    this.snapshots.eventWindowAfter(sequence, limit);

  waitForEvent = (version: number, timeoutMs: number, signal?: AbortSignal) =>
    this.eventWakeup.wait(version, timeoutMs, signal);

  get eventVersion() {
    return this.eventWakeup.currentVersion;
  }

  private async recover(): Promise<void> {
    return recover(this.prisma, this.boss, this.messaging, (path, init) =>
      this.computerFetch(path, init)
    );
  }

  async browserNetworkQuality() {
    const response = await this.computerFetch("/v1/browser-network/quality", { method: "POST", body: "{}", signal: AbortSignal.timeout(24_000) });
    if (!response.ok) throw new ApiError(503, "network_quality_unavailable", "Could not test the active browser connection");
    return await response.json() as import("@outcomego/contracts/browser-network").NetworkQuality;
  }

  async browserNetworkConnectivity() {
    const response = await this.computerFetch("/v1/browser-network", {
      method: "GET", signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return undefined;
    const status = await response.json() as { ready?: boolean; connectivity?: import("@outcomego/contracts/browser-network").NetworkConnectivity };
    return status.ready ? status.connectivity : undefined;
  }

  async browserNetworkEgress() {
    const response = await this.computerFetch("/v1/browser-network/egress", { method: "POST", body: "{}" });
    if (!response.ok) throw new ApiError(503, "network_egress_unavailable", "Could not check browser exit connection");
    return await response.json() as import("@outcomego/contracts/browser-network").NetworkEgress;
  }

  computerNetworkPolicyView() {
    return this.computerNetworkPolicy.view();
  }

  updateComputerNetworkPolicy(input: unknown) {
    return this.computerNetworkPolicy.update(input);
  }

  computerNetworkPolicySnapshot() {
    return this.computerNetworkPolicy.snapshot();
  }

  private async computerNetworkPolicyRuntime(): Promise<import("@outcomego/contracts").ComputerNetworkPolicyStatus | undefined> {
    try {
      const response = await this.computerFetch("/v1/computer-network-policy", {
        method: "GET",
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) return undefined;
      return await response.json() as import("@outcomego/contracts").ComputerNetworkPolicyStatus;
    } catch {
      return undefined;
    }
  }

  private computerFetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.computerUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.controlToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
  }

  private async computerJson<T = { ok: true }>(path: string, init: RequestInit): Promise<T> {
    const response = await this.computerFetch(path, init);
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const body = JSON.parse(text) as { error?: unknown };
        if (typeof body.error === "string") message = body.error;
      } catch {
        // Preserve a non-JSON computer error as-is.
      }
      throw new ApiError(
        response.status >= 500 ? 503 : 400,
        "inference_provider_error",
        message || "The inference provider operation failed"
      );
    }
    return (await response.json()) as T;
  }
}
