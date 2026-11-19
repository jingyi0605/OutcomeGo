import type {
  CreateExploreIdeaInput, DiscardExploreIdeaInput, ExploreIdeaPage, ExploreIdeaView,
} from "@outcomego/contracts/explore";
export interface ExploreClient {
  list(cursor?: string): Promise<ExploreIdeaPage>;
  get(id: string): Promise<ExploreIdeaView>;
  create(input: CreateExploreIdeaInput): Promise<ExploreIdeaView>;
  discard(id: string, input: DiscardExploreIdeaInput): Promise<ExploreIdeaView>;
}
export function createExploreApi(request: <T>(path: string, init?: RequestInit) => Promise<T>): ExploreClient {
  const path = (id: string) => `/api/explore/${encodeURIComponent(id)}`;
  const post = <T>(path: string, input: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(input) });
  return {
    list: cursor => request(`/api/explore${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    get: id => request(path(id)),
    create: input => post("/api/explore", input),
    discard: (id, input) => post(`${path(id)}/discard`, input),
  };
}
