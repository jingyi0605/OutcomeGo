import { describe, expect, test } from "bun:test";
import { describeDiscoveryFailure, failureCode } from "../src/chat-provider-registry";

const coded = (code: string, name = "TypeError") => Object.assign(new Error("x"), { name, code });

describe("model discovery failure wording", () => {
  test.each([
    ["UNKNOWN_CERTIFICATE_VERIFICATION_ERROR", "certificate"],
    ["CERT_HAS_EXPIRED", "certificate"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "certificate"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "certificate"],
    ["UnexpectedRedirect", "redirected"],
    ["ECONNREFUSED", "refused"],
    ["ENOTFOUND", "could not be reached"],
    ["ECONNRESET", "could not be reached"],
  ])("%s names its cause", (code, expected) => {
    expect(describeDiscoveryFailure(coded(code))).toContain(expected);
  });

  test("a timeout is told apart from a refusal", () => {
    expect(describeDiscoveryFailure(coded("23", "TimeoutError"))).toContain("did not answer in time");
  });

  test("the code is read from the cause as well", () => {
    const error = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(failureCode(error)).toBe("ECONNREFUSED");
    expect(describeDiscoveryFailure(error)).toContain("refused");
  });

  test("an unknown failure keeps the generic advice and never echoes the raw message", () => {
    const secret = new Error("GET https://user:sk-secret@api.example.com/v1/models failed");
    const text = describeDiscoveryFailure(secret);
    expect(text).toContain("Could not load chat models");
    expect(text).not.toContain("sk-secret");
    expect(describeDiscoveryFailure("a string")).toContain("Could not load chat models");
  });
});
