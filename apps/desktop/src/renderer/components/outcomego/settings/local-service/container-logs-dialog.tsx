import { Check, Copy, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import type { LocalContainerLogs } from "../../../../lib/local-deploy-contract";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/tooltip";
import { settingsInput, settingsSelect } from "../ui";
import { IconActionButton } from "./icon-action-button";

const TAIL_OPTIONS = [100, 200, 500] as const;

export function ContainerLogsDialog({
  open,
  onOpenChange,
  service,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: string | null;
}) {
  const { t } = useI18n();
  const [tail, setTail] = useState<number>(200);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LocalContainerLogs | null>(null);
  const [copied, setCopied] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!service || !window.outcomego?.localServer?.logs) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.outcomego.localServer.logs({ service, tail });
      setData(result);
    } catch {
      setError(t("Unable to load container logs. Make sure the local engine is running."));
    } finally {
      setLoading(false);
    }
  }, [service, tail, t]);

  useEffect(() => {
    if (!open || !service) return;
    setCopied(false);
    void loadLogs();
  }, [open, service, loadLogs]);

  const filteredLines = useMemo(() => {
    const lines = data?.lines ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return lines;
    return lines.filter((line) => line.toLowerCase().includes(keyword));
  }, [data, query]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(filteredLines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[82vh] w-[min(900px,92vw)] max-w-none flex-col gap-3 overflow-hidden p-4"
        showCloseButton={false}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="text-[15px] font-medium text-foreground">
              {t("Container logs: {service}", { service: service ?? "" })}
            </DialogTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex text-foreground-tertiary">
                  <ShieldCheck className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("Sensitive credentials, tokens, and proxy passwords are automatically redacted.")}
              </TooltipContent>
            </Tooltip>
            <DialogDescription className="sr-only">
              {t("Sensitive credentials, tokens, and proxy passwords are automatically redacted.")}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <IconActionButton icon={<X size={14} />} label={t("Close")} />
          </DialogClose>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-tertiary" />
            <input
              aria-label={t("Filter logs")}
              className={`${settingsInput} w-full pl-8`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Filter logs by keyword…")}
              value={query}
            />
          </div>
          <select
            aria-label={t("Log lines")}
            className={settingsSelect}
            onChange={(event) => setTail(Number(event.target.value))}
            value={tail}
          >
            {TAIL_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {t("Last {count} lines", { count })}
              </option>
            ))}
          </select>
          <IconActionButton
            disabled={loading}
            icon={<RefreshCw className={loading ? "animate-spin" : ""} size={13} />}
            label={t("Refresh")}
            onClick={() => void loadLogs()}
          />
          <IconActionButton
            disabled={filteredLines.length === 0}
            icon={copied ? <Check size={13} /> : <Copy size={13} />}
            label={t(copied ? "Copied" : "Copy")}
            onClick={() => void handleCopy()}
          />
        </div>

        {error ? (
          <div className="rounded-[10px] border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : null}

        <div className="min-h-[260px] flex-1 overflow-auto rounded-[10px] border border-black/[0.08] bg-black/[0.03] p-3 font-mono text-[11px] leading-[1.55] text-foreground dark:border-white/[0.08] dark:bg-black/40">
          {loading && !data ? (
            <div className="text-foreground-secondary">{t("Loading logs…")}</div>
          ) : filteredLines.length === 0 ? (
            <div className="text-foreground-secondary">
              {query.trim() ? t("No matching log lines.") : t("No logs available for this container.")}
            </div>
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-all">{filteredLines.join("\n")}</pre>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-foreground-tertiary">
          <span>
            {t("{count} lines shown", { count: filteredLines.length })}
            {data?.truncated ? ` · ${t("showing latest {count}", { count: tail })}` : ""}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
