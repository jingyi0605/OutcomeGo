import type { GroupTaskBoard, GroupTaskStatus, GroupTaskView } from "@outcomego/contracts";
import { clientErrorMessage } from "@outcomego/product-core/redaction";
import { CheckCircle2, Circle, Clock, MoreHorizontal, Pause, UserCircle2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../client/outcomego-api";
import { useI18n } from "../../lib/i18n";
import { arrangeGroupTasks } from "../../lib/group-tasks";
import { translateCurrent } from "../../lib/i18n-catalog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { ButtonPrimitive } from "../ui/button-primitive";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../../lib/cn";

/** The board refreshes while its panel is on screen; bots change it while the user watches. */
const REFRESH_MS = 5_000;

const STATUS_LABEL: Record<GroupTaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_CONFIG: Record<
  GroupTaskStatus,
  { icon: typeof Circle; color: string; bgColor: string; textColor: string }
> = {
  open: {
    icon: Circle,
    color: "text-slate-500",
    bgColor: "bg-slate-100 dark:bg-slate-800/50",
    textColor: "text-slate-700 dark:text-slate-300",
  },
  in_progress: {
    icon: Clock,
    color: "text-blue-500",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    textColor: "text-blue-700 dark:text-blue-300",
  },
  blocked: {
    icon: Pause,
    color: "text-amber-500",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    textColor: "text-amber-700 dark:text-amber-300",
  },
  done: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    textColor: "text-emerald-700 dark:text-emerald-300",
  },
  cancelled: {
    icon: XCircle,
    color: "text-slate-400",
    bgColor: "bg-slate-100 dark:bg-slate-800/50",
    textColor: "text-slate-500 dark:text-slate-400",
  },
};

export function GroupTasks({ channelId, active }: { channelId: string; active: boolean }) {
  const { t } = useI18n();
  // Kept with its channel so switching groups never shows the previous group's tasks.
  const [loaded, setLoaded] = useState<{ channelId: string; board: GroupTaskBoard } | null>(null);
  const board = loaded?.channelId === channelId ? loaded.board : null;
  const [includeClosed, setIncludeClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<GroupTaskView | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const next = await api.groupTasks(channelId, includeClosed, signal);
        if (signal.aborted) return;
        setLoaded({ channelId, board: next });
        setError(null);
      } catch (cause) {
        if (!signal.aborted) setError(clientErrorMessage(cause, translateCurrent("Couldn’t load tasks")));
      }
    },
    [channelId, includeClosed]
  );

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal);
    }, REFRESH_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active, load]);

  const act = async (task: GroupTaskView, action: "release" | "cancel") => {
    setPending(task.id);
    try {
      await api.actOnGroupTask(channelId, task.number, { action, expectedRevision: task.revision });
      setError(null);
    } catch (cause) {
      // Most often a bot changed the task first; the refresh below shows what it is now.
      setError(clientErrorMessage(cause, translateCurrent("Couldn’t update the task. It may have changed.")));
    } finally {
      setPending(null);
      await load(new AbortController().signal);
    }
  };

  const rows = useMemo(() => arrangeGroupTasks(board?.tasks ?? []), [board]);
  const unfinished = board ? board.counts.open + board.counts.in_progress + board.counts.blocked : 0;
  const finished = board ? board.counts.done + board.counts.cancelled : 0;

  return (
    <div className="space-y-3">
      {/* Stats and controls */}
      <div className="flex items-center justify-between">
        {board && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-blue-500" />
              {unfinished} {t("active")}
            </span>
            {finished > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  {finished} {t("completed")}
                </span>
              </>
            )}
          </div>
        )}
        <div className="flex-1" />
        {finished > 0 && (
          <ButtonPrimitive
            className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setIncludeClosed((value) => !value)}
            type="button"
          >
            {t(includeClosed ? "Hide finished" : "Show finished")}
          </ButtonPrimitive>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {board && rows.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 py-16">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
            <CheckCircle2 className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {includeClosed ? t("No tasks yet") : t("No active tasks")}
          </p>
          <p className="mt-1.5 max-w-[280px] text-center text-xs text-muted-foreground">
            {t("No tasks yet. Members register work here before they start it.")}
          </p>
        </div>
      )}

      {/* Task list */}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(({ task, depth }) => {
            const closed = task.status === "done" || task.status === "cancelled";
            const config = STATUS_CONFIG[task.status];
            const StatusIcon = config.icon;

            return (
              <div
                className={cn(
                  "group relative rounded-lg border bg-card transition-all hover:shadow-sm",
                  closed ? "border-border/50 bg-muted/20" : "border-border bg-card",
                  depth && "ml-8"
                )}
                key={task.id}
              >
                {/* Depth indicator line for subtasks */}
                {depth > 0 && (
                  <div className="absolute -left-4 top-0 h-full w-px bg-border" />
                )}

                <div className="flex items-start gap-3 p-3">
                  {/* Task number badge */}
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground">
                    {task.number}
                  </div>

                  {/* Task content */}
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Title */}
                    <div
                      className={cn(
                        "text-sm font-medium leading-snug",
                        closed ? "text-muted-foreground line-through" : "text-foreground"
                      )}
                      dir="auto"
                      title={task.title}
                    >
                      {task.title}
                    </div>

                    {/* Status and assignee row */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Status badge */}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                          config.bgColor,
                          config.textColor
                        )}
                      >
                        <StatusIcon className="size-3" />
                        {t(STATUS_LABEL[task.status])}
                      </span>

                      {/* Assignee */}
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <UserCircle2 className="size-3" />
                        {task.assignee ? task.assignee.name : t("Unowned")}
                      </span>
                    </div>

                    {/* Note/description */}
                    {task.status === "blocked" && task.note && (
                      <div
                        className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
                        dir="auto"
                      >
                        {t("Waiting: {note}", { note: task.note })}
                      </div>
                    )}
                    {task.status === "done" && task.note && (
                      <div className="line-clamp-2 text-xs text-muted-foreground" dir="auto">
                        {task.note}
                      </div>
                    )}
                  </div>

                  {/* Actions menu */}
                  {!closed && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <ButtonPrimitive
                          aria-label={t("Actions for task #{number}", { number: task.number })}
                          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:pointer-events-none"
                          disabled={pending === task.id}
                          type="button"
                        >
                          <MoreHorizontal className="size-4" />
                        </ButtonPrimitive>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        {task.assignee && (
                          <DropdownMenuItem onSelect={() => void act(task, "release")}>
                            {t("Release")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setCancelTarget(task)}
                        >
                          {t("Cancel task")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cancel confirmation dialog */}
      <AlertDialog onOpenChange={(open) => !open && setCancelTarget(null)} open={Boolean(cancelTarget)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Cancel task #{number}?", { number: cancelTarget?.number ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Its unfinished subtasks are cancelled with it, and members will stop working on it.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep task")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = cancelTarget;
                setCancelTarget(null);
                if (target) void act(target, "cancel");
              }}
            >
              {t("Cancel task")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
