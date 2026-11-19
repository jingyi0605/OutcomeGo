import { expect, test } from "bun:test";
import { substituteConfiguration, validateValues } from "@outcomego/plugin-sdk";
import { exportPackageArchive, importPackageArchive } from "@outcomego/plugin-sdk/archive";
import { parseSkillMarkdown } from "@outcomego/plugin-sdk/skill-markdown";
import { pluginCatalog } from "../src";

const EXPECTED_TOOLS = [
  "workspace_list",
  "workspace_file_list",
  "workspace_file_read",
  "workspace_git_status",
  "workspace_git_log",
  "workspace_git_diff",
  "session_list",
  "session_create",
  "session_continue",
  "session_queue_peek",
  "session_history",
  "session_search",
  "message_status",
  "message_cancel",
  "message_prioritize",
  "session_questions",
  "session_answer",
  "session_request_permission",
  "session_permission_status",
  "terminal_list",
  "terminal_read",
  "terminal_write",
].sort();

const EXPECTED_ERROR_CODES = [
  "NOT_FOUND",
  "SESSION_NOT_FOUND",
  "INVALID_PATH",
  "FILE_TOO_LARGE",
  "NOT_A_GIT_REPO",
  "BRANCH_NOT_FOUND",
  "INVALID_REF",
  "CANNOT_CANCEL",
  "INVALID_PRIORITY",
  "INVALID_AGENT_ID",
  "QUEUE_FULL",
  "QUEUE_CONFLICT",
  "WORKSPACE_MCP_SESSION_UNAVAILABLE",
  "WORKSPACE_MCP_SESSION_HISTORY_UNAVAILABLE",
  "WORKSPACE_MCP_SESSION_SEARCH_UNAVAILABLE",
];

test("DSH-WEB saves its endpoint and API key through the shared setup-values flow", () => {
  const plugin = pluginCatalog.find((entry) => entry.key === "dsh-web");
  expect(plugin).toBeDefined();
  expect(plugin!.setup!.kind).toBe("none");
  expect(plugin!.connections[0]!.auth).toBe("token");
  expect(plugin!.connections[0]!.tools).toEqual([]);
  // Event polling is declared on the remote connection; the host hides the poll tool from Bots.
  expect(plugin!.connections[0]!.events).toEqual({ pollTool: "session_events", source: "plugin", intervalSeconds: 60 });

  const mcpUrl = "http://10.0.0.42:3010/mcp";
  const fields = validateValues(plugin!.setup!.fields, {
    mcpUrl,
    token: "test-api-key",
  });
  expect(substituteConfiguration(plugin!.connections[0]!.endpoint, fields)).toBe(mcpUrl);
  expect(fields.token).toBe("test-api-key");
});

test("DSH-WEB skill covers all 22 tools, error code guidance, and safety rules", () => {
  const plugin = pluginCatalog.find((entry) => entry.key === "dsh-web");
  expect(plugin).toBeDefined();

  const restored = importPackageArchive(exportPackageArchive(plugin!)).definition;
  expect(restored.connections[0]!.tools).toEqual([]);
  expect(restored.skills).toHaveLength(1);

  const skill = restored.skills[0]!;
  const skillMarkdown = restored.files![`${skill.path}/SKILL.md`]!;
  expect(skillMarkdown).toBeTruthy();
  expect(parseSkillMarkdown(skillMarkdown, skill.name)).toEqual({
    name: skill.name,
    description: skill.description,
    body: skill.body,
  });

  const discoveredInSkill = Array.from(
    new Set(skill.body.match(/\b(?:workspace|session|message|terminal)_[a-z0-9_]+\b/g) ?? [])
  ).sort();
  expect(discoveredInSkill).toHaveLength(22);
  expect(discoveredInSkill).toEqual(EXPECTED_TOOLS);

  for (const code of EXPECTED_ERROR_CODES) {
    expect(skill.body).toContain(code);
  }
  for (const term of [
    "canCancel",
    "canPrioritize",
    "nextCursor",
    "truncated",
    "omittedWithoutText",
    "hasMore",
    "agentId",
  ]) {
    expect(skill.body).toContain(term);
  }

  // The event tool is for the host. The skill explains subscribing without naming a tool Bots cannot call.
  expect(skill.body).not.toContain("session_events");
  for (const term of ['"type": "plugin"', '"plugin": "dsh-web"', "resourceIds", "actors", "<plugin_event>", "session.events_gap"]) {
    expect(skill.body).toContain(term);
  }

  const readme = restored.files!["README.md"]!;
  expect(readme).toContain("22");
  expect(readme).toContain("session_history");
  expect(readme).toContain("session_search");
});
