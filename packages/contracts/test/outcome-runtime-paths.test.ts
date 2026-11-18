import { expect, test } from "bun:test";
import { COMPUTER_API_PATHS } from "../src/service-protocol";

test("scoped Outcome shell stop has a distinct path from the legacy all-Bot stop", () => {
  expect(COMPUTER_API_PATHS.backgroundShellRunsStop("bot/a")).toBe("/v1/bots/bot%2Fa/background-shells/stop-runs");
  expect(COMPUTER_API_PATHS.backgroundShellsStop("bot/a")).toBe("/v1/bots/bot%2Fa/background-shells/stop");
});
