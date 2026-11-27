// What every poster carousel shares: the shape of a poster and how pages follow one another.

export interface PosterCopy<Id extends string = string> {
  id: Id;
  /** English copy; callers translate it. */
  title: string;
  body: string;
  /** A short line above the title. */
  eyebrow?: string;
  /** A few short how-to lines under the body. */
  points?: readonly string[];
}

/** The poster `step` away from `index`, wrapping around at both ends. */
export const wrapPoster = (index: number, step: number, count: number): number =>
  (((index + step) % count) + count) % count;

/** Which way to scroll between two posters: the short way round, so last to first runs forward. */
export const scrollDirection = (from: number, to: number, count: number): "forward" | "back" => {
  if (count > 2 && from === count - 1 && to === 0) return "forward";
  if (count > 2 && from === 0 && to === count - 1) return "back";
  return to < from ? "back" : "forward";
};
