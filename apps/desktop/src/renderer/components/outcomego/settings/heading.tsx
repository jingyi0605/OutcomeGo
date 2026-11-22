import type { ReactNode } from "react";
import type { SettingsAnchor } from "../../../lib/app-deep-links";
import { useI18n } from "../../../lib/i18n";

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
