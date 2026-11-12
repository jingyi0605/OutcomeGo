import { useSyncExternalStore } from "react";
import { getAuthSnapshot, type OutcomeGoAuthSnapshot, subscribeAuthSnapshot } from "../client/auth";

export const useAuthSession = (): OutcomeGoAuthSnapshot =>
  useSyncExternalStore(subscribeAuthSnapshot, getAuthSnapshot, getAuthSnapshot);
