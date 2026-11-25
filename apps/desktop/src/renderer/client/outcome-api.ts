import type { ActivityResponse, NeedsMeResponse, ScheduleQuery, ScheduleResponse } from "@outcomego/contracts/task-overview";
import { createTodoApi, type TodoClient } from "./todo-api";
import type {
  PlanningDraftView,
  CreateOutcomePlanInput,
  CreateOutcomeInput,
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

import type {
  CreateOutcomeThreadInput,
  OutcomeThreadTurnView,
  OutcomeThreadView,
  SendOutcomeThreadMessageInput,
} from "@outcomego/contracts/outcome-thread";

export interface OutcomeClient {
  plan(input: CreateOutcomePlanInput): Promise<PlanningDraftView>;
  getPlan(id: string): Promise<PlanningDraftView>;
  create(input: CreateOutcomeInput): Promise<OutcomeDetail>;
  list(query?: string): Promise<OutcomeListPage>;
  get(id: string): Promise<OutcomeDetail>;
  brief?(id: string): Promise<OutcomeBrief>;
  resultSummary?(id: string, revision: number): Promise<OutcomeResultSummary | null>;
  getRevision?(id: string, revision: number): Promise<ContractRevisionView>;
  revise(id: string, input: CreateContractRevisionInput): Promise<OutcomeDetail>;
  /** The goal's own Agent thread: the owner's words and the bot's answers. */
  thread?(id: string): Promise<OutcomeThreadView>;
  /** The owner's words, delivered to the bot as written; the server answers at once. */
  sendThreadMessage?(id: string, input: SendOutcomeThreadMessageInput): Promise<OutcomeThreadTurnView>;
  /** A new goal in the owner's own words, planned by the chosen bot. */
  createThread?(input: CreateOutcomeThreadInput): Promise<{ outcome: OutcomeDetail; turn: OutcomeThreadTurnView }>;
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
  todos?: TodoClient;
  workThreads?(botId: string, query: { archived?: boolean; cursor?: string; signal?: AbortSignal }): Promise<OutcomeWorkThreadPage>;
  transcript(id: string, itemId: string, query?: { before?: number }): Promise<unknown>;
}

export interface ScheduleClient {
  list(query: ScheduleQuery): Promise<ScheduleResponse>;
  rescheduleTodo(id: string, field: "scheduledAt" | "dueAt", value: string): Promise<unknown>;
}

export function createOutcomeApi(
  request: <T>(path: string, init?: RequestInit) => Promise<T>
): OutcomeClient {
  const outcomePath = (id: string) => `/api/outcomes/${encodeURIComponent(id)}`;
  const outcomePost = <T>(path: string, input: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(input) });
  const outcomePut = <T>(path: string, input: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(input) });
  return {
    plan: (input) => outcomePost("/api/outcomes/plans", input),
    getPlan: (id) => request(`/api/outcomes/plans/${encodeURIComponent(id)}`),
    create: (input) => outcomePost("/api/outcomes", input),
    list: (query = "") => request(`/api/outcomes${query ? `?${query}` : ""}`),
    get: (id) => request(outcomePath(id)),
    brief: (id) => request(`${outcomePath(id)}/brief`),
    resultSummary: (id, revision) => request(`${outcomePath(id)}/revisions/${revision}/results-summary`),
    getRevision: (id, revision) => request(`${outcomePath(id)}/revisions/${revision}`),
    revise: (id, input) => outcomePost(`${outcomePath(id)}/revisions`, input),
    thread: (id) => request(`${outcomePath(id)}/thread`),
    sendThreadMessage: (id, input) => outcomePost(`${outcomePath(id)}/thread/messages`, input),
    createThread: (input) => outcomePost("/api/outcomes/threads", input),
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
    todos: createTodoApi(request),
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
    rescheduleTodo: async (id, field, value) => {
      const current = await request<{ revision: number }>(`/api/todos/${encodeURIComponent(id)}`);
      return request(`/api/todos/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ revision: current.revision, [field]: value }),
      });
    },
  };
}
