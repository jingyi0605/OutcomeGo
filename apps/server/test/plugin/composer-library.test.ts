import { expect, test } from "bun:test";
import type { PrismaClient } from "@outcomego/db";
import { Effect } from "effect";
import { PluginQueries } from "../../src/services/plugin/queries";

test("the composer preserves scoped legacy skills alongside the shared file library", async () => {
  const legacy = { id: "legacy-id", name: "Legacy skill" };
  const shared = { id: "shared-id", slug: "shared-skill", name: "Shared skill", description: "", body: "", files: {} };
  const prisma = {
    pluginConnection: { findMany: async () => [] },
    pluginInstallation: { findMany: async () => [] },
    pluginPrivateSkill: {
      findMany: async (args: unknown) => {
        expect(args).toEqual({ where: { enabledBotIds: { array_contains: ["bot-id"] } } });
        return [legacy];
      },
    },
  } as unknown as PrismaClient;
  const queries = new PluginQueries(prisma, async () => [], async () => undefined, "http://localhost", {
    listSkills: async () => [shared],
  });
  expect((await Effect.runPromise(queries.composer("bot-id"))).items).toEqual([
    { id: "legacy-id", label: "Legacy skill", handle: "private:legacy-skill", trigger: "/", kind: "skill", status: "ready" },
    { id: "shared-id", label: "Shared skill", handle: "shared-skill", trigger: "/", kind: "skill", status: "ready" },
  ]);
  const withoutLibrary = new PluginQueries(prisma, async () => [], async () => undefined, "http://localhost");
  expect((await Effect.runPromise(withoutLibrary.composer("bot-id"))).items).toHaveLength(1);
});
