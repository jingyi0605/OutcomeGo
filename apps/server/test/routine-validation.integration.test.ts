import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { AppService } from "../src/app-service";
import { errorResponse } from "../src/http";
import { routineRoutes } from "../src/routes/routine";

const databaseUrl = process.env.OUTCOMEGO_TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "routine routes validate mutations and queue one-time advice without changing saved routines",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "routine-validation-"));
    const environment = {
      DATABASE_URL: databaseUrl,
      OUTCOMEGO_WORKSPACE_ROOT: root,
      OUTCOMEGO_AGENT_DATA_ROOT: join(root, "data"),
      OUTCOMEGO_ENFORCE_AUTOMATION_MINIMUM: "true",
    };
    const previous = Object.fromEntries(
      Object.keys(environment).map((key) => [key, process.env[key]])
    );
    Object.assign(process.env, environment);
    const app = new AppService();
    app.boss.send = async () => "test-job";
    const botId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const request = async (method: string, path: string, input: Record<string, unknown>) => {
      const req = new Request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: JSON.stringify({ clientId: crypto.randomUUID(), ...input }) }),
      });
      try {
        const response = await routineRoutes({
          app,
          request: req,
          path,
          url: new URL(req.url),
          authMode: "disabled",
          authenticatedSessionId: null,
        });
        if (!response) throw new Error(`Unmatched routine route: ${path}`);
        return response;
      } catch (error) {
        return errorResponse(error);
      }
    };
    try {
      await app.prisma.bot.create({
        data: {
          id: botId,
          name: "Routine validation",
          status: "active",
          defaultDirectory: root,
          conversation: { create: {} },
        },
      });
      await app.prisma.channel.create({
        data: {
          id: groupId,
          kind: "group",
          name: "Routine validation room",
          members: { create: { botId, ordinal: 0 } },
        },
      });
      await app.prisma.channel.create({ data: {
        id: channelId, kind: "bot_dm", name: "Routine validation chat", directKey: `bot:${botId}`,
        members: { create: { botId, ordinal: 0 } },
      } });
      await app.agentData.initializeBot(botId);

      for (const path of [`/api/bots/${botId}/routines`, `/api/channels/${groupId}/routines`]) {
        const input = {
          name: "Valid routine",
          prompt: "Check the fixture",
          schedule: "@every 5m",
          enabled: false,
        };
        const clientId = crypto.randomUUID();
        const created = await request("POST", path, { ...input, clientId });
        expect(created.status).toBe(201);
        const { id } = (await created.json()) as { id: string };
        const original = await app.prisma.routine.findUniqueOrThrow({ where: { id } });
        const initialCount = await app.prisma.routine.count();
        const retries = await Promise.all(
          Array.from({ length: 6 }, () => request("POST", path, { ...input, clientId }))
        );
        for (const retry of retries) {
          expect(retry.status).toBe(201);
          expect(await retry.json()).toMatchObject({ id });
        }
        expect(await app.prisma.routine.count()).toBe(initialCount);

        for (const trigger of [
          { type: "unknown" },
          { type: "group", listeners: [] },
          { type: "cron" },
          {
            type: "group",
            listeners: Array.from({ length: 9 }, () => ({ type: "cron", schedule: "@daily" })),
          },
        ]) {
          for (const [method, target] of [
            ["POST", path],
            ["PATCH", `/api/routines/${id}`],
          ] as const) {
            const rejected = await request(method, target, {
              ...input,
              schedule: undefined,
              trigger,
            });
            expect(rejected.status).toBe(400);
            expect(await rejected.json()).toMatchObject({
              error: { code: "invalid_routine_trigger" },
            });
          }
          expect(await app.prisma.routine.count()).toBe(initialCount);
          expect(await app.prisma.routine.findUniqueOrThrow({ where: { id } })).toEqual(original);
        }

        for (const [schedule, code] of [
          ["@every 1m", "routine_schedule_too_frequent"],
          ["*/2 * * * *", "routine_schedule_too_frequent"],
          ["@every 5m/5m", "invalid_routine_schedule"],
          ["61 9 * * *", "invalid_routine_schedule"],
          ["CRON_TZ=Not/A_Zone @daily", "invalid_routine_schedule"],
        ] as const) {
          for (const [method, target] of [
            ["POST", path],
            ["PATCH", `/api/routines/${id}`],
          ] as const) {
            const rejected = await request(method, target, {
              ...input,
              name: "Must not save",
              schedule,
            });
            expect(rejected.status).toBe(400);
            expect(await rejected.json()).toMatchObject({ error: { code } });
          }
          expect(await app.prisma.routine.count()).toBe(initialCount);
          expect(await app.prisma.routine.findUniqueOrThrow({ where: { id } })).toEqual(original);
          expect(await app.prisma.routineRevision.count({ where: { routineId: id } })).toBe(1);
        }
        for (const schedule of ["", "   "]) {
          const rejected = await request("POST", path, { ...input, schedule });
          expect(rejected.status).toBe(400);
          expect(await rejected.json()).toMatchObject({ error: { code: "invalid_routine" } });
        }
        const updated = await request("PATCH", `/api/routines/${id}`, {
          schedule: "@every 10m",
          expectedRevision: 1,
        });
        expect(updated.status).toBe(200);
        expect(await app.prisma.routine.findUniqueOrThrow({ where: { id } })).toMatchObject({
          scheduleText: "@every 10m",
          revision: 2,
        });
      }

      const runAt = new Date(Date.now() + 3_600_000).toISOString();
      const created = await request("POST", `/api/bots/${botId}/routines`, {
        name: "Prepare before a meeting", prompt: "Remind me of the meeting", enabled: true,
        trigger: { type: "once", runAt },
      });
      expect(created.status).toBe(201);
      const { id: onceId, revision } = await created.json() as { id: string; revision: number };
      const target = `/api/routines/${onceId}/prepare`;
      const original = await app.prisma.routine.findUniqueOrThrow({ where: { id: onceId } });
      expect((await request("POST", target, {})).status).toBe(400);
      expect((await request("POST", target, { expectedRevision: revision + 1 })).status).toBe(409);
      const accepted = await request("POST", target, { expectedRevision: revision });
      expect(accepted.status).toBe(202);
      const receipt = await accepted.json();
      expect(receipt).toMatchObject({ routineId: onceId, revision, kind: "preparation", status: "queued" });
      const history = await request("GET", `/api/routines/${onceId}/executions`, {});
      expect(await history.json()).toEqual([{ ...(receipt as object), result: { summary: null, delivered: false } }]);
      expect(await app.prisma.routine.findUniqueOrThrow({ where: { id: onceId } })).toEqual(original);
      const goals = await request("GET", "/api/outcomes/scheduled-goals", {});
      expect(await goals.json()).toContainEqual(expect.objectContaining({ id: onceId, runAt, state: "scheduled" }));
      const goalPath = `/api/outcomes/scheduled-goals/${onceId}`;
      expect(await (await request("GET", goalPath, {})).json()).toMatchObject({ id: onceId, executions: [{ kind: "preparation", status: "queued" }] });
      expect((await request("DELETE", `/api/routines/${onceId}`, { expectedRevision: revision })).status).toBe(200);
      expect(await (await request("GET", goalPath, {})).json()).toMatchObject({ id: onceId, state: "cancelled", executions: [{ kind: "preparation" }] });
    } finally {
      await app.prisma.channel.deleteMany({ where: { id: { in: [groupId, channelId] } } });
      await app.prisma.bot.deleteMany({ where: { id: botId } });
      await Effect.runPromise(app.close());
      for (const key of Object.keys(environment)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000
);
