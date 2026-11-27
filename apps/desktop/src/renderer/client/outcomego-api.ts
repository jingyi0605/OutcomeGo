import type { ChatBranchPage } from "@outcomego/contracts";
import { createOutcomeApi, createScheduleApi } from "./outcome-api";
import { createInboxApi } from "../components/outcomego/outcomes/inbox/inbox-api";
import type { AttentionSample } from "../lib/outcome-attention";
import { createHumanMaterialApi } from "../components/outcomego/outcomes/human-work/human-api";
import type { OutcomeNotificationPayload } from "@outcomego/contracts/notification-content";
import type { RecoveryState } from "../components/outcomego/outcomes/inbox/recovery-diagnostics";
import { createOutcomeGoClient } from "@outcomego/client-core";
import { authHeaders, getDesktopMachineId } from "./auth";
import { API_BASE, desktopTransportOptions } from "./http";
import { request } from "./http";
import type {
  VoiceSessionCreateInput,
  VoiceSessionTicketView,
  VoiceSessionView,
  VoiceSettingsInput,
  VoiceSettingsView,
} from "@outcomego/contracts/voice";
import type {
  AutomationWebhookPublicUrlCheck,
  AutomationWebhookPublicUrlView,
} from "@outcomego/contracts/automation-webhooks";
import type {
  CalendarFeedListResponse,
  CreatedCalendarFeed,
  CreateCalendarFeedInput,
  ExternalCalendarListResponse,
  ExternalCalendarResponse,
} from "@outcomego/contracts/task-overview";

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Portable product API plus the desktop lifecycle adapter below. */
export const outcomeGoClient = createOutcomeGoClient({
  ...desktopTransportOptions,
  createId: () => crypto.randomUUID(),
  timeZone: localTimeZone,
  sourceMachineId: getDesktopMachineId,
});

export type { ChannelClientState, ClientBootstrapView } from "@outcomego/contracts";

const outcomes = createOutcomeApi(request);
const schedule = createScheduleApi(request);

export const api = {
  outcomes,
  schedule,
  calendarFeeds: {
    list: () => request<CalendarFeedListResponse>("/api/calendar/feeds"),
    create: (input: CreateCalendarFeedInput) => request<CreatedCalendarFeed>("/api/calendar/feeds", { method: "POST", body: JSON.stringify(input) }),
    revoke: (id: string) => request(`/api/calendar/feeds/${encodeURIComponent(id)}`, { method: "DELETE" }),
    rotate: (id: string) => request<CreatedCalendarFeed>(`/api/calendar/feeds/${encodeURIComponent(id)}/rotate`, { method: "POST" }),
  },
  externalCalendar: {
    calendars: (connectionId: string) => request<ExternalCalendarListResponse>(`/api/schedule/external/calendars?connectionId=${encodeURIComponent(connectionId)}`),
    events: (input: { connectionId: string; calendarId: string; from: string; to: string; busyOnly: boolean }) => {
      const params = new URLSearchParams({ ...input, busyOnly: String(input.busyOnly) });
      return request<ExternalCalendarResponse>(`/api/schedule/external?${params}`);
    },
  },
  stopChatBranch: (channelId: string, branchId: string) =>
    request<{ ok: boolean }>(`/api/channels/${encodeURIComponent(channelId)}/branches/${encodeURIComponent(branchId)}/stop`, { method: "POST" }),
  chatBranches: (channelId: string, { archived, before, signal }: { archived: boolean; before?: string; signal: AbortSignal }) => {
    const query = new URLSearchParams({ archived: String(archived) });
    if (before) query.set("before", before);
    return request<ChatBranchPage>(`/api/channels/${encodeURIComponent(channelId)}/branches?${query}`, { signal });
  },
  outcomeInbox: createInboxApi(request),
  humanMaterials: createHumanMaterialApi(request),
  outcomeNotificationState: () => request<{ outcomeNotifications?: OutcomeNotificationPayload[] }>("/api/notification-state"),
  outcomeRecovery: (id: string) => request<RecoveryState>(`/api/outcomes/${encodeURIComponent(id)}/recovery`),
  reconcileOutcome: (id: string, clientRequestId: string) => request<RecoveryState>(
    `/api/outcomes/${encodeURIComponent(id)}/reconcile`, { method: "POST", body: JSON.stringify({ clientRequestId }) }
  ),
  outcomeAttention: (id: string, sample: AttentionSample) => request<{ recorded: true }>(
    `/api/outcomes/${encodeURIComponent(id)}/attention`, { method: "POST", body: JSON.stringify(sample), keepalive: true }
  ),
  ...outcomeGoClient,
  authenticatePlugin: (connectionId: string, force = false) =>
    window.outcomego?.pluginOAuth
      ? window.outcomego.pluginOAuth.start(connectionId, force)
      : outcomeGoClient.authenticatePlugin(connectionId, force),
  cancelPluginAuthentication: async (connectionId: string, state: string) => {
    if (await window.outcomego?.pluginOAuth?.cancel(connectionId, state)) return { cancelled: true };
    // A server callback, or an attempt owned by a different desktop, can still be cancelled.
    const settings = await outcomeGoClient.pluginConnectionStatuses([connectionId]);
    const authorizationUrl = settings.connections[0]?.authorizationUrl;
    const redirect = authorizationUrl ? new URL(authorizationUrl).searchParams.get("redirect_uri") : null;
    const local = redirect?.startsWith("http://127.0.0.1:") && new URL(redirect).pathname === "/callback";
    return outcomeGoClient.cancelPluginAuthentication(connectionId, state, local ? redirect! : undefined);
  },
  sendMessage: outcomeGoClient.sendDirectMessage,
  voice: {
    createSession: (input: VoiceSessionCreateInput) => request<VoiceSessionTicketView>("/api/voice/sessions", { method: "POST", body: JSON.stringify(input) }),
    getSession: (sessionId: string) => request<{ session: VoiceSessionView; turns: unknown[] }>(`/api/voice/sessions/${encodeURIComponent(sessionId)}`),
    reconnectTicket: (sessionId: string) => request<VoiceSessionTicketView>(`/api/voice/sessions/${encodeURIComponent(sessionId)}/tickets`, { method: "POST" }),
    endSession: (sessionId: string) => request<{ ok: true }>(`/api/voice/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
    settings: () => request<VoiceSettingsView>("/api/server-settings/voice"),
    updateSettings: (input: VoiceSettingsInput) =>
      request<VoiceSettingsView>("/api/server-settings/voice", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
  },
  automationWebhookPublicUrl: () =>
    request<AutomationWebhookPublicUrlView>(
      "/api/server-settings/automation-webhook-public-url"
    ),
  updateAutomationWebhookPublicUrl: (publicUrl: string) =>
    request<AutomationWebhookPublicUrlView & { updatedWebhooks: number }>(
      "/api/server-settings/automation-webhook-public-url",
      { method: "PATCH", body: JSON.stringify({ publicUrl }) }
    ),
  checkAutomationWebhookPublicUrl: (publicUrl: string) =>
    request<AutomationWebhookPublicUrlCheck>(
      "/api/server-settings/automation-webhook-public-url/check",
      { method: "POST", body: JSON.stringify({ publicUrl }) }
    ),
  routineWebhook: (routineId: string) =>
    outcomeGoClient.routineWebhook(routineId),
  screenTakeover: outcomeGoClient.setScreenTakeover,
  /** Best-effort unload path; keepalive is a browser lifecycle concern. */
  releaseScreenTakeover: (botId: string) => {
    void fetch(`${API_BASE}/api/v0/bots/${encodeURIComponent(botId)}/screen/takeover`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ active: false }),
      keepalive: true,
    }).catch(() => undefined);
  },
  /** Best-effort navigation/app-close path for an active secure handoff. */
  releaseComputerHandoff: (messageId: string) => {
    void fetch(
      `${API_BASE}/api/v0/channel-messages/${encodeURIComponent(messageId)}/computer-handoff`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action: "dismiss", clientId: crypto.randomUUID() }),
        keepalive: true,
      }
    ).catch(() => undefined);
  },
};
