// The posters shown beside a running deployment: what OutcomeGo can do, one thing each, in as few
// words as it takes. The order and the titles are the product owner's.
import { type PosterCopy, scrollDirection, wrapPoster } from "./poster-showcase";

export type PosterId = "assistant" | "team" | "computer" | "decide" | "outcome" | "dock" | "routines" | "connect" | "yours";

export type Poster = PosterCopy<PosterId>;

export const POSTERS: readonly Poster[] = [
  {
    id: "assistant",
    title: "An assistant that knows you, and is yours",
    body: "It remembers your preferences, projects and ways of working.",
  },
  {
    id: "team",
    title: "You get a team that hands off",
    body: "Clear roles in a group chat, passing one shared file along.",
  },
  {
    id: "computer",
    title: "A computer for every bot",
    body: "Its own screen, with a browser, files and spreadsheets. Watch or take over anytime.",
  },
  {
    id: "decide",
    title: "Bots take the grind. You make the calls.",
    body: "Bots finish what they can. One card asks you for the rest.",
  },
  {
    id: "outcome",
    title: "No excuses. Just outcomes.",
    body: "Criteria first. Every result checked, with evidence.",
  },
  {
    id: "dock",
    title: "Drag it over, start talking",
    body: "From any app, drop files or pictures on the bot floating window to start a chat.",
  },
  {
    id: "routines",
    title: "While you rest, they carry on",
    body: "On a schedule or on an event, as long as this computer is on.",
  },
  {
    id: "connect",
    title: "Bring in your work and your life",
    body: "WeChat, Feishu, DingTalk, Amap, Notion, email, NAS and more.",
  },
  {
    id: "yours",
    title: "Your data. Your model.",
    body: "Chats, files and memory are stored on this computer. Switch models anytime.",
  },
];

/** How long a poster stays up before the next one takes its place. */
export const POSTER_MS = 7_000;

/** The poster `step` away from `index`, wrapping around at both ends. */
export const stepPoster = (index: number, step: number, count = POSTERS.length): number =>
  wrapPoster(index, step, count);

/** Which way to scroll between two posters: the short way round, so last to first runs forward. */
export const posterDirection = (from: number, to: number, count = POSTERS.length): "forward" | "back" =>
  scrollDirection(from, to, count);
