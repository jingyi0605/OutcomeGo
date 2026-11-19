import { RefreshCw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../lib/cn";
import { Button, type ButtonProps } from "../../ui/button";
import "./outcome-ui.css";

export function OutcomeButton({
  className,
  iconOnly = false,
  variant = "secondary",
  size = "sm",
  ...props
}: ButtonProps & { iconOnly?: boolean }) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn("outcome-button", iconOnly && "outcome-button-icon", className)}
      {...props}
    />
  );
}

export function OutcomeRefresh({ busy, onRefresh }: { busy: boolean; onRefresh: () => void }) {
  const { t } = useI18n();
  return (
    <OutcomeButton
      variant="ghost"
      size="icon-sm"
      iconOnly
      aria-label={t("Refresh from server")}
      title={t("Refresh from server")}
      disabled={busy}
      onClick={onRefresh}
    >
      <RefreshCw className={cn("size-3.5", busy && "animate-spin motion-reduce:animate-none")} />
    </OutcomeButton>
  );
}

export function OutcomeEmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="outcome-empty" role="status">
      <span className="outcome-empty-icon">
        <Icon aria-hidden="true" className="size-6" strokeWidth={1.4} />
      </span>
      <h3>{t(title)}</h3>
      <p>{t(description)}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
