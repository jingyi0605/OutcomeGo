import { cn } from "../../../lib/cn";
import { Button, type ButtonProps } from "../../ui/button";
import "./outcome-button.css";

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
