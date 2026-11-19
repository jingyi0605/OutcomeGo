import { I18nProvider } from "../../src/renderer/lib/i18n";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChannelMessageView } from "@outcomego/contracts";
import { parseExternalDraft } from "@outcomego/contracts/external-draft";
import { ExternalDraftCard } from "../../src/renderer/components/outcomego/external-draft-card";
import { IMessageSendCard } from "../../src/renderer/components/outcomego/imessage-send-card";
import { api } from "../../src/renderer/client/outcomego-api";
import { clearAuthToken } from "../../src/renderer/client/auth";
import { useVirtualWindow } from "../../src/renderer/hooks/use-virtual-window";
import "../../src/renderer/styles.css";

const params = new URLSearchParams(location.search);
const kind = params.get("kind") ?? "email";
const message = await fetch(`/__delivery-fixture/bootstrap?kind=${kind}`).then((r) => r.json()) as ChannelMessageView;
const mutate = async (_id: string, action: string, edits?: unknown) => {
  const response = await fetch(`/__delivery-fixture/${action}?kind=${kind}`, {
    method: "POST", body: JSON.stringify(edits ?? {}),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
Object.assign(api, { mutateExternalDraft: mutate, mutateIMessageSend: mutate });

function Draft() {
  const [shown, show] = useState(true);
  Object.assign(window, { deliveryQA: { show, changeAccount: () => clearAuthToken() } });
  return shown && (kind === "email"
    ? <ExternalDraftCard message={message} draft={parseExternalDraft((message.metadata as any).draft)} />
    : <IMessageSendCard message={message} />);
}

function Measurements() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const [tall, grow] = useState(false);
  const following = useRef(false);
  const { virtualItems, measureElement, totalSize, scrollInitialized } = useVirtualWindow({
    count: 80, getKey: (i) => `row-${i}`, estimateSize: () => 80,
    scrollRef, scopeRef, initialScroll: { index: 30, viewportOffset: 0 },
    followEnd: () => following.current, overscan: 900,
  });
  Object.assign(window, { measurementQA: {
    grow: () => grow((value) => !value),
    follow: () => { following.current = true; grow((value) => !value); },
    ready: scrollInitialized,
  } });
  return <div ref={scrollRef} style={{ height: 400, width: 700, overflow: "auto", overflowAnchor: "none" }}>
    <div ref={scopeRef} style={{ height: totalSize, position: "relative" }}>
      {virtualItems.map((item) => <div key={item.key} data-row={item.index}
        ref={(node) => measureElement(item.index, item.key, node)}
        style={{ position: "absolute", top: 0, width: "100%", height: tall && item.index < 30 ? 200 : 80,
          transform: `translateY(${item.start}px)` }}>{item.key}</div>)}
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider>{params.has("measurement") ? <Measurements /> : <Draft />}</I18nProvider>);
