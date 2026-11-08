import { describe, expect, test } from "bun:test";
import {
  bundledAiTeamOSMarketplace,
  AiTeamOSMarketplaceSource,
  parseAiTeamOSMarketplace,
} from "../src/plugins/aiteamos-marketplace";

describe("aiTeamOS marketplace", () => {
  test("ships a first-party, versioned marketplace without an external catalog", async () => {
    const source = new AiTeamOSMarketplaceSource(undefined, bundledAiTeamOSMarketplace);
    const plugins = await source.plugins();

    expect(plugins).toHaveLength(15);
    expect(plugins.find(plugin => plugin.key === "1password")?.components).toEqual(["skills"]);
    expect(plugins.map((plugin) => plugin.key)).not.toContain("aiteamos-utility-lab");
    expect(plugins.map((plugin) => plugin.key)).not.toContain("onedrive");
    expect(plugins.map((plugin) => plugin.key)).toContain("google-drive");
    expect(plugins.map((plugin) => plugin.key)).toContain("gmail");
    expect(plugins.map((plugin) => plugin.key)).toContain("google-docs");
    expect(plugins.map((plugin) => plugin.key)).toContain("google-sheets");
    expect(plugins.map((plugin) => plugin.key)).toContain("google-slides");
    expect(plugins.map((plugin) => plugin.key)).toContain("github");
    expect(plugins.map((plugin) => plugin.key)).toContain("slack");
    expect(plugins.map((plugin) => plugin.key)).toContain("notion");
    expect(plugins.map((plugin) => plugin.key)).toContain("linear");
    expect(plugins.map((plugin) => plugin.key)).toContain("plaid");
    expect(plugins.map((plugin) => plugin.key)).toContain("email");
    expect(plugins.map((plugin) => plugin.key)).not.toContain("atlassian");
    expect(plugins.map((plugin) => plugin.key)).not.toContain("asana");
    expect(plugins.map((plugin) => plugin.key)).not.toContain("research-playbook");
    expect(plugins.map((plugin) => plugin.key)).not.toContain("imessage-ssh");
    // Upstream packages pin their own revision; unpinned packages use the catalog revision.
    expect(plugins.map((plugin) => plugin.sourceRevision)).toEqual(
      bundledAiTeamOSMarketplace.plugins.map((plugin) => plugin.sourceRevision ?? bundledAiTeamOSMarketplace.revision)
    );
  });

  test("accepts a deployment-owned marketplace manifest", async () => {
    const packageDefinition = {
      key: "self-hosted-mail-room",
      version: "1.2.3",
      name: "Mail Room",
      description: "Work with a self-hosted mail MCP.",
      publisher: "Example Company",
      category: "Inbox & Collaboration",
      featured: false,
      components: ["mcp" as const],
      homepageUrl: null,
      sourceUrl: null,
      sourceRevision: null,
      logoUrl: null,
      setupFields: [{ key: "MAIL_TOKEN", label: "Mail token", required: true, secret: true }],
      skills: [],
      connections: [
        {
          key: "mail",
          name: "Mail Room",
          transport: "http" as const,
          auth: "token" as const,
          endpoint: "https://mcp.example.test",
          configuration: { headers: { Authorization: String.raw`Bearer \${MAIL_TOKEN}` } },
          tools: [],
        },
      ],
    };
    const manifest = parseAiTeamOSMarketplace({
      schemaVersion: 1,
      revision: "example-7",
      plugins: [packageDefinition],
    });
    const source = new AiTeamOSMarketplaceSource(undefined, manifest);

    expect(await source.plugins()).toEqual([
      expect.objectContaining({
        key: "self-hosted-mail-room",
        version: "1.2.3",
        sourceRevision: "example-7",
      }),
    ]);
  });

  test("rejects malformed or duplicate marketplace packages", () => {
    expect(() =>
      parseAiTeamOSMarketplace({ schemaVersion: 2, revision: "bad", plugins: [] })
    ).toThrow("schemaVersion");
    expect(() =>
      parseAiTeamOSMarketplace({
        schemaVersion: 1,
        revision: "duplicate",
        plugins: [bundledAiTeamOSMarketplace.plugins[0], bundledAiTeamOSMarketplace.plugins[0]],
      })
    ).toThrow("Duplicate plugin key");
  });
});

test("marketplace reads isolate mutable metadata and installation payload maps", async () => {
  const source = new AiTeamOSMarketplaceSource(undefined, bundledAiTeamOSMarketplace);
  const first = await source.plugins();
  const original = structuredClone(first);
  const files = first.find((plugin) => Object.keys(plugin.files ?? {}).length > 0)!.files!;
  const binaries = first.find((plugin) => Object.keys(plugin.binaryFiles ?? {}).length > 0)!.binaryFiles!;
  files[Object.keys(files)[0]!] = "changed";
  delete binaries[Object.keys(binaries)[0]!];
  first[0]!.components.length = 0;
  first.find((plugin) => plugin.connections.length > 0)!.connections[0]!.name = "changed";
  expect(await source.plugins()).toEqual(original);
});
