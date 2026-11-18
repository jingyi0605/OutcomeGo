import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { useI18n } from "../../../lib/i18n";

/** Hover previews; a deliberate click pins the source until Escape or outside dismissal. */
export function OutcomeSourceInfo({
  text,
  name,
  children,
}: {
  text?: string;
  name: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"closed" | "hover" | "pinned">("closed");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  const leave = () => {
    cancel();
    timer.current = setTimeout(
      () => setMode((value) => (value === "hover" ? "closed" : value)),
      150
    );
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Popover
      open={mode !== "closed"}
      onOpenChange={(open) => {
        cancel();
        setMode(open ? "pinned" : "closed");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="outcome-source-info"
          aria-label={t("Source for {name}", { name })}
          onPointerEnter={() => {
            cancel();
            setMode((value) => (value === "closed" ? "hover" : value));
          }}
          onPointerLeave={leave}
          onFocus={() => {
            cancel();
            setMode((value) => (value === "closed" ? "hover" : value));
          }}
          onBlur={leave}
          onClick={(event) => {
            event.preventDefault();
            cancel();
            setMode((value) => (value === "pinned" ? "closed" : "pinned"));
          }}
        >
          <Info size={13} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="outcome-source-popover"
        aria-label={t("Original record")}
        data-outcome-source=""
        onPointerEnter={cancel}
        onPointerLeave={leave}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <p className="outcome-source-heading">{name}</p>
        <div className="outcome-source-content">
          {children ?? <p className="whitespace-pre-wrap break-words">{text}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
