import { expect, test } from "bun:test";
import { Effect } from "effect";
import { outcomeRoutes } from "../src/routes/outcome";
import type { RouteContext } from "../src/routes/context";

test("the authenticated Outcome dispatcher reads a real revision without invoking any write method", async () => {
  let seen: unknown;
  const id = "00000000-0000-4000-8000-000000000001", path = `/api/outcomes/${id}/revisions/1`;
  const context = {
    path, request: new Request(`http://localhost${path}`), url: new URL(`http://localhost${path}`), authMode: "disabled",
    app: { prisma: { outcome: { findFirst: async () => ({ id }) } },
      outcomes: { getRevision: (outcomeId: string, revision: number) => { seen = { outcomeId, revision }; return Effect.succeed({ id: "historical", criteria: [] }); } } },
  } as unknown as RouteContext;
  expect(await (await outcomeRoutes(context))?.json()).toEqual({ id: "historical", criteria: [] });
  expect(seen).toEqual({ outcomeId: id, revision: 1 });
});
