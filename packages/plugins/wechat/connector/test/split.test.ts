import { describe, expect, test } from "bun:test";
import { splitText } from "../split";

const lengths = (pieces: string[]) => pieces.map((piece) => Array.from(piece).length);

describe("short text", () => {
  test("stays as one piece, trimmed", () => {
    expect(splitText("  hello  ")).toEqual(["hello"]);
  });
  test("an empty or blank text has no pieces", () => {
    expect(splitText("")).toEqual([]);
    expect(splitText(" \n\n \t ")).toEqual([]);
  });
  test("text exactly at the limit is one piece", () => {
    expect(splitText("a".repeat(1800))).toEqual(["a".repeat(1800)]);
  });
});

describe("long text", () => {
  test("no piece is longer than the limit, and nothing but whitespace is lost", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${"word ".repeat(30)}`).join("\n\n");
    const pieces = splitText(text, 500);
    expect(pieces.length).toBeGreaterThan(5);
    for (const length of lengths(pieces)) expect(length).toBeLessThanOrEqual(500);
    expect(pieces.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim());
  });

  test("breaks at a blank line when there is one", () => {
    const first = "a".repeat(300);
    const second = "b".repeat(300);
    expect(splitText(`${first}\n\n${second}`, 400)).toEqual([first, second]);
  });

  test("with no blank line it breaks at a line end", () => {
    const first = "a".repeat(300);
    const second = "b".repeat(300);
    expect(splitText(`${first}\n${second}`, 400)).toEqual([first, second]);
  });

  test("with no line break it breaks after a sentence", () => {
    const first = `${"a".repeat(290)}.`;
    const second = "b".repeat(250);
    const pieces = splitText(`${first} ${second}`, 400);
    expect(pieces[0]).toBe(first);
    expect(pieces[1]).toBe(second);
  });

  test("Chinese sentence ends are boundaries too", () => {
    const first = `${"一".repeat(290)}。`;
    const second = "二".repeat(250);
    expect(splitText(`${first}${second}`, 400)).toEqual([first, second]);
  });

  test("an unbroken run is cut at the limit and loses nothing", () => {
    const pieces = splitText("x".repeat(1000), 400);
    expect(lengths(pieces)).toEqual([400, 400, 200]);
    expect(pieces.join("")).toBe("x".repeat(1000));
  });

  test("a boundary right at the start is ignored so no tiny piece is made", () => {
    const text = `\n${"a".repeat(500)}`;
    const pieces = splitText(text, 400);
    expect(pieces.every((piece) => piece.length > 50)).toBe(true);
  });
});

describe("characters outside the basic plane", () => {
  test("a surrogate pair is never cut in half", () => {
    const text = "😀".repeat(1000);
    const pieces = splitText(text, 333);
    for (const piece of pieces) {
      expect(piece).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      expect(Array.from(piece).length).toBeLessThanOrEqual(333);
    }
    expect(pieces.join("")).toBe(text);
  });
  test("a cut falling between the halves of a pair keeps them together", () => {
    for (let pad = 0; pad < 4; pad++) {
      const text = `${"a".repeat(pad)}${"😀".repeat(200)}`;
      expect(splitText(text, 50).join("")).toBe(text);
    }
  });
});

describe("what is not added", () => {
  test("no numbering or markers are added to the pieces", () => {
    const pieces = splitText("word ".repeat(2000), 500);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece).not.toMatch(/\(\d+\/\d+\)|\[\d+\/\d+\]/);
  });
  test("each piece is trimmed and none is empty", () => {
    const pieces = splitText(`${"a ".repeat(300)}\n\n\n\n   \n\n${"b ".repeat(300)}`, 300);
    for (const piece of pieces) {
      expect(piece).toBe(piece.trim());
      expect(piece.length).toBeGreaterThan(0);
    }
  });
});
