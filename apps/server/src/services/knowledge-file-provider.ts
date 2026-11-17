import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { protectedAgentDataPath } from "@outcomego/contracts/agent-file-access";
import { KnowledgeError, type KnowledgeQuery, type KnowledgeScope } from "@outcomego/contracts/knowledge";
import { Prisma, type PrismaClient } from "@outcomego/db";
import type { AgentDataStore, AssetStore } from "@outcomego/messaging";
import { knowledgeDigest, type KnowledgeSource, ScopedKnowledgeProvider } from "./knowledge-provider";
import { KnowledgeScopeService, type KnowledgeScopeResolver } from "./knowledge-scope-service";
import { prefixTsQuery } from "./search-service";

const MAX_TEXT_BYTES = 1_000_000;
const NON_TEXT_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".gz", ".docx", ".xlsx", ".pptx", ".mp4", ".mp3", ".wav", ".db", ".sqlite"]);
const within = (root: string, path: string) => {
  const suffix = relative(root, path);
  return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
};

/** Bounded, read-only text extraction; the returned digest covers the actual bytes. */
const readTextFile = async (path: string, signal: AbortSignal): Promise<string> => {
  let handle;
  try {
    if (signal.aborted) throw new KnowledgeError("knowledge_provider_timeout", "The knowledge provider timed out");
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_TEXT_BYTES)
      throw new KnowledgeError("unreadable_source", "Only bounded regular text files can be read");
    const bytes = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let total = 0;
    while (total < bytes.length) {
      if (signal.aborted) throw new KnowledgeError("knowledge_provider_timeout", "The knowledge provider timed out");
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new KnowledgeError("knowledge_source_stale", "The source changed during reading");
    if (total > MAX_TEXT_BYTES || bytes.subarray(0, total).includes(0))
      throw new KnowledgeError("unreadable_source", "This source is not a supported text document");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, total));
  } catch (error) {
    if (error instanceof KnowledgeError) throw error;
    throw new KnowledgeError("unreadable_source", "The source cannot be read as UTF-8 text");
  } finally {
    await handle?.close();
  }
};

type SearchRow = {
  id: string; kind: string; messageId: string; title: string;
};
type FileRow = Prisma.AgentFileStateGetPayload<Record<string, never>>;
type MessageRow = Prisma.ChannelMessageGetPayload<Record<string, never>>;

export interface ProjectKnowledgeStore {
  search(query: KnowledgeQuery, signal: AbortSignal): Promise<KnowledgeSource[]>;
  load(id: string, signal: AbortSignal): Promise<KnowledgeSource | null>;
}

/** Scope predicates apply before SQL candidate limits. The index never authorizes a read. */
export class ProjectFileKnowledgeStore implements ProjectKnowledgeStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scope: KnowledgeScope,
    private readonly agentData: Pick<AgentDataStore, "root" | "botDirectory">,
    private readonly assets: Pick<AssetStore, "metadata" | "contentPath">,
  ) {}
  private get botId() { return this.scope.projectScope.slice("bot:".length); }

  async search(query: KnowledgeQuery, signal: AbortSignal) {
    const tsQuery = prefixTsQuery(query.text);
    const rows = await this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT document."id", document."kind", document."messageId", document."title"
      FROM "outcomego_search_document" AS document
      JOIN "outcomego_channel" AS channel ON channel."id" = document."channelId"
      WHERE document."kind" IN ('file', 'message') AND channel."archivedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "outcomego_channel_member" AS member
          WHERE member."channelId" = channel."id" AND member."botId" = ${this.botId}::uuid
        )
        ${tsQuery ? Prisma.sql`AND (
          document."searchVector" @@ to_tsquery('simple', ${tsQuery})
          OR (document."searchVector" IS NULL AND
            to_tsvector('simple', concat_ws(' ', document."title", document."subtitle", document."content"))
              @@ to_tsquery('simple', ${tsQuery}))
        )` : Prisma.empty}
      ORDER BY document."updatedAt" DESC, document."id" ASC LIMIT ${query.limit}
    `);
    const fileRows = await this.prisma.agentFileState.findMany({
      where: { botId: this.botId, exists: true, error: null, path: { contains: query.text, mode: "insensitive" } },
      orderBy: [{ updatedAt: "desc" }, { path: "asc" }], take: query.limit,
    });
    const sources: KnowledgeSource[] = [];
    for (const file of fileRows) {
      if (this.safeTrackedPath(file.path)) sources.push(this.fileSource(file));
    }
    for (const row of rows) {
      const source = await this.load(row.id, signal);
      if (source) sources.push(source);
    }
    return sources;
  }

  async load(id: string, _signal: AbortSignal): Promise<KnowledgeSource | null> {
    if (id.startsWith("agent-file:")) {
      const file = await this.prisma.agentFileState.findUnique({ where: { path: id.slice("agent-file:".length) } });
      if (!file) return null;
      if (file.botId !== this.botId || !this.safeTrackedPath(file.path))
        throw new KnowledgeError("knowledge_source_forbidden", "The tracked file belongs to another scope or protected state");
      return this.fileSource(file);
    }
    const match = /^(message|file):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(\d+))?$/.exec(id);
    if (!match?.[2] || (match[1] === "file" && match[3] === undefined)) return null;
    const message = await this.prisma.channelMessage.findFirst({
      where: {
        id: match[2], channel: { archivedAt: null, members: { some: { botId: this.botId } } },
      },
    });
    if (!message) throw new KnowledgeError("knowledge_source_forbidden", "The source message is outside this Bot's channels");
    return match[1] === "message" ? this.messageSource(message) : this.attachmentSource(message, Number(match[3]));
  }

  private safeTrackedPath(path: string) {
    const root = resolve(this.agentData.root);
    const botRoot = resolve(this.agentData.botDirectory(this.botId));
    return isAbsolute(path) && within(botRoot, resolve(path)) &&
      !protectedAgentDataPath(relative(root, resolve(path)).split(sep).join("/"));
  }

  private fileSource(file: FileRow): KnowledgeSource {
    const id = `agent-file:${file.path}`;
    return {
      id, title: basename(file.path), sourceType: "file", sourceRef: id,
      version: `${file.generation}:${file.digest ?? "unknown"}`, digest: file.digest ?? undefined,
      updatedAt: file.updatedAt.toISOString(), projectScope: this.scope.projectScope,
      read: async (signal) => {
        if (!file.exists || file.error) throw new KnowledgeError("unreadable_source", "The tracked source is unavailable");
        if (NON_TEXT_EXTENSIONS.has(extname(file.path).toLowerCase()))
          throw new KnowledgeError("unreadable_source", "This file requires a text version");
        try {
          const root = await realpath(this.agentData.root);
          const botRoot = await realpath(this.agentData.botDirectory(this.botId));
          const path = await realpath(file.path);
          if (!within(root, botRoot) || !within(botRoot, path) ||
              protectedAgentDataPath(relative(root, path).split(sep).join("/")))
            throw new KnowledgeError("knowledge_source_forbidden", "The source resolves outside this Bot's allowed files");
          if ((await lstat(file.path)).isSymbolicLink())
            throw new KnowledgeError("knowledge_source_forbidden", "Tracked symlinks are not readable sources");
          return await readTextFile(path, signal);
        } catch (error) {
          if (error instanceof KnowledgeError) throw error;
          throw new KnowledgeError("unreadable_source", "The shared source mount or file is unavailable");
        }
      },
    };
  }

  private messageSource(message: MessageRow): KnowledgeSource {
    const id = `message:${message.id}`;
    return {
      id, title: message.content.slice(0, 100), sourceType: "message", sourceRef: id,
      version: `${message.sequence}:${message.createdAt.toISOString()}:${knowledgeDigest(message.content)}`,
      digest: knowledgeDigest(message.content), updatedAt: message.createdAt.toISOString(),
      projectScope: this.scope.projectScope, excerpt: message.content.slice(0, 500),
      read: async () => message.content,
    };
  }

  private attachmentSource(message: MessageRow, index: number): KnowledgeSource | null {
    const metadata = message.metadata as { attachments?: Array<{ assetId?: string; fileName?: string; mimeType?: string }> } | null;
    const attachment = Array.isArray(metadata?.attachments) ? metadata.attachments[index] : undefined;
    if (!attachment?.assetId || !/^[a-f0-9]{64}$/.test(attachment.assetId)) return null;
    const assetId = attachment.assetId;
    const id = `file:${message.id}:${index}`;
    return {
      id, title: attachment.fileName ?? "Attachment", sourceType: "file",
      // Include linkage so the same asset cannot bypass its permitted message.
      sourceRef: `${id}:asset:${assetId}`, version: `${message.sequence}:${assetId}`,
      digest: assetId, updatedAt: message.createdAt.toISOString(), projectScope: this.scope.projectScope,
      read: async (signal) => {
        try {
          const asset = await this.assets.metadata(assetId);
          if (!/^(text\/|application\/(?:json|xml)(?:;|$))/.test(asset.mimeType) || asset.byteSize > MAX_TEXT_BYTES)
            throw new KnowledgeError("unreadable_source", "This attachment requires a text version");
          return await readTextFile(this.assets.contentPath(assetId), signal);
        } catch (error) {
          if (error instanceof KnowledgeError) throw error;
          throw new KnowledgeError("unreadable_source", "The linked attachment is unavailable");
        }
      },
    };
  }
}

export class ProjectFileKnowledgeProvider extends ScopedKnowledgeProvider {
  constructor(scope: KnowledgeScope, scopes: KnowledgeScopeResolver, private readonly store: ProjectKnowledgeStore, timeoutMs?: number) {
    super(scope, scopes, timeoutMs);
  }
  protected searchSources(query: KnowledgeQuery, signal: AbortSignal) { return this.store.search(query, signal); }
  protected loadSource(id: string, signal: AbortSignal) { return this.store.load(id, signal); }
}

/** Production assembly uses the existing shared mount and content-addressed AssetStore. */
export const createProjectFileKnowledgeProvider = (
  prisma: PrismaClient, scope: KnowledgeScope,
  agentData: Pick<AgentDataStore, "root" | "botDirectory">,
  assets: Pick<AssetStore, "metadata" | "contentPath">,
) => new ProjectFileKnowledgeProvider(scope, new KnowledgeScopeService(prisma), new ProjectFileKnowledgeStore(prisma, scope, agentData, assets));
