import { expect, test } from "bun:test";
import { exportPackageArchive, importPackageArchive } from "@outcomego/plugin-sdk/archive";
import { connectorHostTools, fieldsForConnector, substituteConfiguration, validateValues } from "@outcomego/plugin-sdk";
import { pluginCatalog } from "../../../src";

const plugin = () => pluginCatalog.find((entry) => entry.key === "wechat")!;

test("the package is in the catalog with its skill and connector, and without tests, fixtures or state", () => {
  expect(plugin()).toBeDefined();
  expect(plugin().skills.map((skill) => skill.name)).toEqual(["wechat"]);
  expect(plugin().files?.["connector/server.mjs"]).toContain("openteam-wechat");
  const keys = [...Object.keys(plugin().files ?? {}), ...Object.keys(plugin().binaryFiles ?? {})];
  expect(keys.some((path) => /(?:^|\/)(?:test|tests|fixtures|node_modules)(?:\/|$)|\.test\.|account\.json|journal\.ndjson|cursor\.json/.test(path))).toBe(false);
  expect(plugin().files?.["assets/SOURCES.md"]).toBeTruthy();
  expect(plugin().files?.["NOTICE.md"]).toContain("independently");
  expect(plugin().files?.["QR-LICENSE"]).toBeTruthy();
});

test("the connector's own code names no host except WeChat's, and the bundle has no test code", async () => {
  expect(plugin().files!["connector/server.mjs"]).not.toContain("IlinkSimulator");
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const directory = join(import.meta.dir, "..");
  const sources = (await readdir(directory)).filter((name) => name.endsWith(".ts"));
  expect(sources.length).toBeGreaterThan(10);
  const found = new Set<string>();
  for (const name of sources)
    for (const match of (await readFile(join(directory, name), "utf8")).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) found.add(match[1]!.toLowerCase());
  // Every host in the connector's source, including examples in comments, is a WeChat host.
  expect([...found].filter((host) => host !== "weixin.qq.com" && !host.endsWith(".weixin.qq.com"))).toEqual([]);
  expect(found.size).toBeGreaterThan(0);
});

test("it exports and imports without losing the skill or the messaging declaration", () => {
  const archive = exportPackageArchive(plugin());
  expect(archive.byteLength).toBeLessThan(2 * 1024 * 1024);
  const imported = importPackageArchive(archive).definition;
  expect(imported.skills).toEqual(plugin().skills);
  expect(imported.connections[0]!.messaging).toEqual(plugin().connections[0]!.messaging);
  expect(imported.icon).toBe("assets/icon.png");
});

test("it needs no setup values: linking is by QR code, and the entry point is its bundled server", () => {
  const connector = plugin().connections[0]!;
  expect(fieldsForConnector(plugin(), "wechat")).toEqual([]);
  const values = validateValues(fieldsForConnector(plugin(), "wechat"), {});
  expect(substituteConfiguration(connector.configuration, { ...values, PLUGIN_ROOT: "/installed/plugin" })).toEqual({ command: "bun", args: ["/installed/plugin/connector/server.mjs"] });
  expect(connector.persistentState).toBe(true);
  expect(connector.transport).toBe("stdio");
});

test("every tool the Server calls on its own is hidden from Bots by declaration, not only by metadata", () => {
  const hidden = connectorHostTools(plugin().connections[0]);
  expect(hidden.sort()).toEqual(["wechat_cancel_link", "wechat_deliver_message", "wechat_finish_link", "wechat_link_status", "wechat_poll_inbound", "wechat_remove_account", "wechat_start_link"]);
  expect(hidden).not.toContain("list_peers");
  expect(hidden).not.toContain("connection_status");
});

test("the declared limits match what the connector enforces", async () => {
  const messaging = plugin().connections[0]!.messaging!;
  const { MAX_DELIVERY_TEXT_CHARS } = await import("../protocol");
  expect(messaging.outbound.maxTextChars).toBe(MAX_DELIVERY_TEXT_CHARS);
  // Only still images are declared: files and video stay off until a real account shows they arrive.
  expect(messaging.outbound.media?.kinds).toEqual(["image"]);
  expect(messaging.platform).toBe("wechat");
});
