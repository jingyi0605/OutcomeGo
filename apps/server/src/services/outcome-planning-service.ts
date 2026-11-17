import { ApiError } from "@outcomego/contracts";
import {
  OUTCOME_LIMITS, OUTCOME_PLANNING_DIMENSIONS, planningOptionId,
  type CreateOutcomePlanInput, type PlanningDraftView, type PlanningOption,
} from "@outcomego/contracts/outcomes";
import type { PrismaClient, OutcomePlanningDraft } from "@outcomego/db";
import type { OutcomeInference } from "./outcome-inference";
import { outcomeApiError } from "./outcome-service";
import { outcomeWrite } from "./outcome-write";
import { hashRequest, serviceEffect, toJson } from "./service-utils";

const INSTRUCTIONS = `Generate planning suggestions, not an execution. Return only JSON:
{"goal":[{"text":"...","recommended":true,"reason":"..."}],"acceptance":[{"text":"...","required":true}],"boundaries":[{"text":"...","kind":"included"}],"questions":[]}.
Each dimension has at most four options; each option text at most 500 characters. Recommend only with a reason grounded in the request. Ask questions only for missing information. Never execute tools.`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Model IDs and selections are discarded; the saved snapshot is the sole source of option IDs and text. */
export function parsePlanningGeneration(text: string): Pick<PlanningDraftView, "goal" | "acceptance" | "boundaries" | "conflicts"> {
  const parsed = record(JSON.parse(text));
  const dimensions = {} as Pick<PlanningDraftView, "goal" | "acceptance" | "boundaries">;
  for (const dimension of OUTCOME_PLANNING_DIMENSIONS) {
    if (!Array.isArray(parsed[dimension])) throw new Error(`Missing ${dimension} options`);
    const options: PlanningOption[] = (parsed[dimension] as unknown[]).map(record)
      .filter(option => typeof option.text === "string" && option.text.trim()).slice(0, OUTCOME_LIMITS.optionsPerDimension)
      .map((option, index) => {
        const reason = typeof option.reason === "string" ? option.reason.trim().slice(0, 500) : "";
        return { id: planningOptionId(dimension, index), text: (option.text as string).trim().slice(0, 500),
          ...(option.recommended === true && reason ? { recommended: true, reason } : {}),
          ...(dimension === "acceptance" ? { required: option.required !== false } : {}),
          ...(dimension === "boundaries" ? { kind: option.kind === "excluded" ? "excluded" as const : "included" as const } : {}),
        };
      });
    dimensions[dimension] = { options, selectedOptionIds: [], customEntries: [] };
  }
  if (!dimensions.goal.options.length || !dimensions.acceptance.options.length)
    throw new Error("Planning needs goal and acceptance suggestions");
  const questions = Array.isArray(parsed.questions) ? parsed.questions.filter((q): q is string => typeof q === "string" && !!q.trim()).slice(0, 8) : [];
  return { ...dimensions, conflicts: questions.map(message => ({ code: "ambiguous_scope", severity: "informational", dimensions: [...OUTCOME_PLANNING_DIMENSIONS], message: message.trim().slice(0, 500) })) };
}

export class OutcomePlanningService {
  constructor(private readonly prisma: PrismaClient, private readonly infer: OutcomeInference) {}

  create = (input: CreateOutcomePlanInput) => serviceEffect(async signal => {
    if (!input.sourceText.trim() || input.sourceText.length > OUTCOME_LIMITS.sourceTextChars)
      throw new ApiError(400, "invalid_request", "A nonempty task description is required");
    const scope = "outcome-plan", key = input.clientRequestId;
    const previous = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    let generated: ReturnType<typeof parsePlanningGeneration> | undefined;
    let failed = false;
    if (!previous) {
      const bot = await this.prisma.bot.findUnique({ where: { id: input.context.botId }, select: { name: true } });
      if (!bot) throw outcomeApiError("bot_not_runnable", "Choose an existing Bot");
      for (let attempt = 0; attempt < 2; attempt++) {
        let text: string;
        try { text = (await this.infer({ kind: "planning", instructions: INSTRUCTIONS, prompt: JSON.stringify({ task: input.sourceText, bot: bot.name }) }, signal)).text; }
        catch { failed = true; break; }
        try { generated = parsePlanningGeneration(text); break; }
        catch { failed = true; }
      }
    } else if (previous.requestHash !== hashRequest(input)) {
      throw outcomeApiError("idempotency_conflict", "This request ID was already used for a different request");
    }
    const view = await outcomeWrite(this.prisma, scope, key, input, async tx => {
      const empty = { options: [], selectedOptionIds: [], customEntries: [] };
      const snapshot = generated ?? { goal: empty, acceptance: empty, boundaries: empty, conflicts: [] };
      const row = await tx.outcomePlanningDraft.create({ data: {
        botId: input.context.botId, sourceText: input.sourceText.trim(), status: generated ? "ready" : "failed",
        snapshot: toJson(snapshot), expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        ...(!generated && failed ? { error: { code: "planning_generation_failed", retryable: true } } : {}),
      } });
      return this.view(row);
    });
    if (view.status === "failed") throw outcomeApiError("planning_generation_failed", "Planning could not be generated; retry with a new request ID", { retryable: true, planId: view.planId });
    return view;
  });

  get = (planId: string) => serviceEffect(async () => {
    const row = await this.prisma.outcomePlanningDraft.findUnique({ where: { id: planId } });
    if (!row) throw outcomeApiError("planning_draft_not_found", "Planning draft not found");
    return this.view(row);
  });

  pruneExpired = () => this.prisma.outcomePlanningDraft.deleteMany({ where: { expiresAt: { lte: new Date() } } });

  private view(row: OutcomePlanningDraft): PlanningDraftView {
    return { ...(row.snapshot as unknown as Pick<PlanningDraftView, "goal" | "acceptance" | "boundaries" | "conflicts">),
      planId: row.id, sourceText: row.sourceText, botId: row.botId,
      status: row.expiresAt <= new Date() ? "expired" : row.status,
      generatedAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      ...(row.error ? { error: row.error as unknown as PlanningDraftView["error"] } : {}),
    };
  }
}
