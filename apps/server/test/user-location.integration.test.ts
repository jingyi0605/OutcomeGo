import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "pg";
import { createPrismaClient } from "@outcomego/db";
import { UserLocationService } from "../src/services/user-location";

const url = process.env.OUTCOMEGO_TEST_DATABASE_URL;
const fix = {
  latitude: 1.3,
  longitude: 103.8,
  accuracyMeters: 25,
  capturedAt: "2026-11-17T01:00:00Z",
  device: "phone" as const,
};

describe.skipIf(!url)("account-owned location on disposable PostgreSQL", () => {
  const name = `outcomego_location_service_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let admin: Client;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: UserLocationService;

  beforeAll(async () => {
    admin = new Client({ connectionString: url! });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const deploy = Bun.spawn(["bun", "scripts/deploy-schema.ts"], {
      cwd: join(import.meta.dir, "../../../packages/db"),
      env: { ...process.env, DATABASE_URL: target.toString(), NODE_OPTIONS: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      deploy.exited,
      new Response(deploy.stdout).text(),
      new Response(deploy.stderr).text(),
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    prisma = createPrismaClient(target.toString());
    service = new UserLocationService(prisma, "required", () => true);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  });

  const account = async () => {
    const id = crypto.randomUUID();
    await prisma.user.create({
      data: { id, name: "Location fixture", email: `${id}@example.test` },
    });
    const session = await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId: id,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const initial = await service.read(session.id);
    const enabled = await service.updateSharing(session.id, {
      enabled: true,
      expectedRevision: initial.sharing.revision,
    });
    return { id, sessionId: session.id, revision: enabled.sharing.revision };
  };

  test("accounts cannot read or submit one another's location revision", async () => {
    const a = await account(),
      b = await account();
    await service.write(a.sessionId, { fix, sharingRevision: a.revision });
    expect((await service.read(a.sessionId)).location).toMatchObject({ latitude: 1.3 });
    expect((await service.read(b.sessionId)).location).toMatchObject({ available: false });
    await expect(
      service.write(b.sessionId, { fix, sharingRevision: a.revision })
    ).rejects.toMatchObject({ code: "location_sharing_changed" });
    await service.clear(b.sessionId);
    expect((await service.read(a.sessionId)).location).toMatchObject({ latitude: 1.3 });
    // Multiple users are outside the existing single-owner bot model: fail closed.
    expect(await service.readForTool()).toMatchObject({ available: false });
  });

  test("clear/re-enable fences stale writes and stale enable requests, including concurrent completion", async () => {
    const a = await account();
    await Promise.allSettled([
      service.write(a.sessionId, { fix, sharingRevision: a.revision }),
      service.clear(a.sessionId),
    ]);
    const cleared = await service.read(a.sessionId);
    expect(cleared).toMatchObject({ sharing: { enabled: false }, location: { available: false } });
    expect(
      await prisma.userLocation.findUnique({ where: { ownerKey: `user:${a.id}` } })
    ).toMatchObject({
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      capturedAt: null,
      device: null,
    });
    await expect(
      service.write(a.sessionId, { fix, sharingRevision: a.revision })
    ).rejects.toMatchObject({ code: "location_sharing_changed" });
    await expect(
      service.updateSharing(a.sessionId, { enabled: true, expectedRevision: a.revision })
    ).rejects.toMatchObject({ code: "location_sharing_changed" });
    const enabled = await service.updateSharing(a.sessionId, {
      enabled: true,
      expectedRevision: cleared.sharing.revision,
    });
    await expect(
      service.write(a.sessionId, { fix, sharingRevision: a.revision })
    ).rejects.toThrow();
    await service.write(a.sessionId, { fix, sharingRevision: enabled.sharing.revision });
    expect((await service.read(a.sessionId)).location).toMatchObject({ latitude: 1.3 });
  });

  test("a revoked or expired session cannot finish a pending location write", async () => {
    const a = await account();
    await service.write(a.sessionId, { fix, sharingRevision: a.revision });
    await prisma.session.delete({ where: { id: a.sessionId } });
    await service.revokeOwner(a.id);
    await expect(
      service.write(a.sessionId, { fix, sharingRevision: a.revision })
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(
      await prisma.userLocation.findUnique({ where: { ownerKey: `user:${a.id}` } })
    ).toMatchObject({ sharingEnabled: false, latitude: null });
    const b = await account();
    await prisma.session.update({ where: { id: b.sessionId }, data: { expiresAt: new Date(0) } });
    await expect(service.read(b.sessionId)).rejects.toMatchObject({ code: "unauthorized" });
  });

  test("message transaction rollback also rolls back a fix; future timestamps are clamped", async () => {
    const a = await account();
    await expect(
      prisma.$transaction(async (tx) => {
        await service.record(tx, a.sessionId, { fix, sharingRevision: a.revision });
        throw new Error("message acceptance failed");
      })
    ).rejects.toThrow("message acceptance failed");
    expect((await service.read(a.sessionId)).location).toMatchObject({ available: false });
    const before = Date.now();
    const result = await service.write(a.sessionId, {
      fix: { ...fix, capturedAt: "2099-01-01T00:00:00Z" },
      sharingRevision: a.revision,
    });
    expect(result).toHaveProperty("capturedAt");
    if (!("capturedAt" in result)) throw new Error("Missing fix");
    expect(Date.parse(result.capturedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(result.capturedAt)).toBeLessThanOrEqual(Date.now());
  });

  test("auth-disabled mode uses only its local owner namespace", async () => {
    const local = new UserLocationService(prisma, "disabled", () => true);
    const initial = await local.read(null);
    const enabled = await local.updateSharing(null, {
      enabled: true,
      expectedRevision: initial.sharing.revision,
    });
    await local.write(null, { fix, sharingRevision: enabled.sharing.revision });
    expect(await local.readForTool()).toMatchObject({ latitude: 1.3 });
    await local.clear(null);
    expect(await local.readForTool()).toMatchObject({ available: false });
  });
});
