import type { ReactNode } from "react";
import { cn } from "../../../../lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/tooltip";

export function IconActionButton({
  label,
  icon,
  onClick,
  disabled,
  variant = "default",
  active = false,
  side = "top",
  className,
  type = "button",
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
  active?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            aria-label={label}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-45",
              variant === "primary"
                ? "bg-black text-white enabled:hover:opacity-80 disabled:bg-black/[0.07] disabled:text-foreground dark:bg-white dark:text-black dark:disabled:bg-white/[0.09] dark:disabled:text-foreground"
                : variant === "danger"
                  ? active
                    ? "bg-red-600 text-white dark:bg-red-500 dark:text-white"
                    : "bg-red-500/12 text-red-600 enabled:hover:bg-red-500/20 enabled:hover:text-red-700 dark:bg-red-500/15 dark:text-red-400 dark:enabled:hover:bg-red-500/25 dark:enabled:hover:text-red-300"
                  : active
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "bg-black/[0.06] text-foreground enabled:hover:bg-black/[0.11] dark:bg-white/[0.09] dark:enabled:hover:bg-white/[0.15]",
              className
            )}
            disabled={disabled}
            onClick={onClick}
            type={type}
          >
            {icon}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
