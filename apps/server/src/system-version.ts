import type { SystemVersionView } from "@outcomego/contracts";
import {
  defaultOutcomeGoCompatibilityWindow,
  isOutcomeGoVersion,
  OUTCOMEGO_API_PROTOCOL_VERSION,
} from "@outcomego/contracts/version-compatibility";

export { OUTCOMEGO_API_PROTOCOL_VERSION };
const FALLBACK_RELEASE_VERSION = "0.0.0";

const releaseVersionFrom = (environment: NodeJS.ProcessEnv): string => {
  const candidate = environment.OUTCOMEGO_VERSION?.trim();
  return candidate && isOutcomeGoVersion(candidate) ? candidate : FALLBACK_RELEASE_VERSION;
};

export const systemVersion = (environment: NodeJS.ProcessEnv = process.env): SystemVersionView => {
  const releaseVersion = releaseVersionFrom(environment);
  const compatibilityWindow = defaultOutcomeGoCompatibilityWindow(releaseVersion) ?? {
    minimum: releaseVersion,
    maximumExclusive: releaseVersion,
  };
  const minimumClientVersion = environment.OUTCOMEGO_MIN_CLIENT_VERSION?.trim();
  const maximumClientVersionExclusive = environment.OUTCOMEGO_MAX_CLIENT_VERSION_EXCLUSIVE?.trim();
  const recommendedClientVersion = environment.OUTCOMEGO_RECOMMENDED_CLIENT_VERSION?.trim();
  const updateChannel = environment.OUTCOMEGO_UPDATE_CHANNEL === "beta" ? "beta" : "stable";
  return {
    releaseVersion,
    apiProtocolVersion: OUTCOMEGO_API_PROTOCOL_VERSION,
    minimumClientVersion:
      minimumClientVersion && isOutcomeGoVersion(minimumClientVersion)
        ? minimumClientVersion
        : compatibilityWindow.minimum,
    maximumClientVersionExclusive:
      maximumClientVersionExclusive && isOutcomeGoVersion(maximumClientVersionExclusive)
        ? maximumClientVersionExclusive
        : compatibilityWindow.maximumExclusive,
    recommendedClientVersion:
      recommendedClientVersion && isOutcomeGoVersion(recommendedClientVersion)
        ? recommendedClientVersion
        : releaseVersion,
    updateChannel,
  };
};
