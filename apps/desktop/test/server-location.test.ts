import { expect, test } from "bun:test";
import {
  canDeleteLocalData,
  computeResourcePresets,
  formatFriendlyBytes,
  formatGigabytes,
  formatMegabytes,
  formatMemoryGib,
  halfGibToCliMemory,
  isLocalServer,
  localMemoryChange,
  memorySizeBytes,
  memoryStringToHalfGib,
  serverStateLabel,
  validateLocalResourceForm,
} from "../src/renderer/lib/server-location";
import { stackStates, type LocalResourceSnapshot } from "../src/renderer/lib/local-deploy-contract";
import { localServiceTranslations } from "../src/renderer/lib/local-service-catalog";

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

test("computes valid resource presets scaled to host and engine memory", () => {
  const gib = 1024 ** 3;
  const presets = computeResourcePresets(32 * gib, 12, 16 * gib);
  for (const tier of ["light", "balanced", "performance"] as const) {
    const p = presets[tier];
    const comp = memorySizeBytes(p.computerMemory)!;
    const desk = memorySizeBytes(p.desktopMemory)!;
    expect(comp).toBeGreaterThanOrEqual(2 * gib);
    expect(desk).toBeGreaterThanOrEqual(gib);
    expect(desk).toBeLessThan(comp);
    expect(p.workerConcurrency).toBeGreaterThanOrEqual(1);
    expect(p.workerConcurrency).toBeLessThanOrEqual(16);
  }
});

test("validates container and engine resource form inputs and flags 75% engine memory warning", () => {
  const gib = 1024 ** 3;
  const snapshot: LocalResourceSnapshot = {
    schemaVersion: 1,
    host: { memoryBytes: 16 * gib, cpuCores: 8, diskAvailableBytes: 50 * gib },
    containers: { computerMemory: "6g", desktopMemory: "4g", computerCpu: 4, workerConcurrency: 4 },
    engine: { kind: "managed-wsl", memoryBytes: 8 * gib, cpuCores: 8, configurable: "wslconfig" },
  };

  expect(
    validateLocalResourceForm({
      computerMemory: "6g",
      desktopMemory: "4g",
      computerCpu: "3.5",
      workerConcurrency: "6",
      engineMemory: "8g",
      engineCpu: "4",
      modifyEngine: false,
      snapshot,
    })
  ).toMatchObject({ valid: true, error: null, warning: null, parsedComputerCpu: 3.5, parsedWorkerConcurrency: 6 });

  // desktop >= computer rejected
  expect(
    validateLocalResourceForm({
      computerMemory: "4g",
      desktopMemory: "4g",
      computerCpu: "",
      workerConcurrency: "4",
      engineMemory: "",
      engineCpu: "",
      modifyEngine: false,
      snapshot,
    }).valid
  ).toBe(false);

  // > 75% of 8 GiB engine (= 6 GiB) emits soft warning while remaining valid
  const warned = validateLocalResourceForm({
    computerMemory: "7g",
    desktopMemory: "5g",
    computerCpu: "",
    workerConcurrency: "4",
    engineMemory: "",
    engineCpu: "",
    modifyEngine: false,
    snapshot,
  });
  expect(warned.valid).toBe(true);
  expect(warned.warning).toBeTruthy();

  // Invalid CPU step rejected
  expect(
    validateLocalResourceForm({
      computerMemory: "6g",
      desktopMemory: "4g",
      computerCpu: "2.3",
      workerConcurrency: "4",
      engineMemory: "",
      engineCpu: "",
      modifyEngine: false,
      snapshot,
    }).valid
  ).toBe(false);
});

test("local-service zh-CN catalog has non-empty entries for all Spec 012.1 keys", () => {
  for (const [k, v] of Object.entries(localServiceTranslations)) {
    expect(k.trim().length).toBeGreaterThan(0);
    expect(v.trim().length).toBeGreaterThan(0);
  }
  expect(localServiceTranslations["Manage local services…"]).toBe("服务管理…");
  expect(localServiceTranslations["Proxy server"]).toBe("代理服务器");
  expect(localServiceTranslations["Performance and resources"]).toBe("性能与资源配置");
});

test("formats raw byte strings and converts slider half-GB steps into CLI memory notation", () => {
  expect(formatFriendlyBytes(0)).toBe("0 MB");
  expect(formatFriendlyBytes(45 * 1024 ** 2)).toBe("45 MB");
  expect(formatFriendlyBytes(6 * 1024 ** 3)).toBe("6 GB");
  expect(formatFriendlyBytes(6238479360)).toBe("5.8 GB");

  expect(formatMemoryGib("6238479360")).toBe("5.8 GB");
  expect(formatMemoryGib("5164737536")).toBe("4.8 GB");
  expect(formatMemoryGib("6g")).toBe("6 GB");

  expect(memoryStringToHalfGib("6238479360", 6)).toBe(5.5);
  expect(memoryStringToHalfGib("5164737536", 4)).toBe(4.5);
  expect(memoryStringToHalfGib("8g", 6)).toBe(8);
  expect(memoryStringToHalfGib("5632m", 6)).toBe(5.5);

  expect(halfGibToCliMemory(6)).toBe("6g");
  expect(halfGibToCliMemory(5.5)).toBe("5632m");
  expect(memorySizeBytes(halfGibToCliMemory(5.5))).toBe(5.5 * 1024 ** 3);

  expect(formatMegabytes(0)).toBe("0 MB");
  expect(formatMegabytes(249_856)).toBe("0.2 MB");
  expect(formatMegabytes(330_825_728)).toBe("316 MB");
  expect(formatGigabytes(0)).toBe("0.00 GB");
  expect(formatGigabytes(5_320_000_000)).toBe("5.32 GB");
  expect(formatGigabytes(406_000_000)).toBe("0.41 GB");
});
