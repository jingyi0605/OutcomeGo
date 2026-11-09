import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../client/aiteamos-api";
import { API_BASE } from "../client/http";
import { translateCurrent } from "../lib/i18n-catalog";
import { readServerUpdateSnapshot, saveServerUpdateSnapshot } from "../lib/server-update-cache";
import { isAiTeamOSVersion } from "@aiteamos/contracts/version-compatibility";
import { isWindowActive } from "../lib/window-visibility";
import { useWindowActive } from "./use-window-active";

const manualCommand = (targetVersion: string | null) =>
  targetVersion && isAiTeamOSVersion(targetVersion)
    ? `aiteamos update --version ${targetVersion}`
    : "aiteamos update";

const unavailableStatus = (targetVersion: string | null): AiTeamOSServerUpdateStatus => ({
  serverUrl: API_BASE,
  currentVersion: null,
  targetVersion,
  apiProtocolVersion: null,
  minimumClientVersion: null,
  maximumClientVersionExclusive: null,
  recommendedClientVersion: null,
  updaterAvailable: false,
  status: "unavailable",
  phase: null,
  message: translateCurrent(
    "Run aiteamos update once on this server to enable updates from the app."
  ),
  manualCommand: manualCommand(targetVersion),
  jobId: null,
  safeToCloseDesktop: false,
});

export function useServerUpdateStatus(targetVersion: string | null) {
  const windowActive = useWindowActive();
  const [view, setView] = useState(() => {
    const cached = readServerUpdateSnapshot(API_BASE, localStorage);
    return {
      status: cached?.status ?? (null as AiTeamOSServerUpdateStatus | null),
      loading: !cached,
      reconnecting: Boolean(cached),
      startedAt: cached?.startedAt ?? null,
      observedAt: cached?.observedAt ?? (null as number | null),
    };
  });
  const inFlight = useRef(false);
  const posting = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    saveServerUpdateSnapshot(
      API_BASE,
      view.status && view.observedAt !== null
        ? { status: view.status, observedAt: view.observedAt, startedAt: view.startedAt }
        : null,
      localStorage
    );
  }, [view.status, view.observedAt, view.startedAt]);

  const refresh = useCallback(async () => {
    if (inFlight.current || posting.current) return;
    inFlight.current = true;
    const requestGeneration = generation.current;
    try {
      const [release, update] = await Promise.all([
        api.systemVersion().catch(() => null),
        api.serverUpdateStatus().catch(() => null),
      ]);
      if (requestGeneration !== generation.current) return;
      setView((previous) => {
        if (!release && !update && previous.status)
          return { ...previous, loading: false, reconnecting: true };
        const keepProgress =
          previous.status?.status === "updating" &&
          (!update || (!release && update.status === "updated"));
        const next = {
          ...unavailableStatus(targetVersion),
          ...(keepProgress ? previous.status : update),
        };
        // The host assigns its own job ID after the API queues the request.
        const sameJob =
          next.targetVersion === previous.status?.targetVersion &&
          (next.jobId === previous.status?.jobId ||
            ["checking", "queued"].includes(previous.status?.phase ?? ""));
        return {
          status: {
            ...next,
            currentVersion: release?.releaseVersion ?? previous.status?.currentVersion ?? null,
            apiProtocolVersion:
              release?.apiProtocolVersion ?? previous.status?.apiProtocolVersion ?? null,
            minimumClientVersion:
              release?.minimumClientVersion ?? previous.status?.minimumClientVersion ?? null,
            maximumClientVersionExclusive:
              release?.maximumClientVersionExclusive ??
              previous.status?.maximumClientVersionExclusive ??
              null,
            recommendedClientVersion:
              release?.recommendedClientVersion ??
              previous.status?.recommendedClientVersion ??
              null,
            targetVersion: update?.targetVersion ?? targetVersion,
            message:
              release || previous.status?.currentVersion
                ? next.message
                : translateCurrent("Could not verify the connected server. Reconnecting…"),
          },
          loading: false,
          reconnecting: !release || !update,
          startedAt: sameJob ? previous.startedAt : null,
          observedAt: update && !keepProgress ? Date.now() : previous.observedAt,
        };
      });
    } finally {
      inFlight.current = false;
    }
  }, [targetVersion]);

  const updateServer = useCallback(async (version: string) => {
    posting.current = true;
    generation.current++;
    try {
      const next = await api.updateServer(version);
      setView((previous) => ({
        ...previous,
        status: { ...unavailableStatus(version), ...previous.status, ...next },
        loading: false,
        reconnecting: false,
        startedAt: Date.now(),
        observedAt: Date.now(),
      }));
    } finally {
      posting.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refresh]);

  useEffect(() => {
    if (!windowActive && view.status?.status !== "updating") return;
    const interval = window.setInterval(
      () => {
        // An update already in progress must remain observable in the background.
        if (view.status?.status === "updating" || isWindowActive()) void refresh();
      },
      view.status?.status === "updating" ? 1_500 : view.reconnecting ? 5_000 : 60_000
    );
    return () => window.clearInterval(interval);
  }, [refresh, view.status?.status, view.reconnecting, windowActive]);

  return { ...view, refresh, updateServer };
}
