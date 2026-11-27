// The roles the goal posters are told for: all the guide needs to draw its switch. The posters'
// words (goal-showcase.ts) load with the posters, so the goal page doesn't carry them.

export type GoalRoleId =
  | "general"
  | "sales"
  | "designer"
  | "developer"
  | "projects"
  | "finance"
  | "marketing"
  | "hr"
  | "manager";

/** In the order of the switch. */
export const GOAL_ROLES: readonly { id: GoalRoleId; name: string }[] = [
  { id: "general", name: "Any role" },
  { id: "sales", name: "Sales" },
  { id: "designer", name: "Designer" },
  { id: "developer", name: "Developer" },
  { id: "projects", name: "Project manager" },
  { id: "finance", name: "Finance" },
  { id: "marketing", name: "Marketing" },
  { id: "hr", name: "HR" },
  { id: "manager", name: "Manager" },
];

/** The page shown last, so coming back to the Dashboard carries on instead of starting over. */
export const goalPosterMemory = { index: 0 };
