import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Specs/004.10 task 1.4: motion only for running work, and it stops under reduced motion.
const css = readFileSync(
  resolve(import.meta.dir, "../src/renderer/components/outcomego/outcomes/outcome-ui.css"),
  "utf8"
);
const timelineCss = css.slice(css.indexOf("/* Goal timeline (specs/004.10)"));

describe("timeline motion", () => {
  test("the only animation in the timeline is the running icon", () => {
    const uses = [...timelineCss.matchAll(/animation:\s*([^;]+);/g)].map((match) => match[1]!.trim());
    const active = uses.filter((value) => value !== "none !important" && value !== "none");
    expect(active).toHaveLength(1);
    expect(active[0]).toStartWith("outcome-timeline-pulse");
    expect(timelineCss).toMatch(/\.outcome-timeline-status\[data-animated\] \.outcome-timeline-icon\s*\{\s*animation:/);
  });

  test("reduced motion switches every timeline animation and transition off", () => {
    const block = timelineCss.slice(timelineCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain(".outcome-timeline *");
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/transition:\s*none\s*!important/);
  });
});
