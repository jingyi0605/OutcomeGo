import { expect, test } from "bun:test";
import { replyRevealFrames } from "../../src/renderer/hooks/use-streamed-text";

test("reveals the first grapheme immediately and preserves emoji and combining marks", () => {
  expect(replyRevealFrames("👩🏽‍💻你e\u0301", null)).toEqual([
    "👩🏽‍💻",
    "👩🏽‍💻你",
    "👩🏽‍💻你e\u0301",
  ]);
});

test("continues from the displayed prefix and catches up to a long chunk in five updates", () => {
  const shown = "已经显示";
  const source = shown + "字".repeat(150);
  const frames = replyRevealFrames(source, shown);
  expect(frames).toHaveLength(5);
  expect(frames[0]).toBe(shown + "字".repeat(30));
  expect(frames.at(-1)).toBe(source);
});

test("preserves a grapheme extended by a later snapshot", () => {
  expect(replyRevealFrames("e\u0301!", "e")).toEqual(["e\u0301", "e\u0301!"]);
});

test("applies corrections directly and leaves a caught-up reply alone", () => {
  expect(replyRevealFrames("Corrected", "Incorrect")).toEqual(["Corrected"]);
  expect(replyRevealFrames("Complete", "Complete")).toEqual([]);
});
