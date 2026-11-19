import { expect, test } from "bun:test";
import { quickIdeaDraft } from "../src/renderer/components/outcomego/outcomes/explore/explore-state";

const bots = [
  { id: "main", name: "研发" },
  { id: "other", name: "Ada Lovelace" },
];

test("without an @ the main Bot is used", () => {
  expect(quickIdeaDraft("整理本周周报", bots)).toEqual({
    title: "整理本周周报",
    note: "",
    botId: "main",
  });
});

test("the first @Bot picks the executor and is removed from the text", () => {
  expect(quickIdeaDraft("@adalovelace 调研竞品定价\n重点看企业版", bots)).toEqual({
    title: "调研竞品定价",
    note: "重点看企业版",
    botId: "other",
  });
  expect(quickIdeaDraft("调研竞品 @adalovelace 定价", bots)?.botId).toBe("other");
});

test("unknown mentions stay in the text and blank input is rejected", () => {
  expect(quickIdeaDraft("联系 @nobody 确认", bots)?.title).toBe("联系 @nobody 确认");
  expect(quickIdeaDraft("  @研发  ", bots)).toBeNull();
  expect(quickIdeaDraft("   ", bots)).toBeNull();
});

test("an over-long first line keeps the whole text as the note", () => {
  const text = "想".repeat(250);
  const draft = quickIdeaDraft(text, bots)!;
  expect(draft.title).toHaveLength(200);
  expect(draft.note).toBe(text);
});

test("no Bots available leaves the executor unset", () => {
  expect(quickIdeaDraft("做点什么", [])?.botId).toBeNull();
});
