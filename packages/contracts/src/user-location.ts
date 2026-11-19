import { Schema } from "effect";

export const USER_LOCATION_FEATURE_FLAG = "OUTCOMEGO_LOCATION_ENABLED";
export const userLocationEnabled = (value: string | undefined): boolean => value === "1";

/** A device fix; identity always comes from the authenticated server session. */
export const DeviceLocation = Schema.Struct({
  latitude: Schema.Number.pipe(Schema.between(-90, 90)),
  longitude: Schema.Number.pipe(Schema.between(-180, 180)),
  accuracyMeters: Schema.optional(Schema.Number.pipe(Schema.between(0, 10_000_000))),
  capturedAt: Schema.String.pipe(
    Schema.pattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/),
    Schema.filter((value) => Number.isFinite(Date.parse(value)))
  ),
  device: Schema.Literal("phone", "computer"),
});
export type DeviceLocation = typeof DeviceLocation.Type;

/** The revision prevents a delayed fix from surviving an opt-out/re-enable cycle. */
export const LocationSubmission = Schema.Struct({
  fix: DeviceLocation,
  sharingRevision: Schema.UUID,
});
export type LocationSubmission = typeof LocationSubmission.Type;

export const UpdateLocationSharingInput = Schema.Struct({
  enabled: Schema.Boolean,
  expectedRevision: Schema.UUID,
});
export type UpdateLocationSharingInput = typeof UpdateLocationSharingInput.Type;

export const UserLocation = Schema.Struct({
  ...DeviceLocation.fields,
  ageMinutes: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export type UserLocation = typeof UserLocation.Type;
export type UserLocationView = UserLocation | { available: false; reason: string };
export interface UserLocationState {
  sharing: { enabled: boolean; revision: string };
  location: UserLocationView;
}

export const GET_USER_LOCATION_TOOL = {
  name: "GetUserLocation",
  description:
    "Read the deployment owner's latest shared phone or computer location. Returns latitude, longitude, optional accuracyMeters, capturedAt, ageMinutes and device, or available:false. This is a saved fix, not live tracking or a confirmed address. Explain stale or coarse fixes and never infer street-level precision. Sharing must be explicitly enabled; if no location is available, ask where the user is.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
} as const;

export const unavailableUserLocation = (
  reason = "No location is currently shared."
): UserLocationView => ({ available: false, reason });

export const userLocationToolResult = (
  stored: {
    latitude: number | null;
    longitude: number | null;
    accuracyMeters: number | null;
    capturedAt: Date | null;
    device: string | null;
  } | null,
  now = new Date()
): UserLocationView =>
  stored?.latitude != null &&
  stored.longitude != null &&
  stored.capturedAt &&
  (stored.device === "phone" || stored.device === "computer")
    ? {
        latitude: stored.latitude,
        longitude: stored.longitude,
        ...(stored.accuracyMeters == null
          ? {}
          : { accuracyMeters: Math.round(stored.accuracyMeters) }),
        capturedAt: stored.capturedAt.toISOString(),
        ageMinutes: Math.max(0, Math.round((now.getTime() - stored.capturedAt.getTime()) / 60_000)),
        device: stored.device,
      }
    : unavailableUserLocation();
