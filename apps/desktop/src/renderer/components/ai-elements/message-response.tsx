import { Streamdown } from "streamdown";
import {
  messageComponents,
  messageRemarkPlugins,
  messageUrlTransform,
  prepareMessageMarkdown,
  streamdownControls,
} from "./message-response/config";

export default function RichMessageResponse({
  children,
  textOnly = false,
}: {
  children: string;
  textOnly?: boolean;
}) {
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
      className="bot-markdown"
      components={messageComponents}
      controls={streamdownControls}
      lineNumbers={false}
      remarkPlugins={messageRemarkPlugins}
      urlTransform={messageUrlTransform}
    >
      {prepareMessageMarkdown(children)}
    </Streamdown>
  );
}
