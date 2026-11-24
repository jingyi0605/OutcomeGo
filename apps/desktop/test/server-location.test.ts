import { expect, test } from "bun:test";
import { canDeleteLocalData, isLocalServer, localMemoryChange, memorySizeBytes, serverStateLabel } from "../src/renderer/lib/server-location";
import { stackStates } from "../src/renderer/lib/local-deploy-contract";

test("labels all seven server states", () => {
  expect(new Set(stackStates.map(serverStateLabel)).size).toBe(7);
});

test("permanent deletion requires the exact confirmation word and checkbox", () => {
  expect(canDeleteLocalData(false, "DELETE")).toBe(false);
  expect(canDeleteLocalData(true, "delete")).toBe(false);
  expect(canDeleteLocalData(true, "DELETE")).toBe(true);
});

test("matches only a loopback server with the managed port", () => {
  expect(isLocalServer("http://localhost:8787", 8787)).toBe(true);
  expect(isLocalServer("http://[::1]:8787", 8787)).toBe(true);
  expect(isLocalServer("http://127.0.0.1:8989", 8787)).toBe(false);
  expect(isLocalServer("http://remote.invalid:8787", 8787)).toBe(false);
});

test("rejects memory limits below one GiB and malformed input", () => {
  expect(memorySizeBytes("1g")).toBe(1024 ** 3);
  expect(memorySizeBytes("1536m")).toBe(1536 * 1024 ** 2);
  expect(memorySizeBytes("1023m")).toBeNull();
  expect(memorySizeBytes("10x")).toBeNull();
});

test("caps desktop memory requests against the known guest memory", () => {
  const gib = 1024 ** 3;
  expect(localMemoryChange("7g", "8g", 8 * gib)).toEqual({ computerMemory: String(6 * gib), desktopMemory: String(6 * gib), capped: true });
  expect(localMemoryChange("4g", "3g", 8 * gib)).toEqual({ computerMemory: "4g", desktopMemory: "3g", capped: false });
  expect(localMemoryChange("4g", "3g")).toEqual({ computerMemory: "4g", desktopMemory: "3g", capped: false });
  expect(localMemoryChange("4g", "3g", gib)).toBeNull();
  expect(localMemoryChange("1023m", "3g", 8 * gib)).toBeNull();
});
