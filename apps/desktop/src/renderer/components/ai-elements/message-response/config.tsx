import "./markdown.css";
import type { ComponentProps } from "react";
import {
  type Components,
  type ControlsConfig,
  defaultUrlTransform,
  type MermaidErrorComponentProps,
  type MermaidOptions,
  type UrlTransform,
} from "streamdown";
import { useAuthenticatedResource } from "../../../hooks/use-authenticated-resource";
import { useResourceActive } from "../../../hooks/resource-activity";
import { AITEAMOS_DEEP_LINK_EVENT } from "../../../lib/app-deep-links";
import { useI18n } from "../../../lib/i18n";
import { SANITIZED_MESSAGE_LINK_PREFIX, SANITIZED_AITEAMOS_LINK_PREFIX } from "./markdown-source";
export { messageRemarkPlugins, prepareMessageMarkdown } from "./markdown-source";

export { AITEAMOS_DEEP_LINK_EVENT } from "../../../lib/app-deep-links";

export const streamdownControls: ControlsConfig = {
  code: { copy: true, download: false },
  image: false,
  mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
  table: false,
};

export { botShikiTheme } from "./code-theme";

/**
 * streamdown renders this through `jsx(component, props)`, so it is a real
 * component and may use hooks.
 */
const MermaidError = ({ chart, error, retry }: MermaidErrorComponentProps) => {
  const { t } = useI18n();
  return (
    <div data-chat-diagram-error className="rounded-lg bg-muted p-3 text-sm">
      <p>{error}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap">{chart}</pre>
      <button onClick={retry} type="button">
        {t("Retry diagram")}
      </button>
    </div>
  );
};

export const botMermaidOptions: MermaidOptions = {
  errorComponent: MermaidError,
  config: {
    theme: "base",
    themeVariables: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
      fontSize: "14px",
      lineColor: "#333333",
      primaryBorderColor: "#9770d9",
      primaryColor: "#edecff",
      primaryTextColor: "#333333",
    },
  },
};

export const messageUrlTransform: UrlTransform = (url, key, node) =>
  url.startsWith(SANITIZED_MESSAGE_LINK_PREFIX) || url.startsWith(SANITIZED_AITEAMOS_LINK_PREFIX)
    ? url
    : defaultUrlTransform(url, key, node);

const jumpToMessage = (address: string) => {
  const target = Array.from(
    document.querySelectorAll<HTMLElement>("[data-message-address], [data-message-id]")
  ).find(
    (element) => element.dataset.messageAddress === address || element.dataset.messageId === address
  );
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("message-jump-target");
  window.requestAnimationFrame(() => target.classList.add("message-jump-target"));
  window.setTimeout(() => target.classList.remove("message-jump-target"), 1_600);
};

type MarkdownAnchorProps = ComponentProps<"a"> & { node?: unknown };

function MessageLink({ children, className, href, node: _node, ...props }: MarkdownAnchorProps) {
  const { t } = useI18n();
  const encodedAddress = href?.startsWith(SANITIZED_MESSAGE_LINK_PREFIX)
    ? href.slice(SANITIZED_MESSAGE_LINK_PREFIX.length)
    : null;
  let address = encodedAddress;
  if (encodedAddress) {
    try {
      address = decodeURIComponent(encodedAddress);
    } catch {
      address = encodedAddress;
    }
  }

  if (address) {
    return (
      <button
        aria-label={t("Jump to referenced message {address}", { address })}
        className="message-jump-chip"
        data-message-jump={address}
        onClick={() => jumpToMessage(address)}
        title={t("Jump to earlier message")}
        type="button"
      >
        <span aria-hidden="true">↪</span>
        {children}
      </button>
    );
  }

  const aiTeamOSPath = href?.startsWith(SANITIZED_AITEAMOS_LINK_PREFIX)
    ? href.slice(SANITIZED_AITEAMOS_LINK_PREFIX.length)
    : null;
  if (aiTeamOSPath) {
    const url = `aiteamos:${aiTeamOSPath}`;
    return (
      <button
        aria-label={t("Open {name}", { name: String(children) })}
        className="message-jump-chip"
        onClick={() =>
          window.dispatchEvent(new CustomEvent(AITEAMOS_DEEP_LINK_EVENT, { detail: { url } }))
        }
        type="button"
      >
        {children}
      </button>
    );
  }

  return (
    <a
      className={className}
      data-streamdown="link"
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  );
}

function MessageImage({
  src,
  alt,
  node: _node,
  ...props
}: ComponentProps<"img"> & { node?: unknown }) {
  const resourcesActive = useResourceActive();
  const source = useAuthenticatedResource(typeof src === "string" ? src : null, {
    enabled: resourcesActive,
  });
  const width = Number(props.width);
  const height = Number(props.height);
  const knownSize = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const frameWidth = knownSize ? Math.min(width, 320, (width / height) * 300) : 320;
  return (
    <span
      className="relative inline-block max-w-full overflow-hidden align-middle rounded-lg bg-muted"
      style={{ width: frameWidth, aspectRatio: knownSize ? `${width} / ${height}` : "16 / 9" }}
    >
      <img
        {...props}
        alt={alt ?? ""}
        src={source ?? undefined}
        loading="lazy"
        data-streamdown="image"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </span>
  );
}

export const messageComponents: Components = { a: MessageLink, img: MessageImage };
