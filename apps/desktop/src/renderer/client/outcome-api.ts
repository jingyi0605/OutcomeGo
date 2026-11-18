import type {
  PlanningDraftView,
  CreateOutcomePlanInput,
  CreateOutcomeInput,
  CreateContractRevisionInput,
  ApproveContractRevisionInput,
  SubmitOutcomeReviewInput,
  OutcomeReworkInput,
  CancelOutcomeInput,
  StartOutcomeRunInput,
  OutcomeDetail,
  OutcomeListPage,
  ContractRevisionView,
  OutcomeBrief,
} from "@outcomego/contracts/outcomes";

export interface OutcomeClient {
  plan(input: CreateOutcomePlanInput): Promise<PlanningDraftView>;
  getPlan(id: string): Promise<PlanningDraftView>;
  create(input: CreateOutcomeInput): Promise<OutcomeDetail>;
  list(query?: string): Promise<OutcomeListPage>;
  get(id: string): Promise<OutcomeDetail>;
  brief?(id: string): Promise<OutcomeBrief>;
  getRevision?(id: string, revision: number): Promise<ContractRevisionView>;
  revise(id: string, input: CreateContractRevisionInput): Promise<OutcomeDetail>;
  approve(
    id: string,
    revision: number,
    input: ApproveContractRevisionInput
  ): Promise<OutcomeDetail>;
  start(id: string, input: StartOutcomeRunInput): Promise<OutcomeDetail>;
  review(id: string, input: SubmitOutcomeReviewInput): Promise<OutcomeDetail>;
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
    getRevision: (id, revision) => request(`${outcomePath(id)}/revisions/${revision}`),
    revise: (id, input) => outcomePost(`${outcomePath(id)}/revisions`, input),
    approve: (id, revision, input) =>
      outcomePost(`${outcomePath(id)}/revisions/${revision}/approve`, input),
    start: (id, input) => outcomePost(`${outcomePath(id)}/runs`, input),
    review: (id, input) => outcomePost(`${outcomePath(id)}/reviews`, input),
    rework: (id, input) => outcomePost(`${outcomePath(id)}/rework`, input),
    cancel: (id, input) => outcomePost(`${outcomePath(id)}/cancel`, input),
    transcript: (id, itemId, query) =>
      request(
        `${outcomePath(id)}/work-items/${encodeURIComponent(itemId)}/transcript${query?.before !== undefined ? `?before=${query.before}` : ""}`
      ),
  };
}
