import type { HumanReceiptInput, HumanReceiptView } from "@outcomego/contracts/human-work";
import type { KnowledgeDocument, KnowledgeReference } from "@outcomego/contracts/knowledge";

export interface HumanMaterialClient {
  receipt(workItemId: string, input: HumanReceiptInput): Promise<HumanReceiptView>;
  search(outcomeId: string, text: string): Promise<KnowledgeReference[]>;
  read(outcomeId: string, reference: KnowledgeReference): Promise<KnowledgeDocument>;
}
export function createHumanMaterialApi(request: <T>(path: string, init?: RequestInit) => Promise<T>): HumanMaterialClient {
  const post = <T>(path: string, input: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(input) });
  return {
    receipt: (id, input) => post(`/api/work-items/${encodeURIComponent(id)}/receipts`, input),
    search: (id, text) => post(`/api/outcomes/${encodeURIComponent(id)}/knowledge/search`, { text, limit: 20 }),
    read: (id, reference) => post(`/api/outcomes/${encodeURIComponent(id)}/knowledge/read`, { reference }),
  };
}
