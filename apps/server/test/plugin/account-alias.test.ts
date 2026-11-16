import { describe, expect, test } from "bun:test";
import { connectionNamespaces } from "@outcomego/plugin-sdk";
import { validAlias } from "../../src/services/plugin/values";

describe("account alias", () => {
  test.each(["work", "default", "哆哆", "我的微信", "Café 2", "alice+bot@example.com (vault2.test)", "日本語アカウント", "a-b_c.d", "Ñandú"])("%s is accepted", (alias) => {
    expect(validAlias(alias)).toBe(alias);
  });

  test("surrounding spaces are trimmed", () => {
    expect(validAlias("  哆哆  ")).toBe("哆哆");
  });

  test.each(["", " ", "a", "哆", "-work", "work-", "a\u0000b", "a‮b", "😀😀", "a;b", "a/b", "x".repeat(81), "哆".repeat(81)])("%j is refused", (alias) => {
    expect(() => validAlias(alias)).toThrow(/Account alias must be/);
  });

  test("the longest allowed alias is 80 characters, counting each character once", () => {
    expect(validAlias("哆".repeat(80))).toBe("哆".repeat(80));
  });

  test("accounts named in other scripts still get distinct, usable tool namespaces", () => {
    const at = new Date("2026-11-17T00:00:00Z");
    const names = connectionNamespaces([
      { id: "11111111-0000-0000-0000-000000000000", name: "WeChat", alias: "default", createdAt: at },
      { id: "22222222-0000-0000-0000-000000000000", name: "WeChat", alias: "哆哆", createdAt: new Date(at.getTime() + 1) },
      { id: "33333333-0000-0000-0000-000000000000", name: "WeChat", alias: "我的", createdAt: new Date(at.getTime() + 2) },
    ]);
    const values = [...names.values()];
    expect(new Set(values).size).toBe(3);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
