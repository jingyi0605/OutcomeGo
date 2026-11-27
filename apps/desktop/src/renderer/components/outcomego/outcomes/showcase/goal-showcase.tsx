import { memo } from "react";
import { GOAL_POSTER_MS, GOAL_STORIES, goalPosterMemory, goalPosters, type GoalRoleId } from "../../../../lib/goal-showcase";
import { PosterCarousel, type PosterDeck } from "../../poster-showcase";
import { GOAL_SCENES, GoalStoryContext } from "./goal-showcase-scenes";
// The springs and fades the carousel moves with.
import "../../setup/setup.css";

const TELLINGS = new Map(
  GOAL_STORIES.map((story) => {
    const deck: PosterDeck = {
      label: "How goals work",
      className: "goal-showcase",
      posters: goalPosters(story),
      scenes: GOAL_SCENES,
      durationMs: GOAL_POSTER_MS,
      memory: goalPosterMemory,
    };
    return [story.id, { story, deck }] as const;
  })
);

export default memo(function GoalShowcase({ role }: { role: GoalRoleId }) {
  const { story, deck } = TELLINGS.get(role)!;
  return (
    <GoalStoryContext.Provider value={story}>
      {/* Another role is another carousel: it starts clean, with no page left over from the last one. */}
      <PosterCarousel deck={deck} key={role} />
    </GoalStoryContext.Provider>
  );
});
