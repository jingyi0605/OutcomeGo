// The posters shown beside a running deployment: one thought each, in as few words as it takes.
// Every claim here is something the product does today (docs/overview, docs/usage), so keep them
// in step with the docs.

export type PosterId = "focus" | "outcome" | "computer" | "team" | "routines" | "decide" | "connect" | "yours";

export interface Poster {
  id: PosterId;
  /** English copy; callers translate it. */
  title: string;
  body: string;
}

export const POSTERS: readonly Poster[] = [
  {
    id: "focus",
    title: "Attention, kept for judgment",
    body: "Bots work in parallel. You step in where it matters.",
  },
  {
    id: "outcome",
    title: "Not to-dos. Outcomes.",
    body: "Criteria first. Every result checked, with evidence.",
  },
  {
    id: "computer",
    title: "A computer for every bot",
    body: "Its own screen, browser and terminal. Watch or take over anytime.",
  },
  {
    id: "team",
    title: "A team that hands off",
    body: "Group chats, shared files, and memory of what you prefer.",
  },
  {
    id: "routines",
    title: "You rest. Work goes on.",
    body: "On a schedule or on an event, as long as the server is on.",
  },
  {
    id: "decide",
    title: "Quiet, until it needs you",
    body: "One card: what to decide, what is recommended, and why.",
  },
  {
    id: "connect",
    title: "Your tools, connected",
    body: "Plugins, MCP servers, or simply the browser.",
  },
  {
    id: "yours",
    title: "Your data. Your model.",
    body: "Conversations, files and memory are stored on this computer.",
  },
];

/** How long a poster stays up before the next one takes its place. */
export const POSTER_MS = 7_000;

/** The poster `step` away from `index`, wrapping around at both ends. */
export const stepPoster = (index: number, step: number, count = POSTERS.length): number =>
  (((index + step) % count) + count) % count;

/** Which way to scroll between two posters: the short way round, so last to first runs forward. */
export const posterDirection = (from: number, to: number, count = POSTERS.length): "forward" | "back" => {
  if (count > 2 && from === count - 1 && to === 0) return "forward";
  if (count > 2 && from === 0 && to === count - 1) return "back";
  return to < from ? "back" : "forward";
};
