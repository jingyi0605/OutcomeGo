import { describe, expect, test } from "bun:test";
import { identifier, LosslessJsonError, parseLosslessJson } from "../json";

describe("large integers", () => {
  test.each([
    "9007199254740993", // 2^53 + 1, the first integer a double cannot hold
    "18446744073709551615", // 2^64 - 1
    "9223372036854775807", // 2^63 - 1
    "-9007199254740993",
    "1234567890123456789",
  ])("%s is kept digit for digit", (literal) => {
    expect(JSON.parse(literal).toString()).not.toBe(literal.replace(/^-/, "-")); // JSON.parse would corrupt at least some of these
    const parsed = parseLosslessJson(`{"message_id":${literal}}`) as { message_id: unknown };
    expect(parsed.message_id).toBe(literal);
  });

  test("the 2^53 boundary is exact on both sides", () => {
    const parsed = parseLosslessJson('{"safe":9007199254740991,"unsafe":9007199254740992,"neg":-9007199254740991}') as Record<string, unknown>;
    expect(parsed.safe).toBe(9007199254740991);
    expect(parsed.unsafe).toBe("9007199254740992");
    expect(parsed.neg).toBe(-9007199254740991);
  });

  test("small integers, fractions and exponents stay numbers", () => {
    expect(parseLosslessJson("[0,-0,42,1.5,-2.25e3,1E2]")).toEqual([0, -0, 42, 1.5, -2250, 100]);
  });

  test("large values are found at any depth", () => {
    const parsed = parseLosslessJson('{"msgs":[{"message_id":18446744073709551615,"item_list":[{"x":[9007199254740993]}]}]}') as any;
    expect(parsed.msgs[0].message_id).toBe("18446744073709551615");
    expect(parsed.msgs[0].item_list[0].x[0]).toBe("9007199254740993");
  });
});

describe("parsing", () => {
  test("handles every JSON type and escape", () => {
    expect(parseLosslessJson('{"a":[true,false,null],"s":"q\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\ud83d\\ude00","e":{},"l":[]}')).toEqual({
      a: [true, false, null],
      s: 'q"\\/\b\f\n\r\té😀',
      e: {},
      l: [],
    });
  });

  test("whitespace is allowed between tokens", () => {
    expect(parseLosslessJson(' \n\t{ "a" : [ 1 , 2 ] } \r\n')).toEqual({ a: [1, 2] });
  });

  test("a hostile __proto__ key is an ordinary property", () => {
    const parsed = parseLosslessJson('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test.each([
    "",
    "{",
    '{"a":}',
    '{"a":1,}',
    "[1,]",
    "[01]",
    "1.",
    ".5",
    "+1",
    "NaN",
    "Infinity",
    "'x'",
    '{"a":1} x',
    '"unterminated',
    '"bad\\q"',
    '"\\u12"',
    '"tab\there"',
    "{a:1}",
    "[1 2]",
  ])("rejects %j", (text) => {
    expect(() => parseLosslessJson(text)).toThrow(LosslessJsonError);
  });

  test("rejects runaway nesting instead of overflowing the stack", () => {
    expect(() => parseLosslessJson("[".repeat(5000) + "]".repeat(5000))).toThrow(LosslessJsonError);
  });

  test("agrees with JSON.parse on ordinary documents", () => {
    const text = JSON.stringify({ ret: 0, msgs: [{ create_time_ms: 1763280000000, text: "héllo", nested: { n: [1, 2.5, null] } }], flag: true });
    expect(parseLosslessJson(text)).toEqual(JSON.parse(text));
  });
});

describe("identifier()", () => {
  test("accepts strings and safe integers, as decimal text", () => {
    expect(identifier("18446744073709551615")).toBe("18446744073709551615");
    expect(identifier(42)).toBe("42");
    expect(identifier("abc@im.wechat")).toBe("abc@im.wechat");
  });

  test("refuses unsafe doubles, empties and other types", () => {
    expect(identifier(9007199254740993)).toBeNull(); // already corrupted by a plain JSON.parse
    expect(identifier(1.5)).toBeNull();
    expect(identifier("")).toBeNull();
    expect(identifier(null)).toBeNull();
    expect(identifier({})).toBeNull();
  });
});
