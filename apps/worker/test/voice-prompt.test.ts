import { describe, expect, test } from "bun:test";
import { voiceRoomPrompt, voiceTurnPrompt } from "../src/worker";

describe("voice worker prompt", () => {
  test("stays internal and directs visible output through SendToUser", () => {
    expect(voiceTurnPrompt).toContain("[SAND_HIDDEN_PROMPT]");
    expect(voiceTurnPrompt).toContain("SendToUser");
    expect(voiceTurnPrompt).not.toContain("```\n");
  });
});

describe("spoken room prompt", () => {
  test("tells a member how to pass the turn and that a direct question always gets an answer", () => {
    expect(voiceRoomPrompt).toContain("@Name");
    expect(voiceRoomPrompt).toContain("SendToUser");
  });
});
