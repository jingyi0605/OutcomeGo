import { expect, test } from "bun:test";
import { createOutcomeApi } from "../src/renderer/client/outcome-api";
import { outcomeFixture } from "./outcome-fixture";

test("history snapshot requests use the selected real revision and the existing authenticated transport", async () => {
  const calls: string[] = [];
  const client = createOutcomeApi(async <T>(path: string) => { calls.push(path); return outcomeFixture.currentRevisionView as T; });
  expect(await client.getRevision!("outcome/one", 1)).toEqual(outcomeFixture.currentRevisionView);
  expect(calls).toEqual(["/api/outcomes/outcome%2Fone/revisions/1"]);
});
