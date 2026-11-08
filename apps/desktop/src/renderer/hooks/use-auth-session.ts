import { useSyncExternalStore } from "react";
import { getAuthSnapshot, type AiTeamOSAuthSnapshot, subscribeAuthSnapshot } from "../client/auth";

export const useAuthSession = (): AiTeamOSAuthSnapshot =>
  useSyncExternalStore(subscribeAuthSnapshot, getAuthSnapshot, getAuthSnapshot);
