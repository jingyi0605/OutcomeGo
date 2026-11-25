import { type HTMLAttributes, type ReactNode, useId } from "react";

/**
 * A small control on the engine screen that keeps its longer explanation out of sight until it is
 * hovered, focused or pressed (see .deploy-tip in the stylesheet).
 */
export function DeployHint({
  children,
  tip,
  className,
  label,
  wrapper,
  ...rest
}: {
  children: ReactNode;
  tip: ReactNode;
  /** Class of the control itself. */
  className?: string;
  /** Names a control that shows only a picture; otherwise its words do, and the tip describes it. */
  label?: string;
  /** Props of the element around the control and its tip. */
  wrapper?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children">) {
  const id = useId();
  return (
    <span {...rest} className={wrapper ? `deploy-hint ${wrapper}` : "deploy-hint"}>
      <button
        aria-describedby={label ? undefined : id}
        aria-label={label}
        className={className}
        // The picture around it picks an engine when pressed; asking about it mustn't.
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.focus();
        }}
        // Escape puts the tip away instead of leaving the screen.
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
        type="button"
      >
        {children}
      </button>
      <span className="deploy-tip" id={id} role="tooltip">
        {tip}
      </span>
    </span>
  );
}
