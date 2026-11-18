import { z } from "zod";
import type { KnowledgeReference } from "./knowledge";
import type { HumanWorkItemStatus, WorkItemExecutorType, WorkItemKind, WorkItemStatus } from "./outcomes";

export const HUMAN_WORK_ERROR_CODES = {
  human_work_item_not_active: 409,
  review_revision_conflict: 409,
  receipt_idempotency_conflict: 409,
  human_evidence_missing: 422,
  receipt_asset_not_found: 404,
  receipt_asset_conflict: 409,
} as const;

export const humanWorkMutationSchema = z.object({
  clientRequestId: z.string().trim().min(1).max(200),
  expectedContractRevision: z.number().int().positive(),
}).strict();

export const humanWorkPauseSchema = humanWorkMutationSchema.extend({
  currentStepId: z.string().max(100).nullable(),
  draftSummary: z.string().max(2_000),
  readReferenceIds: z.array(z.string().min(1).max(500)).max(100),
  reason: z.string().trim().min(1).max(1_000),
}).strict();

export const humanActionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(4_000),
  steps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(20),
  evidenceRequirements: z.array(z.object({
    criterionOrdinal: z.number().int().positive(),
    label: z.string().trim().min(1).max(500),
    kind: z.enum(["text", "asset", "sourceReference", "observation"]),
  }).strict()).min(1).max(100),
  referenceIds: z.array(z.string().min(1).max(500)).max(100).optional(),
}).strict();

export type HumanWorkMutation = z.infer<typeof humanWorkMutationSchema>;
export type HumanWorkPause = z.infer<typeof humanWorkPauseSchema>;
export type HumanActionInput = z.infer<typeof humanActionInputSchema>;
export const humanReceiptSchema = humanWorkMutationSchema.extend({
  comment: z.string().max(4_000).default(""),
  text: z.string().max(12_000).default(""),
  assetRefs: z.array(z.string().regex(/^asset:[a-f0-9]{64}$/)).max(20).default([]),
  sourceRefs: z.array(z.object({
    type: z.enum(["knowledge", "external"]),
    ref: z.string().trim().min(1).max(4_096),
  }).strict()).max(100).default([]),
  observations: z.array(z.object({
    criterionId: z.string().uuid(),
    result: z.literal("observed"),
    value: z.string().trim().min(1).max(4_000),
  }).strict()).max(100).default([]),
}).strict();
export type HumanReceiptInput = z.infer<typeof humanReceiptSchema>;
export type HumanMaterialKind = HumanActionInput["evidenceRequirements"][number]["kind"];
export interface HumanEvidenceGap {
  criterionId: string;
  kind: HumanMaterialKind;
  label: string;
}
export interface HumanReceiptView {
  id: string;
  workItemId: string;
  outcomeId: string;
  sequence: number;
  status: "submitted" | "accepted" | "rejected";
  submittedBy: string;
  submittedAt: string;
  reviewComment: string | null;
  payload: HumanReceiptInput;
  evidenceIds: string[];
  missingRequirements: HumanEvidenceGap[];
}

export const humanKnowledgeSearchSchema = z.object({
  text: z.string().max(200),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

/** Registered only in Outcome sub-threads; a successful call ends the current turn. */
export const REQUEST_HUMAN_ACTION_TOOL = {
  name: "RequestHumanAction",
  description: "Request a human to perform real-world steps and submit evidence. Creates an action card under this Outcome's approved Contract, then ends this turn until the receipt is accepted. Steps are instructions for a person, not automated commands.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      purpose: { type: "string", minLength: 1, maxLength: 4_000 },
      steps: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 2_000 } },
      evidenceRequirements: {
        type: "array", minItems: 1, maxItems: 100,
        items: {
          type: "object", additionalProperties: false,
          properties: {
            criterionOrdinal: { type: "integer", minimum: 1 },
            label: { type: "string", minLength: 1, maxLength: 500 },
            kind: { type: "string", enum: ["text", "asset", "sourceReference", "observation"] },
          },
          required: ["criterionOrdinal", "label", "kind"],
        },
      },
      referenceIds: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 500 } },
    },
    required: ["title", "purpose", "steps", "evidenceRequirements"],
  },
} as const;
export interface HumanActionCardView {
  id: string;
  workItemId: string;
  outcomeId: string;
  contractRevision: number;
  title: string;
  purpose: string;
  prerequisites: Array<{ label: string; completed: boolean }>;
  steps: Array<{ id: string; ordinal: number; text: string; optional: boolean }>;
  inputFields: Array<{
    id: string; label: string; type: "text" | "number" | "boolean" | "selection" | "asset"; required: boolean;
  }>;
  evidenceRequirements: Array<{ criterionId: string; label: string; acceptedTypes: string[]; required: boolean }>;
  references: KnowledgeReference[];
  status: HumanWorkItemStatus;
  draft: Omit<HumanWorkPause, keyof HumanWorkMutation> | null;
  startedBy: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
}
export interface HumanWorkItemView {
  id: string;
  outcomeId: string;
  executorType: WorkItemExecutorType;
  kind: WorkItemKind;
  status: WorkItemStatus;
  title: string;
  contractRevision: number;
  runId?: string;
  humanActionCardId?: string;
  evidenceCount: number;
  nextAction?: string;
  startedAt: string | null;
}
export interface HumanWorkItemDetail extends HumanWorkItemView {
  card: HumanActionCardView | null;
  receipts?: HumanReceiptView[];
}
