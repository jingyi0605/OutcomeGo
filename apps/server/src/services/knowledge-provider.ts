import { createHash } from "node:crypto";
import {
  KnowledgeError, type KnowledgeDocument, type KnowledgeProvider, type KnowledgeQuery,
  type KnowledgeReference, type KnowledgeScope, type KnowledgeSourceType,
} from "@outcomego/contracts/knowledge";
import type { KnowledgeScopeResolver } from "./knowledge-scope-service";

export const knowledgeDigest = (text: string) => createHash("sha256").update(text).digest("hex");
export interface KnowledgeSource {
  id: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceRef: string;
  version: string;
  updatedAt: string;
  projectScope: string;
  excerpt?: string;
  digest?: string;
  stale?: boolean;
  read(signal: AbortSignal): Promise<string>;
}

/** Shared semantics keep fixture and project adapters under the same contract. */
export abstract class ScopedKnowledgeProvider implements KnowledgeProvider {
  constructor(
    protected readonly scope: KnowledgeScope,
    private readonly scopes: KnowledgeScopeResolver,
    private readonly timeoutMs = 5_000,
    private readonly allowFixture = false,
  ) {}

  protected abstract searchSources(query: KnowledgeQuery, signal: AbortSignal): Promise<KnowledgeSource[]>;
  protected abstract loadSource(id: string, signal: AbortSignal): Promise<KnowledgeSource | null>;

  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new KnowledgeError("knowledge_provider_timeout", "The knowledge provider timed out"));
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private permits(source: KnowledgeSource) {
    return source.projectScope === this.scope.projectScope &&
      (!this.scope.allowedSources || this.scope.allowedSources.includes(source.sourceType));
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeReference[]> {
    return this.bounded(async (signal) => {
      await this.scopes.resolve(this.scope, this.allowFixture);
      if (query.scope.projectScope !== this.scope.projectScope || query.scope.outcomeId !== this.scope.outcomeId ||
          query.scope.contractRevision !== this.scope.contractRevision)
        throw new KnowledgeError("knowledge_source_forbidden", "The query does not belong to the bound Outcome scope");
      const limit = Math.min(100, Math.max(1, Math.trunc(query.limit) || 1));
      const allowedSources = this.scope.allowedSources?.filter((sourceType) =>
        !query.scope.allowedSources || query.scope.allowedSources.includes(sourceType)
      ) ?? query.scope.allowedSources;
      if (allowedSources?.length === 0) return [];
      const sources = await this.searchSources({
        ...query, scope: { ...this.scope, allowedSources }, text: query.text.slice(0, 200), limit,
      }, signal);
      const found = new Map<string, KnowledgeReference>();
      for (const source of sources) {
        if (!this.permits(source) || (allowedSources && !allowedSources.includes(source.sourceType))) continue;
        const key = `${source.sourceType}:${source.sourceRef}`;
        const reference: KnowledgeReference = {
          id: source.id, title: source.title, sourceType: source.sourceType, sourceRef: source.sourceRef,
          version: source.version, updatedAt: source.updatedAt, projectScope: source.projectScope,
          excerpt: source.excerpt?.slice(0, 500), digest: source.digest,
          stale: source.stale ?? false, permissionSummary: "Available within the executing Bot scope",
        };
        const previous = found.get(key);
        if (!previous || reference.updatedAt > previous.updatedAt) found.set(key, reference);
      }
      return [...found.values()].slice(0, limit);
    });
  }

  async read(reference: KnowledgeReference): Promise<KnowledgeDocument> {
    return this.bounded(async (signal) => {
      await this.scopes.resolve(this.scope, this.allowFixture);
      if (reference.projectScope !== this.scope.projectScope)
        throw new KnowledgeError("knowledge_source_forbidden", "The reference belongs to another project");
      const source = await this.loadSource(reference.id, signal);
      if (!source) throw new KnowledgeError("unreadable_source", "The source is no longer available");
      if (!this.permits(source) || source.sourceRef !== reference.sourceRef || source.sourceType !== reference.sourceType)
        throw new KnowledgeError("knowledge_source_forbidden", "The reference is outside the permitted source scope");
      if (source.stale || reference.stale || source.version !== reference.version)
        throw new KnowledgeError("knowledge_source_stale", "The source version has changed");
      const text = await source.read(signal);
      if (signal.aborted) throw new KnowledgeError("knowledge_provider_timeout", "The knowledge provider timed out");
      const digest = knowledgeDigest(text);
      if ((reference.digest && reference.digest !== digest) || (source.digest && source.digest !== digest))
        throw new KnowledgeError("knowledge_source_stale", "The source digest has changed");
      return { text, digest };
    });
  }
}
