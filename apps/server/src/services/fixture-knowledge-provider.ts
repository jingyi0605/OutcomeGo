import { KnowledgeError, type KnowledgeQuery, type KnowledgeScope } from "@outcomego/contracts/knowledge";
import { knowledgeDigest, type KnowledgeSource, ScopedKnowledgeProvider } from "./knowledge-provider";
import type { KnowledgeScopeResolver } from "./knowledge-scope-service";

export interface FixtureKnowledgeEntry {
  id: string;
  title: string;
  text: string;
  projectScope: string;
  version: string;
  updatedAt: string;
  stale?: boolean;
  fault?: "timeout" | "forbidden" | "unreadable";
}

/** Explicit test dependency only; no production registry enables this provider. */
export class FixtureKnowledgeProvider extends ScopedKnowledgeProvider {
  constructor(scope: KnowledgeScope, scopes: KnowledgeScopeResolver, private readonly entries: readonly FixtureKnowledgeEntry[], timeoutMs?: number) {
    super(scope, scopes, timeoutMs, true);
  }
  private source(entry: FixtureKnowledgeEntry): KnowledgeSource {
    return {
      ...entry, sourceType: "fixture", sourceRef: entry.id, digest: knowledgeDigest(entry.text),
      excerpt: entry.text.slice(0, 500),
      read: async () => {
        if (entry.fault === "timeout") return new Promise<string>(() => {});
        if (entry.fault === "forbidden") throw new KnowledgeError("knowledge_source_forbidden", "Fixture source is forbidden");
        if (entry.fault === "unreadable") throw new KnowledgeError("unreadable_source", "Fixture source is unreadable");
        return entry.text;
      },
    };
  }
  protected async searchSources(query: KnowledgeQuery) {
    return this.entries.filter((entry) =>
      `${entry.title} ${entry.text}`.toLowerCase().includes(query.text.toLowerCase())
    ).map((entry) => this.source(entry));
  }
  protected async loadSource(id: string) {
    const entry = this.entries.find((candidate) => candidate.id === id);
    return entry ? this.source(entry) : null;
  }
}
