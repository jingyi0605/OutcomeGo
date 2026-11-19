import type {
  PlanningDraftView,
  CreateOutcomePlanInput,
  CreateOutcomeInput,
  CreateContractRevisionInput,
  ApproveContractRevisionInput,
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
  decideAcceptance?(id: string, input: DecideOutcomeAcceptanceInput): Promise<OutcomeDetail>;
  rework(id: string, input: OutcomeReworkInput): Promise<OutcomeDetail>;
  cancel(id: string, input: CancelOutcomeInput): Promise<OutcomeDetail>;
  transcript(id: string, itemId: string, query?: { before?: number }): Promise<unknown>;
}

export function createOutcomeApi(
  request: <T>(path: string, init?: RequestInit) => Promise<T>
): OutcomeClient {
  const outcomePath = (id: string) => `/api/outcomes/${encodeURIComponent(id)}`;
  const outcomePost = <T>(path: string, input: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(input) });
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
    decideAcceptance: (id, input) => outcomePost(`${outcomePath(id)}/acceptance`, input),
    rework: (id, input) => outcomePost(`${outcomePath(id)}/rework`, input),
    cancel: (id, input) => outcomePost(`${outcomePath(id)}/cancel`, input),
    transcript: (id, itemId, query) =>
      request(
        `${outcomePath(id)}/work-items/${encodeURIComponent(itemId)}/transcript${query?.before !== undefined ? `?before=${query.before}` : ""}`
      ),
  };
}
