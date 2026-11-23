import { describe, expect, test } from "bun:test";
import { outcomeGoUserDataPath, pinOutcomeGoUserDataPath } from "../src/main/user-data-path";

describe("desktop user data path", () => {
  test("pins the OutcomeGo directory before the packaged app reads userData", () => {
    const calls: string[] = [];
    const app = {
      isPackaged: true,
      getPath(name: "appData" | "userData") {
        calls.push(`get:${name}`);
        return "/Users/tester/Library/Application Support";
      },
      setPath(name: "userData", value: string) {
        calls.push(`set:${name}:${value}`);
      },
    };

    expect(pinOutcomeGoUserDataPath(app)).toBe(
      "/Users/tester/Library/Application Support/OutcomeGo"
    );
    expect(outcomeGoUserDataPath("/tmp/app-data")).toBe("/tmp/app-data/OutcomeGo");
    expect(calls).toEqual([
      "get:appData",
      "set:userData:/Users/tester/Library/Application Support/OutcomeGo",
    ]);
  });

  test("keeps unpackaged development and test builds on their own userData path", () => {
    const calls: string[] = [];
    const app = {
      isPackaged: false,
      getPath(name: "appData" | "userData") {
        calls.push(`get:${name}`);
        return name === "userData"
          ? "/Users/tester/Library/Application Support/@outcomego/desktop"
          : "/Users/tester/Library/Application Support";
      },
      setPath(name: "userData", value: string) {
        calls.push(`set:${name}:${value}`);
      },
    };

    expect(pinOutcomeGoUserDataPath(app)).toBe(
      "/Users/tester/Library/Application Support/@outcomego/desktop"
    );
    expect(calls).toEqual(["get:userData"]);
  });
});
