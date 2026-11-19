import { useEffect } from "react";
import { toast } from "sonner";
import { useI18n } from "../lib/i18n";
import { subscribeOutcomeThreadEvents } from "../lib/outcome-thread";

/** Tells the owner when a goal's bot has answered, wherever they are in the app. */
export function useOutcomeThreadNotices() {
  const { t } = useI18n();
  useEffect(
    () =>
      subscribeOutcomeThreadEvents(({ status, title }) => {
        if (status === "completed")
          toast.success(t("The bot replied about “{title}”. Open the goal to read it.", { title }));
        else if (status === "failed")
          toast.error(t("The bot couldn’t finish working on “{title}”. Open the goal to try again.", { title }));
      }),
    [t]
  );
}
