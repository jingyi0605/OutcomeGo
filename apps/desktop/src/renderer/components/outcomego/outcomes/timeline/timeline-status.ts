import type { WorkItemDisplayState } from "@outcomego/contracts/task-overview";

/**
 * How each task display state is shown on the timeline. A state is always expressed three ways (words, an icon
 * and a tone) so it is never carried by color alone. Labels are English source strings for the i18n catalog.
 * Only "running" may animate, and the stylesheet turns that off for reduced motion.
 */
export type TimelineTone = "action" | "review" | "plan" | "pass" | "fail" | "muted";

export interface TimelineStatusStyle {
  label: string;
  icon: string;
  tone: TimelineTone;
  animated: boolean;
}

// Typed as a full Record so a new display state cannot be added without deciding how it looks.
export const TIMELINE_STATUS: Record<WorkItemDisplayState, TimelineStatusStyle> = {
  queued: { label: "Queued", icon: "◌", tone: "muted", animated: false },
  waiting_dependency: { label: "Waiting for earlier tasks", icon: "⧗", tone: "muted", animated: false },
  scheduled: { label: "Scheduled", icon: "◷", tone: "plan", animated: false },
  deferred: { label: "Deferred", icon: "⏸", tone: "plan", animated: false },
  missed_schedule: { label: "Missed schedule", icon: "!", tone: "action", animated: false },
  running: { label: "Running", icon: "▶", tone: "review", animated: true },
  waiting_decision: { label: "Waiting for a decision", icon: "?", tone: "action", animated: false },
  waiting_human: { label: "Waiting for a person", icon: "☝", tone: "action", animated: false },
  retry_pending: { label: "Retrying", icon: "↻", tone: "action", animated: false },
  needs_review: { label: "Needs review", icon: "◎", tone: "review", animated: false },
  completed: { label: "Completed", icon: "✓", tone: "pass", animated: false },
  failed: { label: "Failed", icon: "✕", tone: "fail", animated: false },
  cancelled: { label: "Cancelled", icon: "–", tone: "muted", animated: false },
  pending: { label: "Not started", icon: "◌", tone: "muted", animated: false },
  ready: { label: "Ready", icon: "◌", tone: "plan", animated: false },
  in_progress: { label: "In progress", icon: "▶", tone: "review", animated: true },
  paused: { label: "Paused", icon: "⏸", tone: "muted", animated: false },
  submitted: { label: "Submitted", icon: "↑", tone: "review", animated: false },
  review_pending: { label: "Awaiting your review", icon: "◎", tone: "action", animated: false },
  accepted: { label: "Accepted", icon: "✓", tone: "pass", animated: false },
  rejected: { label: "Sent back", icon: "↩", tone: "fail", animated: false },
};
