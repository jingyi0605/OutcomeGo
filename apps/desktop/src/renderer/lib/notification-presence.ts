import {
  NOTIFICATION_HEARTBEAT_MS,
  type NotificationPresenceInput,
} from "@aiteamos/contracts/notification-presence";

export interface DesktopActivity {
  active: boolean;
  idleSeconds: number;
}

export type DesktopNotificationPlatform = "macos" | "windows";

/** Each mount has its own lease. Releases outrank any heartbeat already in flight. */
export function startNotificationPresence(options: {
  platform: DesktopNotificationPlatform;
  activity: () => Promise<DesktopActivity>;
  send: (input: NotificationPresenceInput) => Promise<unknown>;
  release: (input: NotificationPresenceInput) => void;
  subscribe: (changed: () => void) => () => void;
  intervalMs?: number;
}) {
  const clientId = crypto.randomUUID();
  let sequence = 0;
  let stopped = false;
  const report = async () => {
    // Allocate before reading native state: a late sample must not win a newer transition.
    const revision = ++sequence;
    try {
      const activity = await options.activity();
      if (stopped || revision !== sequence) return;
      await options.send({ clientId, sequence: revision, platform: options.platform, ...activity });
    } catch {
      /* Presence expires; it must never interrupt ordinary client sync. */
    }
  };
  const unsubscribe = options.subscribe(() => void report());
  const timer = setInterval(() => void report(), options.intervalMs ?? NOTIFICATION_HEARTBEAT_MS);
  void report();
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    unsubscribe();
    options.release({ clientId, sequence: ++sequence, platform: options.platform, active: false });
  };
}
