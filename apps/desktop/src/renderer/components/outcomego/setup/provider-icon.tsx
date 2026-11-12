import type { CSSProperties } from "react";
import { hasProviderMark, ProviderMark } from "./provider-marks";

// The vendor marks from scripts/icons/export-provider-icons.ts, by file name. Names ending in
// "-color" keep their own colours; every other mark is one colour and follows the text colour.
const ICONS = import.meta.glob<string>("../../../assets/provider-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
const urls = new Map(
  Object.entries(ICONS).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4), url])
);

/** A vendor mark by icon name; null when the set has no such mark. */
export function ProviderIcon({
  name,
  size = 14,
  className,
}: {
  name: string | undefined;
  size?: number;
  className?: string;
}) {
  const url = name ? urls.get(name) : undefined;
  if (!url) return null;
  if (name!.endsWith("-color"))
    return (
      <img
        alt=""
        aria-hidden="true"
        className={className}
        draggable={false}
        height={size}
        src={url}
        width={size}
      />
    );
  const style: CSSProperties = {
    display: "inline-block",
    width: size,
    height: size,
    backgroundColor: "currentColor",
    mask: `url("${url}") center / contain no-repeat`,
    WebkitMask: `url("${url}") center / contain no-repeat`,
  };
  return <span aria-hidden="true" className={className} style={style} />;
}

/** The mark a provider row shows: the app's own mark where it has one, else the vendor icon. */
export function ProviderRowMark({
  id,
  icon,
  size = 14,
}: {
  id: string;
  icon?: string;
  size?: number;
}) {
  return hasProviderMark(id) ? (
    <ProviderMark id={id} size={size} />
  ) : (
    <ProviderIcon name={icon} size={size} />
  );
}
