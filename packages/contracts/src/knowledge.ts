export const KNOWLEDGE_ERROR_CODES = {
  knowledge_scope_required: 400,
  knowledge_source_forbidden: 403,
  knowledge_source_stale: 409,
  unreadable_source: 422,
  knowledge_provider_timeout: 504,
} as const;

export type KnowledgeErrorCode = keyof typeof KNOWLEDGE_ERROR_CODES;
export class KnowledgeError extends Error {
  readonly retryable: boolean;
  constructor(readonly code: KnowledgeErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeError";
    this.retryable = code === "knowledge_provider_timeout";
  }
  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export interface KnowledgeScope {
  projectScope: string;
  outcomeId: string;
  contractRevision: number;
  allowedSources?: readonly KnowledgeSourceType[];
}
export type KnowledgeSourceType = "file" | "message" | "url" | "fixture";
export interface KnowledgeQuery {
  text: string;
  scope: KnowledgeScope;
  limit: number;
}
export interface KnowledgeReference {
  id: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceRef: string;
  version: string;
  updatedAt: string;
  projectScope: string;
  excerpt?: string;
  digest?: string;
  stale: boolean;
  permissionSummary: string;
}
export interface KnowledgeDocument {
  text: string;
  digest: string;
}
export interface KnowledgeProvider {
  search(query: KnowledgeQuery): Promise<KnowledgeReference[]>;
  read(reference: KnowledgeReference): Promise<KnowledgeDocument>;
}
