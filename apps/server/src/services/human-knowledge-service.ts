import { ApiError } from "@outcomego/contracts";
import {
  KnowledgeError, KNOWLEDGE_ERROR_CODES, type KnowledgeScope, type KnowledgeReference,
} from "@outcomego/contracts/knowledge";
import type { PrismaClient } from "@outcomego/db";
import type { AgentDataStore, AssetStore } from "@outcomego/messaging";
import { ProjectFileKnowledgeProvider, ProjectFileKnowledgeStore } from "./knowledge-file-provider";
import { KnowledgeScopeService } from "./knowledge-scope-service";

export interface HumanKnowledgeResolver {
  resolve(scope: KnowledgeScope, referenceIds: readonly string[]): Promise<KnowledgeReference[]>;
}

export const humanKnowledgeError = (error: unknown) => error instanceof KnowledgeError
  ? new ApiError(KNOWLEDGE_ERROR_CODES[error.code], error.code, error.message, { retryable: error.retryable })
  : error;

/** Production consumer of the scoped mounted-file/message/asset provider. */
export class HumanKnowledgeService implements HumanKnowledgeResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly agentData: Pick<AgentDataStore, "root" | "botDirectory">,
    private readonly assets: Pick<AssetStore, "metadata" | "contentPath">,
  ) {}

  private provider(scope: KnowledgeScope) {
    return new ProjectFileKnowledgeProvider(scope, new KnowledgeScopeService(this.prisma, true),
      new ProjectFileKnowledgeStore(this.prisma, scope, this.agentData, this.assets));
  }

  async scope(outcomeId: string): Promise<KnowledgeScope> {
    const outcome = await this.prisma.outcome.findUnique({ where: { id: outcomeId }, include: { currentRevision: true } });
    if (!outcome?.currentRevision) throw new ApiError(404, "outcome_not_found", "Outcome not found");
    return { outcomeId, projectScope: `bot:${outcome.botId}`, contractRevision: outcome.currentRevision.revision };
  }

  async search(outcomeId: string, input: { text: string; limit: number }) {
    try {
      const scope = await this.scope(outcomeId);
      return await this.provider(scope).search({ ...input, scope });
    } catch (error) { throw humanKnowledgeError(error); }
  }

  async read(outcomeId: string, value: unknown) {
    if (!value || typeof value !== "object") throw new ApiError(400, "invalid_request", "A knowledge reference is required");
    const reference = value as KnowledgeReference;
    if (["id", "sourceRef", "sourceType", "version", "projectScope"].some((key) => typeof (value as Record<string, unknown>)[key] !== "string") ||
        typeof reference.stale !== "boolean" || (reference.digest !== undefined && typeof reference.digest !== "string"))
      throw new ApiError(400, "invalid_request", "Invalid knowledge reference");
    try {
      const scope = await this.scope(outcomeId);
      return await this.provider(scope).read(reference);
    } catch (error) { throw humanKnowledgeError(error); }
  }

  async resolve(scope: KnowledgeScope, referenceIds: readonly string[]): Promise<KnowledgeReference[]> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const provider = this.provider(scope);
      const store = new ProjectFileKnowledgeStore(this.prisma, scope, this.agentData, this.assets);
      return await Promise.race([Promise.all([...new Set(referenceIds)].map(async (id) => {
        const source = await store.load(id, controller.signal);
        if (!source) throw new KnowledgeError("unreadable_source", "A selected source is unavailable");
        const reference: KnowledgeReference = {
          id: source.id, title: source.title, sourceType: source.sourceType, sourceRef: source.sourceRef,
          version: source.version, updatedAt: source.updatedAt, projectScope: source.projectScope,
          digest: source.digest, stale: source.stale ?? false, permissionSummary: "Available within the executing Bot scope",
        };
        const document = await provider.read(reference);
        return { ...reference, digest: document.digest, excerpt: document.text.slice(0, 500) };
      })), new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new KnowledgeError("knowledge_provider_timeout", "The selected knowledge sources timed out"));
        }, 5_000);
      })]);
    } catch (error) { throw humanKnowledgeError(error); }
    finally { clearTimeout(timer); }
  }
}
