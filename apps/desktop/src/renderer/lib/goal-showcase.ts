// The posters on the goal management entry page: what a goal is, then how to use it in three steps,
// told once for each role the owner can pick. The three steps work the same for every role, so the
// lines naming buttons and sections are shared; the names in quotes are the ones on screen
// (goal-showcase.test.tsx holds them to it).
import type { RobotAvatarShape } from "@outcomego/contracts/robot-avatar";
import type { GoalRoleId } from "./goal-roles";
import { ROLE_STORIES } from "./goal-showcase-roles";
import type { PosterCopy } from "./poster-showcase";

export type GoalPosterId = "concept" | "capture" | "approve" | "accept";

interface PageCopy {
  title: string;
  body: string;
}

type Three = readonly [string, string, string];

/** One role's telling: the words that change with the role, and what the pictures show. English; callers translate. */
export interface GoalStory {
  id: GoalRoleId;
  concept: PageCopy & { points: Three };
  /** `also` is what else this role would jot down. */
  capture: PageCopy & { also: string };
  approve: PageCopy;
  accept: PageCopy;
  /** The pictures have little room: goal-showcase.test.tsx holds these to a length. */
  picture: {
    bot: { name: string; shape: RobotAvatarShape };
    /** What is typed into Go, and the file dropped with it. */
    line: string;
    file: string;
    /** The goal it becomes, and what that is checked against. */
    plan: string;
    criteria: Three;
    /** What comes back to the owner: a decision, a step by hand, a result to review. */
    asks: Three;
  };
}

const ANY_ROLE: GoalStory = {
  id: "general",
  concept: {
    title: "Say the outcome, skip the babysitting",
    body: "A goal is the result you want and how you will judge it. A bot plans it, does the work and brings back evidence.",
    points: [
      "Goals are multi-step work, checked against acceptance criteria",
      "To-dos, schedules, ideas and notes live in the same place",
      "You approve the plan and you accept the result",
    ],
  },
  capture: {
    title: "Press Go and jot it down",
    body: "Whatever is on your mind is saved at once, then sorted in the background.",
    also: "You can also ask a bot in chat to register a goal",
  },
  approve: {
    title: "Read the plan, then say go",
    body: "The bot writes the plan and acceptance criteria first. Work on a goal starts after you approve.",
  },
  accept: {
    title: "Asked only when needed. You accept.",
    body: "Decisions, hands-on steps and reviews are gathered for you, so you needn't dig through chats.",
  },
  picture: {
    bot: { name: "Researcher", shape: "helmet" },
    line: "Compare three vendors by Friday",
    file: "Brief.pdf",
    plan: "Vendor comparison",
    criteria: ["Three vendors compared", "Every price has a source", "Ends with a recommendation"],
    asks: ["Which vendor to trial?", "Sign the trial form", "The report is ready"],
  },
};

/** In the order of the switch (GOAL_ROLES). */
export const GOAL_STORIES: readonly GoalStory[] = [ANY_ROLE, ...ROLE_STORIES];

/** The four pages of one role's telling. */
export const goalPosters = ({ concept, capture, approve, accept }: GoalStory): readonly PosterCopy<GoalPosterId>[] => [
  { id: "concept", eyebrow: "What goals are", ...concept },
  {
    id: "capture",
    eyebrow: "How to use · Step 1",
    title: capture.title,
    body: capture.body,
    points: [
      "“Go” at the top right opens “Whatever is on your mind”",
      "Paste pictures, add files, or type @ to choose a Bot",
      capture.also,
    ],
  },
  {
    id: "approve",
    eyebrow: "How to use · Step 2",
    ...approve,
    points: [
      "Plans waiting for you appear under “Needs your action”",
      "“Yes, approve” starts the work right away",
      "To change or ask something, write it and press “Send to bot”",
    ],
  },
  {
    id: "accept",
    eyebrow: "How to use · Step 3",
    ...accept,
    points: [
      "Start with “Needs your action” on the “Dashboard”",
      "Check the evidence for each criterion, then press “Approve”",
      "For rework, tell the planner what to fix. Dates are in “Calendar”",
    ],
  },
];

/** Longer than the deployment posters: these are instructions, read while deciding what to do. */
export const GOAL_POSTER_MS = 10_000;
