import { randomUUID } from "node:crypto";
import { ApiError } from "@outcomego/contracts";
import {
  userLocationEnabled,
  userLocationToolResult,
  unavailableUserLocation,
  type LocationSubmission,
  type UpdateLocationSharingInput,
  type UserLocationState,
} from "@outcomego/contracts/user-location";
import type { Prisma, PrismaClient } from "@outcomego/db";

const clearedFix = {
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  capturedAt: null,
  device: null,
};

/** Sharing is scoped by authenticated user within this deployment, never by request data. */
export class UserLocationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly authMode: "required" | "disabled" = "required",
    private readonly enabled = () => userLocationEnabled(process.env.OUTCOMEGO_LOCATION_ENABLED)
  ) {}

  private requireEnabled() {
    if (!this.enabled())
      throw new ApiError(
        404,
        "location_disabled",
        "Location sharing is not enabled on this server"
      );
  }

  private async owner(tx: Prisma.TransactionClient, sessionId: string | null): Promise<string> {
    if (this.authMode === "disabled") return "local";
    // Keep sign-out ordered with acceptance. Existing Session timestamps are stored as UTC without TZ.
    const sessions = await tx.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "outcomego_session"
      WHERE "id" = ${sessionId}
        AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`;
    if (!sessions[0])
      throw new ApiError(401, "unauthorized", "A current OutcomeGo session is required");
    return `user:${sessions[0].userId}`;
  }

  private async lock(tx: Prisma.TransactionClient, ownerKey: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outcomego:user-location:${ownerKey}`}))`;
  }

  private state(tx: Prisma.TransactionClient, ownerKey: string) {
    return tx.userLocation.upsert({
      where: { ownerKey },
      create: { ownerKey, sharingRevision: randomUUID() },
      update: {},
    });
  }

  read = (sessionId: string | null): Promise<UserLocationState> => {
    this.requireEnabled();
    return this.prisma.$transaction(async (tx) => {
      const ownerKey = await this.owner(tx, sessionId);
      await this.lock(tx, ownerKey);
      const row = await this.state(tx, ownerKey);
      return {
        sharing: { enabled: row.sharingEnabled, revision: row.sharingRevision },
        location: userLocationToolResult(row.sharingEnabled ? row : null),
      };
    });
  };

  updateSharing = (sessionId: string | null, input: UpdateLocationSharingInput) => {
    this.requireEnabled();
    return this.prisma.$transaction(async (tx) => {
      const ownerKey = await this.owner(tx, sessionId);
      await this.lock(tx, ownerKey);
      const row = await this.state(tx, ownerKey);
      if (row.sharingRevision !== input.expectedRevision)
        throw new ApiError(
          409,
          "location_sharing_changed",
          "Location sharing changed; read its current state before retrying"
        );
      const updated = await tx.userLocation.update({
        where: { ownerKey },
        data: { sharingEnabled: input.enabled, sharingRevision: randomUUID(), ...clearedFix },
      });
      return {
        sharing: { enabled: updated.sharingEnabled, revision: updated.sharingRevision },
        location: unavailableUserLocation(),
      };
    });
  };

  /** Keep a new-revision tombstone rather than delete and admit a late write. */
  clear = (sessionId: string | null) => {
    this.requireEnabled();
    return this.prisma.$transaction(async (tx) =>
      this.clearOwner(tx, await this.owner(tx, sessionId))
    );
  };

  private async clearOwner(tx: Prisma.TransactionClient, ownerKey: string) {
    await this.lock(tx, ownerKey);
    const data = { sharingEnabled: false, sharingRevision: randomUUID(), ...clearedFix };
    const row = await tx.userLocation.upsert({
      where: { ownerKey },
      create: { ownerKey, ...data },
      update: data,
    });
    return {
      sharing: { enabled: false, revision: row.sharingRevision },
      location: unavailableUserLocation(),
    };
  }

  /** Called after successful auth sign-out with the server's previously verified user id. */
  revokeOwner = async (userId: string) => {
    if (this.enabled())
      await this.prisma.$transaction((tx) => this.clearOwner(tx, `user:${userId}`));
  };

  write = (sessionId: string | null, input: LocationSubmission) => {
    this.requireEnabled();
    return this.prisma.$transaction((tx) => this.record(tx, sessionId, input));
  };

  /** Acceptance uses the message transaction, so stale location rolls the message back too. */
  record = async (
    tx: Prisma.TransactionClient,
    sessionId: string | null,
    input: LocationSubmission
  ) => {
    this.requireEnabled();
    const ownerKey = await this.owner(tx, sessionId);
    await this.lock(tx, ownerKey);
    const row = await this.state(tx, ownerKey);
    if (!row.sharingEnabled || row.sharingRevision !== input.sharingRevision)
      throw new ApiError(
        409,
        "location_sharing_changed",
        "Location sharing ended or changed while preparing this request"
      );
    const fix = input.fix;
    const updated = await tx.userLocation.update({
      where: { ownerKey },
      data: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyMeters: fix.accuracyMeters ?? null,
        capturedAt: new Date(Math.min(Date.parse(fix.capturedAt), Date.now())),
        device: fix.device,
      },
    });
    return userLocationToolResult(updated);
  };

  /** Bots belong to the deployment owner; never select an arbitrary user in a multi-user DB. */
  readForTool = async () => {
    this.requireEnabled();
    let ownerKey = "local";
    if (this.authMode === "required") {
      const users = await this.prisma.user.findMany({ select: { id: true }, take: 2 });
      if (users.length !== 1)
        return unavailableUserLocation("A single deployment owner could not be identified.");
      ownerKey = `user:${users[0]!.id}`;
    }
    const row = await this.prisma.userLocation.findUnique({ where: { ownerKey } });
    return userLocationToolResult(row?.sharingEnabled ? row : null);
  };
}
