import { useId } from "react";
import chatGPTIcon from "../../../assets/model-providers/chatgpt.webp";
import claudeIcon from "../../../assets/model-providers/claude.webp";
import { isTileProvider, ProviderTile } from "./provider-marks";

// The ChatGPT and Claude app icons from their App Store listings (downloaded 2026-10-20),
// as 128 px WebP: the plans people pay for look like the apps they already use.
const APP_ICONS = { chatgpt: chatGPTIcon, claude: claudeIcon } as const;

/** A plan's app icon, rounded like on a phone (22%). */
export function AppIcon({ app, size = 40 }: { app: keyof typeof APP_ICONS; size?: number }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="provider-icon"
      draggable={false}
      height={size}
      src={APP_ICONS[app]}
      style={{
        flexShrink: 0,
        borderRadius: size * 0.22,
        boxShadow: "0 0 0 0.5px rgb(0 0 0 / 10%)",
      }}
      width={size}
    />
  );
}

/**
 * The "add your own provider" tile: a plug (connect an endpoint) with a plus badge (add one),
 * on an indigo gradient so it sits beside the app icons as a tile of the same shape and weight.
 * The badge is cut out of the plug with a mask, so it reads on the gradient in light and dark.
 */
export function CustomProviderIcon({ size = 40 }: { size?: number }) {
  const cut = useId();
  return (
    <span
      aria-hidden="true"
      className="provider-icon"
      style={{
        display: "inline-grid",
        flexShrink: 0,
        width: size,
        height: size,
        placeItems: "center",
        borderRadius: size * 0.22,
        background: "linear-gradient(145deg, #8F8BFF 0%, #5B54EE 55%, #4338CA 100%)",
        boxShadow: "inset 0 0.5px 0 rgb(255 255 255 / 35%), 0 0 0 0.5px rgb(0 0 0 / 10%)",
      }}
    >
      <svg fill="none" height={size} viewBox="0 0 40 40" width={size}>
        <defs>
          <mask id={cut}>
            <rect fill="#fff" height="40" width="40" />
            <circle cx="28.5" cy="28.5" fill="#000" r="8.5" />
          </mask>
        </defs>
        <g
          mask={`url(#${cut})`}
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
          transform="translate(8 7.5) scale(.95)"
        >
          <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
        </g>
        <circle cx="28.5" cy="28.5" fill="#fff" r="5.8" />
        <path
          d="M28.5 25.9v5.2M25.9 28.5h5.2"
          stroke="#4F46E5"
          strokeLinecap="round"
          strokeWidth="1.9"
        />
      </svg>
    </span>
  );
}

/** Whether ProviderIcon has artwork for this provider id. */
export const hasProviderIcon = (id: string) =>
  id === "openai-codex" || id === "claude-code" || isTileProvider(id);

/** A provider's square icon by its server id: the app icon for a plan, otherwise its tile. */
export function ProviderIcon({ id, size = 40 }: { id: string; size?: number }) {
  if (id === "openai-codex") return <AppIcon app="chatgpt" size={size} />;
  if (id === "claude-code") return <AppIcon app="claude" size={size} />;
  if (isTileProvider(id)) return <ProviderTile provider={id} size={size} />;
  return null;
}
