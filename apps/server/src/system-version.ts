import type { SystemVersionView } from "@aiteamos/contracts";
import {
  defaultAiTeamOSCompatibilityWindow,
  isAiTeamOSVersion,
  AITEAMOS_API_PROTOCOL_VERSION,
} from "@aiteamos/contracts/version-compatibility";

export { AITEAMOS_API_PROTOCOL_VERSION };
const FALLBACK_RELEASE_VERSION = "0.0.0";

const releaseVersionFrom = (environment: NodeJS.ProcessEnv): string => {
  const candidate = environment.AITEAMOS_VERSION?.trim();
  return candidate && isAiTeamOSVersion(candidate) ? candidate : FALLBACK_RELEASE_VERSION;
};

export const systemVersion = (environment: NodeJS.ProcessEnv = process.env): SystemVersionView => {
  const releaseVersion = releaseVersionFrom(environment);
  const compatibilityWindow = defaultAiTeamOSCompatibilityWindow(releaseVersion) ?? {
    minimum: releaseVersion,
    maximumExclusive: releaseVersion,
  };
  const minimumClientVersion = environment.AITEAMOS_MIN_CLIENT_VERSION?.trim();
  const maximumClientVersionExclusive = environment.AITEAMOS_MAX_CLIENT_VERSION_EXCLUSIVE?.trim();
  const recommendedClientVersion = environment.AITEAMOS_RECOMMENDED_CLIENT_VERSION?.trim();
  const updateChannel = environment.AITEAMOS_UPDATE_CHANNEL === "beta" ? "beta" : "stable";
  return {
    releaseVersion,
    apiProtocolVersion: AITEAMOS_API_PROTOCOL_VERSION,
    minimumClientVersion:
      minimumClientVersion && isAiTeamOSVersion(minimumClientVersion)
        ? minimumClientVersion
        : compatibilityWindow.minimum,
    maximumClientVersionExclusive:
      maximumClientVersionExclusive && isAiTeamOSVersion(maximumClientVersionExclusive)
        ? maximumClientVersionExclusive
        : compatibilityWindow.maximumExclusive,
    recommendedClientVersion:
      recommendedClientVersion && isAiTeamOSVersion(recommendedClientVersion)
        ? recommendedClientVersion
        : releaseVersion,
    updateChannel,
  };
};
