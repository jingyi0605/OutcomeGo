import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function assertSessionPath(sessionsDir: string, input: string): string {
  const candidate = resolve(input);
  const traversal = relative(sessionsDir, candidate);
  if (traversal === "" || traversal.startsWith("..") || isAbsolute(traversal)) {
    throw new Error("Pi session path is outside the OutcomeGo session directory");
  }
  if (!candidate.endsWith(".jsonl")) throw new Error("Pi session path must be a JSONL file");
  return candidate;
}

/**
 * The file to unlink when a context session is discarded. Databases written before the session
 * root was renamed still record paths under the previous root (`sessions/openteam`), so discarding
 * accepts the whole `sessions` parent. Turn start stays strict: it never reopens a legacy path.
 */
export function disposableSessionPath(sessionsDir: string, input: string): string | null {
  const candidate = resolve(input);
  if (!candidate.endsWith(".jsonl")) return null;
  const parent = dirname(resolve(sessionsDir));
  const traversal = relative(parent, candidate);
  if (traversal === "" || traversal.startsWith("..") || isAbsolute(traversal)) return null;
  return candidate;
}

/** The context's one Pi session file on disk, which the server may not have recorded yet. */
export async function existingContextSessionPath(sessionsDir: string, contextSessionId: string): Promise<string | null> {
  if (!existsSync(sessionsDir)) return null;
  const suffix = `_${contextSessionId}.jsonl`;
  const candidates = (await readdir(sessionsDir)).filter((name) => name.endsWith(suffix));
  if (candidates.length > 1) throw new Error(`Multiple Pi sessions exist for context ${contextSessionId}`);
  return candidates[0] ? assertSessionPath(sessionsDir, join(sessionsDir, candidates[0])) : null;
}
