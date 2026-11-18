import type { OutcomeCardStage } from "@outcomego/contracts/outcome-chat";

export const outcomeStageLabels: Record<OutcomeCardStage, string> = {
  analyzing: "Analyzing goal",
  generating: "Generating plan",
  plan_ready: "Plan ready",
  draft: "Ready for your review",
  ready: "Starting execution",
  running: "Running",
  attention: "Needs your attention",
  review: "Results ready for review",
  accepted: "Accepted",
  cancelled: "Cancelled",
  failed: "Retry needed",
};
export const outcomeNextSteps: Record<OutcomeCardStage, string> = {
  analyzing: "Understanding the goal and its constraints.",
  generating: "Preparing goals, acceptance criteria and boundaries.",
  plan_ready: "Suggestions are ready. Confirm the selections to save a goal draft.",
  draft: "Approve this plan or tell us what should change.",
  ready: "The plan is approved. Execution is starting.",
  running: "This goal is running independently. You can continue the conversation.",
  attention: "Open the goal to handle its decision or human task.",
  review: "Results are ready. Check the evidence and complete your review.",
  accepted: "You accepted the result. Its outputs remain available.",
  cancelled: "This goal has stopped. Its records remain available.",
  failed: "Retry the operation or open the goal to check its saved state.",
};
