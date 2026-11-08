import { describe, expect, test } from "bun:test";
import { authErrorMessage } from "../src/auth-feedback";

describe("shared onboarding error copy", () => {
  test.each([
    "FunctionCallException: Calling getValueWithKeyAsync failed → KeyChainException: A required entitlement isn't present. (at ExpoSecureStore/SecureStoreModule.swift:168)",
    "Keychain unavailable",
  ])("hides native storage diagnostics: %s", (message) => {
    expect(authErrorMessage(new Error(message), "Could not sign in")).toBe(
      "aiTeamOS could not access your saved sign-in. Restart the app and try again."
    );
  });
  test.each([
    "Enter a valid aiTeamOS server URL.",
    "The aiTeamOS server URL must use HTTP or HTTPS.",
    "aiTeamOS server URL is required",
  ])("gives an example for an invalid address: %s", (message) => {
    expect(authErrorMessage(new Error(message), "Invalid address")).toContain(
      "starting with http:// or https://"
    );
  });
  test("explains how to fix a pasted deep link", () => {
    expect(
      authErrorMessage(
        new Error("Enter the server endpoint without a query or fragment."),
        "Invalid address"
      )
    ).toBe("Use the server address without anything after ? or #.");
  });
  test("routes credentials to the sign-in fields", () => {
    expect(
      authErrorMessage(
        new Error("Enter the server endpoint without a username or password."),
        "Invalid address"
      )
    ).toContain("sign in on the next screen");
  });
  test("keeps useful authentication failures and redacts secrets", () => {
    expect(authErrorMessage(new Error("Incorrect password"), "Could not sign in")).toBe(
      "Incorrect password"
    );
    expect(
      authErrorMessage(new Error("Rejected AUTH_TOKEN=synthetic-test-token"), "Could not sign in")
    ).toBe("Rejected AUTH_TOKEN=[REDACTED]");
  });
  test("hides the error class Electron keeps from a main-process sign-in", () => {
    const remote = (message: string) =>
      new Error(`Error invoking remote method 'aiteamos:auth:sign-in': ${message}`);
    expect(authErrorMessage(remote("AiTeamOSClientError: fetch failed"), "Could not sign in")).toBe(
      "Could not reach this aiTeamOS server. Check the address and your connection."
    );
    expect(
      authErrorMessage(
        remote("AiTeamOSClientError: The server took too long to respond. Please try again."),
        "Could not sign in"
      )
    ).toBe("The server took too long to respond. Please try again.");
  });
  test("turns a malformed sign-in success into a recovery action", () => {
    expect(
      authErrorMessage(
        new Error("The server did not return an aiTeamOS session token"),
        "Could not sign in"
      )
    ).toContain("contact your server administrator");
  });
});
