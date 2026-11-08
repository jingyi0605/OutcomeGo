import type { AiTeamOSAuthUser } from "./auth";

/**
 * Account chrome shows the username as it was typed ("Raghav-P"); the login username is
 * its lowercase form. iOS shows the same name.
 */
export const accountName = (user: AiTeamOSAuthUser | null): string =>
  user?.name?.trim() || user?.username?.trim() || "Account";

export const accountInitials = (user: AiTeamOSAuthUser | null): string => {
  const name = user?.name?.trim() || user?.username?.trim();
  return name ? Array.from(name.toLocaleUpperCase()).slice(0, 2).join("") : "OT";
};
