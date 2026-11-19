import type {
  DecisionResolution, DecisionView, OutcomeInboxCategory, OutcomeInboxPage, ResolveDecisionInput,
} from "@outcomego/contracts/outcome-inbox";
import type { HumanWorkItemDetail, HumanWorkItemView, HumanWorkMutation, HumanWorkPause } from "@outcomego/contracts/human-work";

export interface InboxClient {
  list(query?: { status?: "pending" | "completed" | "all"; category?: OutcomeInboxCategory; cursor?: string }): Promise<OutcomeInboxPage>;
  forOutcome(outcomeId: string): Promise<OutcomeInboxPage>;
  decision(id: string): Promise<DecisionView>;
  resolve(id: string, input: ResolveDecisionInput): Promise<DecisionResolution>;
  humanItems(outcomeId: string): Promise<HumanWorkItemView[]>;
  humanItem(id: string): Promise<HumanWorkItemDetail>;
  startHuman(id: string, input: HumanWorkMutation): Promise<HumanWorkItemDetail>;
  pauseHuman(id: string, input: HumanWorkPause): Promise<HumanWorkItemDetail>;
}

export function createInboxApi(request: <T>(path: string, init?: RequestInit) => Promise<T>): InboxClient {
  const post = <T>(path: string, input: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(input) });
  const itemPath = (id: string) => `/api/work-items/${encodeURIComponent(id)}`;
  return {
    list: (query = {}) => {
      const params = new URLSearchParams({ status: query.status ?? "pending" });
      if (query.category) params.set("category", query.category);
      if (query.cursor) params.set("cursor", query.cursor);
      return request(`/api/outcome-inbox?${params}`);
    },
    forOutcome: id => request(`/api/outcomes/${encodeURIComponent(id)}/inbox`),
    decision: id => request(`/api/decisions/${encodeURIComponent(id)}`),
    resolve: (id, input) => post(`/api/decisions/${encodeURIComponent(id)}/resolve`, input),
    humanItems: id => request(`/api/outcomes/${encodeURIComponent(id)}/work-items?executorType=human`),
    humanItem: id => request(itemPath(id)),
    startHuman: (id, input) => post(`${itemPath(id)}/start`, input),
    pauseHuman: (id, input) => post(`${itemPath(id)}/pause`, input),
  };
}
