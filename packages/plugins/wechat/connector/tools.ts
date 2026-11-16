import {
  EXTERNAL_LIST_PEERS_INPUT_SCHEMA,
  EXTERNAL_LIST_PEERS_TOOL,
  normalizeExternalListPeersInput,
  type ExternalDeliverInput,
  type ExternalDeliverResult,
  type ExternalPollInput,
  type ExternalPollResult,
} from "@outcomego/plugin-sdk/messaging";
import { integer, string, tool, type Args, type Tool } from "../../_shared/google";
import type { WechatAccount } from "./account";

/** The two host-only messaging tools. They exist only when the receive and send sides do. */
export interface MessagingHandlers {
  poll(input: ExternalPollInput): Promise<ExternalPollResult>;
  deliver(input: ExternalDeliverInput): Promise<ExternalDeliverResult>;
}

/** Both keys: the Server's transport and the shared namespace code each look for one of them. */
const HOST_ONLY = { "outcomego/hostOnly": true, "openteam/hostOnly": true } as const;

export type ResultShape = "text" | "structured";
export interface WechatTool extends Tool {
  /** `structured` results carry `structuredContent` as well as the text copy the MCP spec requires. */
  shape: ResultShape;
}

const sessionId = string("Active approval session ID", { minLength: 1, maxLength: 128 });

const hostOnly = (entry: Tool, shape: ResultShape = "text"): WechatTool => ({ ...entry, _meta: { ...HOST_ONLY }, shape });
const visible = (entry: Tool): WechatTool => ({ ...entry, shape: "text" });

/** Every tool of the connector, in a stable order. */
export function wechatTools(account: WechatAccount, messaging?: MessagingHandlers): WechatTool[] {
  const tools: WechatTool[] = [
    visible(
      tool(
        "connection_status",
        "Inspect this WeChat account: whether it is linked and receiving, how many received messages are waiting, and whether a reply to the account owner is currently possible. Read-only; it makes no network request and a running connector does not prove WeChat is reachable.",
        {},
        [],
        async () => account.status()
      )
    ),
    visible(
      tool(
        EXTERNAL_LIST_PEERS_TOOL,
        "List the WeChat contacts this account has received direct messages from, with a stable peerId, a display name, when they were last seen, whether they are the account owner, and whether a reply is possible right now. Read-only and local: it does not contact WeChat and cannot start a conversation. To answer someone, reply in their conversation; a peer being listed does not mean a message can be sent to them.",
        { ...EXTERNAL_LIST_PEERS_INPUT_SCHEMA.properties },
        [],
        async (args: Args) => account.peers.list(normalizeExternalListPeersInput(args), account.canSend)
      )
    ),
    hostOnly(tool("wechat_start_link", "Start QR approval in account settings.", {}, [], () => account.startLink(), "write")),
    hostOnly(tool("wechat_finish_link", "Continue the background device approval.", { sessionId }, ["sessionId"], (a) => account.finishLink(a.sessionId), "write")),
    hostOnly(tool("wechat_link_status", "Inspect device approval and receiving readiness.", {}, [], () => account.linkStatus())),
    hostOnly(tool("wechat_cancel_link", "Stop the matching device approval.", { sessionId }, ["sessionId"], (a) => account.cancelLink(a.sessionId), "write")),
    hostOnly(tool("wechat_remove_account", "Stop account use before private state removal.", {}, [], () => account.removeAccount(), "destructive")),
  ];
  if (messaging) {
    tools.push(
      hostOnly(
        tool(
          "wechat_poll_inbound",
          "Return received messages after the acknowledged cursor.",
          {
            cursor: { type: ["string", "null"], maxLength: 2048, description: "Last acknowledged cursor, or null." },
            limit: integer("Most messages to return", 20),
            waitMs: { type: "integer", minimum: 0, maximum: 25_000, description: "Longest wait for a message." },
          },
          ["cursor", "limit", "waitMs"],
          (a) => messaging.poll({ cursor: a.cursor ?? null, limit: a.limit, waitMs: a.waitMs }),
          "write"
        ),
        "structured"
      ),
      hostOnly(
        tool(
          "wechat_deliver_message",
          "Send one reply. Safe to call again with the same deliveryId.",
          {
            deliveryId: string("Delivery identifier", { minLength: 1, maxLength: 128 }),
            peerId: string("Recipient peer", { minLength: 1, maxLength: 256 }),
            text: { type: "string", maxLength: 20_000 },
            media: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  exchangeName: { type: "string", maxLength: 120 },
                  fileName: { type: "string", maxLength: 256 },
                  mimeType: { type: "string", maxLength: 255 },
                  byteSize: { type: "integer", minimum: 0 },
                  sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                },
                required: ["exchangeName", "fileName", "mimeType", "byteSize", "sha256"],
                additionalProperties: false,
              },
            },
          },
          ["deliveryId", "peerId"],
          (a) => messaging.deliver(a as ExternalDeliverInput),
          "write"
        ),
        "structured"
      )
    );
  }
  return tools;
}
