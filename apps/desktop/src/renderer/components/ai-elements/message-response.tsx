import { useState } from "react";
import { Streamdown } from "streamdown";
import "./message-response/streamdown.css";
import {
  messageComponents,
  messageRemarkPlugins,
  messageUrlTransform,
  prepareMessageMarkdown,
  streamdownControls,
} from "./message-response/config";

const replyAnimation = { animation: "fadeIn", duration: 140, maxBacklogMs: 80 } as const;

export default function RichMessageResponse({
  children,
  textOnly = false,
  streaming = false,
}: {
  children: string;
  textOnly?: boolean;
  streaming?: boolean;
}) {
  const [animateReply] = useState(streaming);
  if (textOnly) {
    return (
      <Streamdown
        className="bot-markdown"
        mode="static"
        controls={false}
        skipHtml
        disallowedElements={["a", "img", "pre"]}
        unwrapDisallowed
      >
        {children}
      </Streamdown>
    );
  }
  return (
    <Streamdown
      className={animateReply ? "bot-markdown streaming-reply" : "bot-markdown"}
      components={messageComponents}
      controls={streamdownControls}
      isAnimating={streaming}
      animated={animateReply ? replyAnimation : false}
      lineNumbers={false}
      remarkPlugins={messageRemarkPlugins}
      urlTransform={messageUrlTransform}
    >
      {prepareMessageMarkdown(children)}
    </Streamdown>
  );
}
