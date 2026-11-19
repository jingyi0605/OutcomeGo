import { expect, test } from "bun:test";
import {
  createPluginTemplate,
  parsePluginDefinition,
  validateValues,
  validateMcpUrl,
} from "../src";

test("MCP URL fields normalize reachable schemes and reject credential-bearing or insecure links", () => {
  for (const value of [
    "https://environment.example/mcp",
    "http://localhost:3773/mcp",
    "http://127.0.0.1:3773/mcp",
    "http://[::1]:3773/mcp",
    "http://10.255.0.83:3773/mcp",
    "http://172.31.8.4:3773/mcp",
    "http://192.168.1.2:3773/mcp",
    "http://[fd12:3456::83]:3773/mcp",  ]) {
    expect(
      validateValues(
        [{ key: "url", label: "MCP URL", format: "mcp-url", required: true, secret: false }],
        { url: ` ${value} ` }
      ).url
    ).toBe(value);
  }
  for (const value of [
    "AUTO-example",
    "environment.example/mcp",
    "http://100.64.1.2:3773/mcp",
    "http://8.8.8.8:3773/mcp",
    "http://172.32.0.1:3773/mcp",
    "http://[2001:db8::1]:3773/mcp",
    "http://[fe80::1]:3773/mcp",
    "http://169.254.169.254/mcp",
    "http://environment.example/mcp",
    "http://dsh.local/mcp",    "https://user:pass@example.com/mcp",
    "https://example.com/pair#code=private",
    "https://example.com/mcp#",
    "https://example.com/mcp?token=private",
    "https://example.com/mcp?code=private",
    "file:///tmp/mcp",
    "javascript:alert(1)",
  ]) {
    expect(() => validateMcpUrl(value)).toThrow();
  }
});

test("whole-endpoint placeholders require a declared validated per-account URL field", () => {
  const plugin = createPluginTemplate("remote-mcp", "endpoint-test");
  plugin.setupFields = [];
  plugin.connections[0]!.endpoint = "${mcpUrl}";
  expect(() => parsePluginDefinition(plugin)).toThrow("required MCP URL setup field");
  plugin.setup = {
    kind: "oauth",
    connectionKey: plugin.connections[0]!.key,
    title: "Connect",
    description: "",
    documentationUrl: null,
    steps: [],
    requiredScopes: [],
    fields: [{ key: "mcpUrl", label: "URL", format: "mcp-url", required: true, secret: false }],
  };
  expect(parsePluginDefinition(plugin).connections[0]!.endpoint).toBe("${mcpUrl}");
  plugin.setup.fields[0]!.format = undefined;
  expect(() => parsePluginDefinition(plugin)).toThrow("required MCP URL setup field");
});
