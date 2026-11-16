import { TEXT_CHUNK_CHARS } from "./protocol";

/** Boundaries tried in order, strongest first: a blank line, a line break, a sentence end. */
const BOUNDARIES: Array<(window: string) => number> = [
  (window) => window.lastIndexOf("\n\n"),
  (window) => window.lastIndexOf("\n"),
  (window) => {
    let best = -1;
    for (const mark of ["。", "！", "？", "；", ". ", "! ", "? "]) best = Math.max(best, window.lastIndexOf(mark));
    return best;
  },
];

/**
 * Splits text into pieces of at most `limit` characters for sending as separate messages. Prefers to
 * break at a blank line, then a line break, then the end of a sentence, and only then in the middle of
 * a word. Never cuts a surrogate pair, trims each piece, and drops empty ones. Adds no "(1/3)" marks.
 * Lengths are counted in code points, which is how a person counts characters.
 */
export function splitText(text: string, limit: number = TEXT_CHUNK_CHARS): string[] {
  const characters = Array.from(text);
  const pieces: string[] = [];
  let start = 0;
  while (start < characters.length) {
    const end = Math.min(start + limit, characters.length);
    let cut = end;
    if (end < characters.length) {
      const window = characters.slice(start, end).join("");
      for (const find of BOUNDARIES) {
        const at = find(window);
        // A boundary too near the start would leave a tiny piece; ignore anything before a quarter.
        if (at > window.length / 4) {
          // The cut falls after the boundary itself: both newlines of a blank line, otherwise one character
          // (the line break, or the punctuation that ended the sentence).
          const markLength = window.startsWith("\n\n", at) ? 2 : 1;
          cut = start + Array.from(window.slice(0, at)).length + markLength;
          break;
        }
      }
    }
    const piece = characters.slice(start, cut).join("").trim();
    if (piece) pieces.push(piece);
    start = cut;
  }
  return pieces;
}
