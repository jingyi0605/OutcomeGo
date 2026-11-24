// The posters shown beside a running deployment. Every claim here is something the product
// does today (docs/overview, docs/usage), so keep them in step with the docs.

export type PosterId = "focus" | "outcome" | "computer" | "team" | "routines" | "decide" | "connect" | "yours";

export interface Poster {
  id: PosterId;
  /** Posters drawn on a night stage, whatever the theme. */
  night?: true;
  /** English copy; callers translate it. */
  eyebrow: string;
  title: string;
  body: string;
  points: readonly [string, string, string];
}

export const POSTERS: readonly Poster[] = [
  {
    id: "focus",
    night: true,
    eyebrow: "The idea",
    title: "Keep your attention for what truly needs your judgment",
    body: "AI can do more and more at once, but you only have one attention. Bots do the work in parallel, and you step in where it matters.",
    points: ["Work in parallel", "Fewer interruptions", "You make the call"],
  },
  {
    id: "outcome",
    eyebrow: "From goal to outcome",
    title: "More than a to-do list: outcomes you can accept",
    body: "Agree on the goal, the acceptance criteria and the boundaries before work starts. What comes back is checked against each one, with evidence.",
    points: ["Criteria first", "Checked one by one", "Evidence attached"],
  },
  {
    id: "computer",
    eyebrow: "A computer of its own",
    title: "Every bot has a computer of its own",
    body: "Its own screen, browser and terminal for research, websites and files. Watch it work whenever you like, and take over when it needs you.",
    points: ["A real browser", "Terminal and files", "Take over anytime"],
  },
  {
    id: "team",
    eyebrow: "Teamwork",
    title: "Bots that share the work like a team",
    body: "Bring bots into a group chat, give each a role, and let them hand work over in a shared workspace. They remember your preferences for next time.",
    points: ["Group chats", "Shared workspace", "Lasting memory"],
  },
  {
    id: "routines",
    night: true,
    eyebrow: "Routines",
    title: "Work goes on while you rest",
    body: "Hand repeated work to routines that run on a schedule or when something happens. They run on the server: while it's on, you can close the app.",
    points: ["On a schedule", "When something happens", "Every run on record"],
  },
  {
    id: "decide",
    eyebrow: "Only when it matters",
    title: "Quiet until it needs you",
    body: "When a decision, a review or a hand is needed, you get one card: what to decide, what is recommended, and why. Answer on your computer or phone.",
    points: ["Recommendation first", "Evidence at hand", "Computer and phone"],
  },
  {
    id: "connect",
    eyebrow: "Your tools, connected",
    title: "Works with the tools you already use",
    body: "Add plugins for Gmail, GitHub, Notion, DingTalk and more, or connect your own MCP server. For any other website, bots use the browser.",
    points: ["Plugins", "MCP servers", "Reusable skills"],
  },
  {
    id: "yours",
    eyebrow: "Self-hosted",
    title: "Your data stays with you. The model is your choice",
    body: "Conversations, files and memory are stored on this computer. Use a ChatGPT or Claude plan, an API key, or a model server of your own.",
    points: ["Stored on this computer", "Choose your model", "Open source"],
  },
];

/** How long a poster stays up before the next one scrolls in. */
export const POSTER_MS = 10_000;

/** The poster `step` away from `index`, wrapping around at both ends. */
export const stepPoster = (index: number, step: number, count = POSTERS.length): number =>
  (((index + step) % count) + count) % count;

/** Which way to scroll between two posters: the short way round, so last to first runs forward. */
export const posterDirection = (from: number, to: number, count = POSTERS.length): "forward" | "back" => {
  if (count > 2 && from === count - 1 && to === 0) return "forward";
  if (count > 2 && from === 0 && to === count - 1) return "back";
  return to < from ? "back" : "forward";
};
