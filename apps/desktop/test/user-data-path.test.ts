import { describe, expect, test } from "bun:test";
import { outcomeGoUserDataPath, pinOutcomeGoUserDataPath } from "../src/main/user-data-path";

describe("desktop user data path", () => {
  test("pins the OutcomeGo directory before the app reads userData", () => {
    const calls: string[] = [];
    const app = {
      getPath(name: "appData") {
        calls.push(`get:${name}`);
        return "/Users/tester/Library/Application Support";
      },
      setPath(name: "userData", value: string) {
        calls.push(`set:${name}:${value}`);
      },
    };

    expect(pinOutcomeGoUserDataPath(app)).toBe(
      "/Users/tester/Library/Application Support/aiTeamOS"
    );
    expect(outcomeGoUserDataPath("/tmp/app-data")).toBe("/tmp/app-data/aiTeamOS");
    expect(calls).toEqual([
      "get:appData",
      "set:userData:/Users/tester/Library/Application Support/aiTeamOS",
    ]);
  });
});
