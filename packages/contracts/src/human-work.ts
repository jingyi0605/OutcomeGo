import { z } from "zod";
import type { KnowledgeReference } from "./knowledge";
import type { HumanWorkItemStatus, WorkItemExecutorType, WorkItemKind, WorkItemStatus } from "./outcomes";

export const HUMAN_WORK_ERROR_CODES = {
  human_work_item_not_active: 409,
  review_revision_conflict: 409,
  receipt_idempotency_conflict: 409,
  human_evidence_missing: 422,
  receipt_asset_not_found: 404,
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
}
