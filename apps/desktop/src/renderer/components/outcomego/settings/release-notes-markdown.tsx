import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";
import "../../ai-elements/message-response/streamdown.css";
import "./release-notes.css";

const PULL_REQUEST_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)$/;

type NotesLinkProps = ComponentProps<"a"> & { node?: unknown };

function NotesLink({ children, href, node: _node, className: _className, ...props }: NotesLinkProps) {
  const reference =
    href && children === href ? (PULL_REQUEST_URL.exec(href)?.[1] ?? null) : null;
  return (
    <a {...props} className="release-notes-link" href={href} rel="noreferrer noopener" target="_blank">
      {reference ? `#${reference}` : children}
    </a>
  );
}

const notesComponents = { a: NotesLink };

export default function ReleaseNotesMarkdown({ children }: { children: string }) {
  return (
    <Streamdown
      className="release-notes"
      components={notesComponents}
      controls={false}
      disallowedElements={["img"]}
      lineNumbers={false}
      mode="static"
      skipHtml
      unwrapDisallowed
    >
      {children}
    </Streamdown>
  );
}
