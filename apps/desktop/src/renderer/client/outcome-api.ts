import type { ActivityResponse, NeedsMeResponse, ScheduleQuery, ScheduleResponse } from "@outcomego/contracts/task-overview";
import type {
  ActOnOutcomeInput,
  ConvertOutcomeInput,
  CreateOutcomeAutoAcceptRuleInput,
  CreateOutcomeInput,
  OutcomeAutoAcceptRuleView,
  UpdateOutcomeAutoAcceptRuleInput,
  UpdateOutcomeInput,
  CreateContractRevisionInput,
  ApproveContractRevisionInput,
  AdoptPrereviewInput,
  SubmitOutcomeReviewInput,
  DecideOutcomeAcceptanceInput,
  OutcomeReworkInput,
  CancelOutcomeInput,
  StartOutcomeRunInput,
  OutcomeDetail,
  OutcomeListPage,
  ContractRevisionView,
  OutcomeBrief,
  OutcomeResultSummary,
  OutcomeWorkThreadPage,
  SetOutcomeDueInput,
  SetWorkItemScheduleInput,
} from "@outcomego/contracts/outcomes";
import type { OutcomeIntakeInput } from "@outcomego/contracts";

import type {
  OutcomeThreadTurnView,
  OutcomeThreadView,
  RequestOutcomePlanInput,
  SendOutcomeThreadMessageInput,
} from "@outcomego/contracts/outcome-thread";

/** A new or converted Outcome, with the planning turn it queued, if any. */
export interface OutcomePlanned {
  outcome: OutcomeDetail;
  turn: OutcomeThreadTurnView | null;
}

export interface OutcomeAutoAcceptRulesClient {
  list(): Promise<{ rules: OutcomeAutoAcceptRuleView[] }>;
  create(input: CreateOutcomeAutoAcceptRuleInput): Promise<OutcomeAutoAcceptRuleView>;
  update(id: string, input: UpdateOutcomeAutoAcceptRuleInput): Promise<OutcomeAutoAcceptRuleView>;
  remove(id: string): Promise<void>;
}

export interface OutcomeClient {
  /** A new Outcome of any kind; a standard goal is also handed to its planner. */
  create(input: CreateOutcomeInput): Promise<OutcomePlanned>;
  /** Captures owner text and attachments as a source note before asynchronous triage. */
  intake(input: OutcomeIntakeInput): Promise<OutcomePlanned>;
  list(query?: string): Promise<OutcomeListPage>;
  get(id: string): Promise<OutcomeDetail>;
  update(id: string, input: UpdateOutcomeInput): Promise<OutcomeDetail>;
  act(id: string, input: ActOnOutcomeInput): Promise<OutcomeDetail>;
  /** Changes the kind in place: the Outcome keeps its identity and history. */
  convert(id: string, input: ConvertOutcomeInput): Promise<OutcomePlanned>;
  /** Queues run advice or a contract plan; the answer arrives in the Outcome's thread. */
  plan?(id: string, input: RequestOutcomePlanInput): Promise<OutcomeThreadTurnView>;
  autoAcceptRules?: OutcomeAutoAcceptRulesClient;
  brief?(id: string): Promise<OutcomeBrief>;
  resultSummary?(id: string, revision: number): Promise<OutcomeResultSummary | null>;
  getRevision?(id: string, revision: number): Promise<ContractRevisionView>;
  revise(id: string, input: CreateContractRevisionInput): Promise<OutcomeDetail>;
  /** The goal's own Agent thread: the owner's words and the bot's answers. */
  thread?(id: string): Promise<OutcomeThreadView>;
  /** The owner's words, delivered to the bot as written; the server answers at once. */
  sendThreadMessage?(id: string, input: SendOutcomeThreadMessageInput): Promise<OutcomeThreadTurnView>;
  approve(
    id: string,
    revision: number,
    input: ApproveContractRevisionInput
  ): Promise<OutcomeDetail>;
  start(id: string, input: StartOutcomeRunInput): Promise<OutcomeDetail>;
  review(id: string, input: SubmitOutcomeReviewInput): Promise<OutcomeDetail>;
  adoptPrereview?(id: string, input: AdoptPrereviewInput): Promise<OutcomeDetail>;
  decideAcceptance?(id: string, input: DecideOutcomeAcceptanceInput): Promise<OutcomeDetail>;
  rework(id: string, input: OutcomeReworkInput): Promise<OutcomeDetail>;
  cancel(id: string, input: CancelOutcomeInput): Promise<OutcomeDetail>;
  stopWorkThread?(id: string, itemId: string): Promise<{ ok: boolean }>;
  /** The owner changes a not-yet-started task's schedule (specs/004.10). A field left out is unchanged; `null` clears it. */
  setWorkItemSchedule?(id: string, workItemId: string, input: SetWorkItemScheduleInput): Promise<OutcomeDetail>;
  /** The owner sets or clears the goal's due date (specs/004.10). */
  setDue?(id: string, input: SetOutcomeDueInput): Promise<OutcomeDetail>;
  /** What every bot is doing (specs/004.10). Absent on a server that has no such call. */
  activity?(query?: { botId?: string; includeAll?: boolean; recentHours?: number }): Promise<ActivityResponse>;
  /** The requests that wait on the owner (specs/004.10). Absent on a server that has no such call. */
  needsMe?(): Promise<NeedsMeResponse>;
  workThreads?(botId: string, query: { archived?: boolean; cursor?: string; signal?: AbortSignal }): Promise<OutcomeWorkThreadPage>;
  transcript(id: string, itemId: string, query?: { before?: number }): Promise<unknown>;
}

export interface ScheduleClient {
  list(query: ScheduleQuery): Promise<ScheduleResponse>;
  /** Moves a to-do or a scheduled goal to a new time. */
  rescheduleOutcome(id: string, field: "scheduledAt" | "dueAt", value: string): Promise<unknown>;
}

export function createOutcomeApi(
  request: <T>(path: string, init?: RequestInit) => Promise<T>
): OutcomeClient {
  const outcomePath = (id: string) => `/api/outcomes/${encodeURIComponent(id)}`;
  const rulesPath = "/api/outcomes/auto-accept-rules";
  const outcomePost = <T>(path: string, input: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(input) });
  const outcomePut = <T>(path: string, input: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(input) });
  return {
    create: (input) => outcomePost("/api/outcomes", input),
    intake: (input) => outcomePost("/api/outcomes/intake", input),
    list: (query = "") => request(`/api/outcomes${query ? `?${query}` : ""}`),
    get: (id) => request(outcomePath(id)),
    update: (id, input) => request(outcomePath(id), { method: "PATCH", body: JSON.stringify(input) }),
    act: (id, input) => outcomePost(`${outcomePath(id)}/actions`, input),
    convert: (id, input) => outcomePost(`${outcomePath(id)}/convert`, input),
    plan: (id, input) => outcomePost(`${outcomePath(id)}/plan`, input),
    autoAcceptRules: {
      list: () => request(rulesPath),
      create: (input) => outcomePost(rulesPath, input),
      update: (id, input) => request(`${rulesPath}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
      remove: (id) => request(`${rulesPath}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    },
    brief: (id) => request(`${outcomePath(id)}/brief`),
    resultSummary: (id, revision) => request(`${outcomePath(id)}/revisions/${revision}/results-summary`),
    getRevision: (id, revision) => request(`${outcomePath(id)}/revisions/${revision}`),
    revise: (id, input) => outcomePost(`${outcomePath(id)}/revisions`, input),
    thread: (id) => request(`${outcomePath(id)}/thread`),
    sendThreadMessage: (id, input) => outcomePost(`${outcomePath(id)}/thread/messages`, input),
    approve: (id, revision, input) =>
      outcomePost(`${outcomePath(id)}/revisions/${revision}/approve`, input),
    start: (id, input) => outcomePost(`${outcomePath(id)}/runs`, input),
    review: (id, input) => outcomePost(`${outcomePath(id)}/reviews`, input),
    adoptPrereview: (id, input) => outcomePost(`${outcomePath(id)}/reviews/adopt-prereview`, input),
    decideAcceptance: (id, input) => outcomePost(`${outcomePath(id)}/acceptance`, input),
    rework: (id, input) => outcomePost(`${outcomePath(id)}/rework`, input),
    cancel: (id, input) => outcomePost(`${outcomePath(id)}/cancel`, input),
    stopWorkThread: (id, itemId) => outcomePost(`${outcomePath(id)}/work-items/${encodeURIComponent(itemId)}/stop`, {}),
    setWorkItemSchedule: (id, workItemId, input) =>
      outcomePut(`${outcomePath(id)}/work-items/${encodeURIComponent(workItemId)}/schedule`, input),
    setDue: (id, input) => outcomePut(`${outcomePath(id)}/due`, input),
    needsMe: () => request("/api/needs-me"),
    activity: (query = {}) => {
      const params = new URLSearchParams();
      if (query.botId) params.set("botId", query.botId);
      if (query.includeAll) params.set("includeAll", "true");
      if (query.recentHours !== undefined) params.set("recentHours", String(query.recentHours));
      const suffix = params.toString();
      return request(`/api/activity${suffix ? `?${suffix}` : ""}`);
    },
    workThreads: (botId, { archived, cursor, signal }) => {
      const query = new URLSearchParams();
      if (archived) query.set("archived", "true");
      if (cursor) query.set("cursor", cursor);
      return request(`/api/outcomes/work-threads/${encodeURIComponent(botId)}?${query}`, { signal });
    },
    transcript: (id, itemId, query) =>
      request(
        `${outcomePath(id)}/work-items/${encodeURIComponent(itemId)}/transcript${query?.before !== undefined ? `?before=${query.before}` : ""}`
      ),
  };
}

export function createScheduleApi(request: <T>(path: string, init?: RequestInit) => Promise<T>): ScheduleClient {
  return {
    list: (query) => {
      const params = new URLSearchParams({ from: query.from, to: query.to });
      for (const kind of query.kinds ?? []) params.append("kinds", kind);
      if (query.botId) params.set("botId", query.botId);
      if (query.outcomeId) params.set("outcomeId", query.outcomeId);
      if (query.mine) params.set("mine", "true");
      return request<ScheduleResponse>(`/api/schedule?${params}`);
    },
    rescheduleOutcome: async (id, field, value) => {
      const path = `/api/outcomes/${encodeURIComponent(id)}`;
      const current = await request<{ revision: number }>(path);
      return request(path, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: current.revision, clientRequestId: crypto.randomUUID(), [field]: value }),
      });
    },
  };
}
