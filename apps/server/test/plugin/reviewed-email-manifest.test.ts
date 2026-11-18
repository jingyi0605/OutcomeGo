import { expect, test } from "bun:test";
import { createPrismaClient } from "@outcomego/db";
import { createPluginTemplate, parsePluginDefinition } from "@outcomego/plugin-sdk";
import { Effect } from "effect";
import { PluginService } from "../../src/services/plugin-service";
import { definitionFromManifest } from "../../src/services/plugin/values";
import { createReviewedEmailPlugin } from "./fixtures/reviewed-email-plugin";

for (const schemaVersion of [undefined, 1]) {
  test(`SDK manifest version ${schemaVersion ?? "implicit"} retains MCP and skill components`, () => {
    for (const mode of ["remote-mcp", "packaged-mcp", "skills", "hybrid"] as const) {
      const plugin = createPluginTemplate(mode, `manifest-${mode}`);
      if (schemaVersion === undefined) delete plugin.schemaVersion;
      const persisted = JSON.parse(JSON.stringify(parsePluginDefinition(plugin)));
      expect(definitionFromManifest(persisted)).toEqual(plugin);
      expect(persisted.components).toEqual(plugin.components);
    }
  });
}

test("SDK rejects unsupported versions and incomplete fixture manifests", () => {
  const plugin = createReviewedEmailPlugin("manifest-mail");
  expect(() => parsePluginDefinition({ ...plugin, schemaVersion: 2 }))
    .toThrow("Unsupported plugin schema version");
  const { components, ...incomplete } = plugin;
  expect(() => parsePluginDefinition(incomplete))
    .toThrow("Plugin must declare connections, skills, and components");
  expect(components).toEqual(["mcp"]);
});

test("reviewed email fixtures preserve their host-only send contract through persistence", () => {
  const plugin = createReviewedEmailPlugin("manifest-mail");
  const persisted = JSON.parse(JSON.stringify(plugin));
  expect(parsePluginDefinition(persisted)).toEqual(plugin);
  expect(plugin).toMatchObject({
    schemaVersion: 1, key: "manifest-mail", name: "Mail", publisher: "Test",
    components: ["mcp"], skills: [],
    connections: [{
      key: "email", name: "Mail", transport: "stdio", auth: "none", endpoint: "",
      drafts: { platform: "email", tool: "send_reviewed_email" },
    }],
  });
  expect(plugin.connections[0]!.configuration?.command).toBe("bun");
  expect(plugin.files?.["connector/server.mjs"]).toBeDefined();
});

test.skipIf(!process.env.OUTCOMEGO_TEST_DATABASE_URL)(
  "a persisted reviewed-email fixture remains visible alongside an OAuth installation",
  async () => {
    const db = createPrismaClient(process.env.OUTCOMEGO_TEST_DATABASE_URL!);
    const mail = createReviewedEmailPlugin(`manifest-mail-${crypto.randomUUID()}`);
    const oauth = createPluginTemplate("remote-mcp", `manifest-oauth-${crypto.randomUUID()}`);
    oauth.connections[0]!.auth = "oauth";
    const service = new PluginService(db);
    Object.assign(service, { catalog: async () => [] });
    try {
      for (const plugin of [mail, oauth]) {
        await db.pluginInstallation.create({ data: {
          pluginKey: plugin.key, name: plugin.name, publisher: plugin.publisher,
          version: plugin.version, manifest: JSON.parse(JSON.stringify(plugin)),
        } });
      }
      const settings = await Effect.runPromise(service.settings());
      for (const plugin of [mail, oauth]) {
        const install = settings.installs.find(row => row.pluginKey === plugin.key)!;
        expect(install.catalog?.components).toEqual(["mcp"]);
        expect(install.hasSkills).toBe(false);
      }
      expect(await db.pluginInstallation.findUniqueOrThrow({ where: { pluginKey: mail.key } }))
        .toMatchObject({ manifest: mail });
    } finally {
      await service.close();
      await db.pluginInstallation.deleteMany({
        where: { pluginKey: { in: [mail.key, oauth.key] } },
      });
      await db.$disconnect();
    }
  }
);
