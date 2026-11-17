import { expect, test } from "bun:test";
import { parseComputerInferenceRequest } from "../src/service-protocol";

test("planning and prereview use the existing inference protocol without desktop observation", () => {
  for (const kind of ["planning", "prereview", "extraction", "verification", "connection-check"] as const) {
    const request = { kind, instructions: "Return JSON", prompt: "Compare backup plans", model: "test/model", reasoning: "off", timeoutMs: 60_000 };
    expect(parseComputerInferenceRequest(request).kind).toBe(kind);
    if (kind !== "verification")
      expect(() => parseComputerInferenceRequest({ ...request, screenBotId: crypto.randomUUID() })).toThrow("screen observation");
  }
  expect(() => parseComputerInferenceRequest({ kind: "unknown" })).toThrow("kind");
});
