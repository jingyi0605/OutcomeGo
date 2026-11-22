import type { ReplyPreview } from "@outcomego/contracts";
import { useEffect, useState } from "react";
import { api } from "../client/outcomego-api";

export function useReplyPreview(channelId: string | null): ReplyPreview | null {
  const [state, setState] = useState<{ channelId: string; preview: ReplyPreview } | null>(null);
  useEffect(() => {
    setState(null);
    if (!channelId) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const poll = async (after = ""): Promise<void> => {
      try {
        const snapshot = await api.pollReplyPreview(channelId, after, controller.signal);
        if (controller.signal.aborted) return;
        if (snapshot.revision !== after)
          setState(snapshot.preview ? { channelId, preview: snapshot.preview } : null);
        void poll(snapshot.revision);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState(null);
        if ((error as { status?: number })?.status !== 404)
          retry = setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [channelId]);
  return state?.channelId === channelId ? state.preview : null;
}
