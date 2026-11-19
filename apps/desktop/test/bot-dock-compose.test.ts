import { describe, expect, test } from "bun:test";
import {
  activeMention,
  composeMessage,
  composeTarget,
  filterComposeBots,
  removeMention,
} from "../src/renderer/lib/bot-dock-compose";

const bots = [
  { id: "main", name: "Aria" },
  { id: "dev", name: "Dev Helper" },
  { id: "zh", name: "小助手" },
];

describe("composer recipient", () => {
  test("defaults to the main Bot, the first in the list", () => {
    expect(composeTarget("hello", bots, null)?.id).toBe("main");
    expect(composeMessage("hello", bots, null)).toEqual({ botId: "main", content: "hello" });
  });

  test("uses the Bot picked with the chip", () => {
    expect(composeMessage("hello", bots, "dev")).toEqual({ botId: "dev", content: "hello" });
  });

  test("a typed @Bot wins over the chip and is removed from the text", () => {
    expect(composeMessage("@devhelper run the tests", bots, "main")).toEqual({
      botId: "dev",
      content: "run the tests",
    });
    expect(composeMessage("please @devhelper run the tests", bots, null)).toEqual({
      botId: "dev",
      content: "please run the tests",
    });
    expect(composeMessage("ask @小助手", bots, null)).toEqual({ botId: "zh", content: "ask" });
  });

  test("an @ that names no Bot stays in the message", () => {
    expect(composeMessage("mail me @ home", bots, null)).toEqual({
      botId: "main",
      content: "mail me @ home",
    });
    expect(composeMessage("hi @nobody", bots, "dev")).toEqual({
      botId: "dev",
      content: "hi @nobody",
    });
  });

  test("only the first mention chooses; the text keeps newlines", () => {
    expect(composeMessage("@aria first\n@devhelper second", bots, null)).toEqual({
      botId: "main",
      content: "first\n@devhelper second",
    });
  });

  test("blank text, or text that is only a mention, sends nothing", () => {
    expect(composeMessage("   \n", bots, null)).toBeNull();
    expect(composeMessage("@aria", bots, null)).toBeNull();
    expect(composeMessage("hello", [], null)).toBeNull();
  });

  test("pasted images are a message even without text", () => {
    expect(composeMessage("   ", bots, null, true)).toEqual({ botId: "main", content: "" });
    expect(composeMessage("@devhelper", bots, null, true)).toEqual({ botId: "dev", content: "" });
    expect(composeMessage("   ", bots, null, false)).toBeNull();
  });

  test("a chip pointing at a Bot that left falls back to the main Bot", () => {
    expect(composeTarget("hello", bots, "gone")?.id).toBe("main");
  });
});

describe("@ picker", () => {
  test("finds the @ being typed before the caret", () => {
    expect(activeMention("hi @de", 6)).toEqual({ query: "de", start: 3, end: 6 });
    expect(activeMention("@", 1)).toEqual({ query: "", start: 0, end: 1 });
    expect(activeMention("hi @de rest", 6)).toEqual({ query: "de", start: 3, end: 6 });
  });

  test("ignores an @ inside a word or already finished", () => {
    expect(activeMention("mail a@b", 8)).toBeNull();
    expect(activeMention("hi @de ", 7)).toBeNull();
    expect(activeMention("hi", 2)).toBeNull();
  });

  test("filters by name or handle, all Bots for an empty query", () => {
    expect(filterComposeBots(bots, "").map((bot) => bot.id)).toEqual(["main", "dev", "zh"]);
    expect(filterComposeBots(bots, "DEV").map((bot) => bot.id)).toEqual(["dev"]);
    expect(filterComposeBots(bots, "devh").map((bot) => bot.id)).toEqual(["dev"]);
    expect(filterComposeBots(bots, "x")).toEqual([]);
  });

  test("picking removes the token and keeps the text around it", () => {
    const text = "hi @de there";
    const mention = activeMention(text, 6);
    expect(mention && removeMention(text, mention)).toEqual({ text: "hi there", caret: 3 });
    const lone = activeMention("@a", 2);
    expect(lone && removeMention("@a", lone)).toEqual({ text: "", caret: 0 });
  });
});
