import type { ReactNode } from "react";
import { AITEAMOS_DEEP_LINK_EVENT, type SettingsAnchor } from "../../../lib/app-deep-links";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import "./ui.css";

const settingsButton =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[12px] font-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-50";

export const settingsPrimaryButton = `${settingsButton} bg-black text-white enabled:hover:opacity-80 disabled:bg-black/[0.07] disabled:text-foreground dark:bg-white dark:text-black dark:disabled:bg-white/[0.09] dark:disabled:text-foreground`;
export const settingsSecondaryButton = `${settingsButton} bg-black/[0.06] text-foreground enabled:hover:bg-black/[0.1] dark:bg-white/[0.09] dark:enabled:hover:bg-white/[0.13]`;
export const settingsInput =
  "h-7 min-w-0 rounded-[8px] border border-black/[0.09] bg-background px-2.5 text-[12px] shadow-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 dark:border-white/[0.1]";
export const settingsSelect =
  "h-7 min-w-0 rounded-[8px] border-black/[0.055] bg-black/[0.035] px-2 py-0 text-[12px] shadow-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 dark:border-white/[0.07] dark:bg-white/[0.07]";
export const settingsRow =
  "flex min-h-[52px] items-center gap-5 border-t border-black/[0.065] py-2 first:border-t-0 dark:border-white/[0.07]";
export const settingsRowDescriptionBelow =
  "grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 border-t border-black/[0.065] py-2 first:border-t-0 dark:border-white/[0.07]";

export function SettingsIntro({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <p className={cn("-mt-4 mb-5 px-2 text-[12px] leading-4 text-foreground-secondary", className)}>
      {typeof children === "string" ? t(children) : children}
    </p>
  );
}

export function SettingsLink({
  anchor,
  children,
}: {
  anchor: SettingsAnchor;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const url = `aiteamos://app/v1/settings?id=${anchor}`;
  return (
    <a
      className="whitespace-nowrap text-[13px] text-foreground underline underline-offset-2 hover:opacity-80"
      href={url}
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(AITEAMOS_DEEP_LINK_EVENT, { detail: { url } }));
      }}
    >
      {typeof children === "string" ? t(children) : children}
    </a>
  );
}

export function InteractiveSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      aria-checked={checked}
      aria-label={label ? t(label) : t(checked ? "On" : "Off")}
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 rounded-full outline-none transition-colors duration-120 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
        checked ? "bg-[var(--control-accent)]" : "bg-black/15 dark:bg-white/20"
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={cn(
          "absolute top-[2px] size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.22)] transition-transform duration-120 ease-out",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="settings-group"
      className={cn(
        "overflow-hidden rounded-[12px] bg-black/[0.045] px-3.5 dark:bg-[#1b1b1b] [[data-slot=settings-group]+&]:mt-3",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  control,
  className,
  anchors,
  stackControl = false,
  descriptionBelow = false,
}: {
  title: string;
  description?: ReactNode;
  control?: ReactNode;
  className?: string;
  anchors?: readonly SettingsAnchor[];
  stackControl?: boolean;
  descriptionBelow?: boolean;
}) {
  const { t } = useI18n();
  const descriptionContent = description ? (
    <div className="mt-px max-w-[560px] whitespace-pre-line text-[12px] leading-4 text-foreground-secondary">
      {typeof description === "string" ? t(description) : description}
    </div>
  ) : null;
  return (
    <div
      className={cn(descriptionBelow ? settingsRowDescriptionBelow : settingsRow, className)}
      data-settings-anchor={anchors?.join(" ")}
      data-settings-description-below={descriptionBelow ? "" : undefined}
      data-slot="settings-row"
      data-settings-layout={stackControl ? "form" : undefined}
    >
      {descriptionBelow ? (
        <>
          <div className="min-w-0">
            <div className="text-[13px] font-normal leading-[17px] text-foreground">{t(title)}</div>
          </div>
          {control ? (
            <div className="min-w-0 shrink-0" data-slot="settings-control">
              {control}
            </div>
          ) : null}
          {descriptionContent ? <div className="col-span-full">{descriptionContent}</div> : null}
        </>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-normal leading-[17px] text-foreground">{t(title)}</div>
            {descriptionContent}
          </div>
          {control ? (
            <div className="min-w-0 shrink-0" data-slot="settings-control">
              {control}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function SettingsHeading({
  children,
  anchor,
}: {
  children: ReactNode;
  anchor?: SettingsAnchor;
}) {
  const { t } = useI18n();
  return (
    <h2
      className="mb-7 px-2 text-[17px] font-medium leading-6 tracking-[-0.018em]"
      data-settings-anchor={anchor}
    >
      {typeof children === "string" ? t(children) : children}
    </h2>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 mt-7 px-2 text-[12px] font-normal leading-4 text-foreground-tertiary first:mt-0">
      {typeof children === "string" ? t(children) : children}
    </div>
  );
}
