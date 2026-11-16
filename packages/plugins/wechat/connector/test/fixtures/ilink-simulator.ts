import { createHash } from "node:crypto";
import type { WechatFetch } from "../../api";

/** One recorded request. Bodies are raw text so tests can assert exact wire values. */
export interface SimRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

export interface SimMessage {
  /** Written verbatim into the JSON so 64-bit ids stay exact. */
  messageId: string;
  fromUserId: string;
  text?: string;
  items?: unknown[];
  groupId?: string;
  contextToken?: string | null;
  createTimeMs?: number;
}

export type SimUpdateMode = "replay" | "no-replay";

/**
 * A local stand-in for iLink and its CDN. It is a `fetch` replacement, not a server: the real
 * connector cannot be pointed at another host (design W7), so tests inject this instead.
 * Behavior is scripted per endpoint; anything unscripted answers like a quiet, healthy account.
 */
export class IlinkSimulator {
  readonly requests: SimRequest[] = [];
  /** Messages the account has received, oldest first. */
  private inbox: Array<SimMessage & { seq: number }> = [];
  private seq = 0;
  /** Cursor token -> sequence it covers. */
  private cursors = new Map<string, number>();
  private cursorCounter = 0;
  mode: SimUpdateMode = "replay";

  qr = { qrcode: "sim-qr-1", content: "https://sim.weixin.qq.com/qr/1" };
  /** Status answers handed out in order; the last one repeats. */
  qrStatuses: Array<Record<string, unknown>> = [{ status: "wait" }];
  private qrIndex = 0;
  account = { botToken: "sim-bot-token", baseUrl: "https://acct.weixin.qq.com", ilinkBotId: "bot1@im.bot", ilinkUserId: "owner1@im.wechat" };

  /** Per-endpoint override: a response, a business code, an HTTP status or a thrown error. */
  overrides = new Map<string, Array<() => Response | Promise<Response>>>();
  /** Set to make `getupdates` hang until the client's timeout. */
  holdGetUpdates = false;
  /** How long an empty getupdates is held open, like the real long poll. */
  emptyPollDelayMs = 20;
  longPollingTimeoutMs = 35_000;
  /** Everything uploaded to the CDN, keyed by the returned download parameter. */
  cdn = new Map<string, Uint8Array>();
  sent: Array<{ toUserId: string; clientId: string; contextToken: string; items: unknown[] }> = [];

  enqueue(message: SimMessage): void {
    // Real ids are 64-bit integers written as bare JSON numbers; anything else would corrupt the body.
    if (!/^\d{1,20}$/.test(message.messageId)) throw new Error(`message ids must be decimal integers, got ${JSON.stringify(message.messageId)}`);
    this.inbox.push({ ...message, seq: ++this.seq });
  }

  /** Make the next call(s) to an endpoint fail with a given business code. */
  failNext(endpoint: string, ret: number, times = 1): void {
    const list = this.overrides.get(endpoint) ?? [];
    for (let i = 0; i < times; i++) list.push(() => Response.json({ ret, errmsg: "scripted" }));
    this.overrides.set(endpoint, list);
  }

  failHttp(endpoint: string, status: number, times = 1): void {
    const list = this.overrides.get(endpoint) ?? [];
    for (let i = 0; i < times; i++) list.push(() => new Response("{}", { status }));
    this.overrides.set(endpoint, list);
  }

  failTransport(endpoint: string, times = 1): void {
    const list = this.overrides.get(endpoint) ?? [];
    for (let i = 0; i < times; i++)
      list.push(() => {
        throw new TypeError("scripted transport failure");
      });
    this.overrides.set(endpoint, list);
  }

  respondRaw(endpoint: string, body: string, status = 200): void {
    const list = this.overrides.get(endpoint) ?? [];
    list.push(() => new Response(body, { status, headers: { "content-type": "application/json" } }));
    this.overrides.set(endpoint, list);
  }

  redirectNext(endpoint: string, to: string): void {
    const list = this.overrides.get(endpoint) ?? [];
    list.push(() => new Response(null, { status: 302, headers: { location: to } }));
    this.overrides.set(endpoint, list);
  }

  /**
   * Looks at every request before it is answered. Return a response to answer it instead, or nothing to
   * let the simulator handle it. `count` is how many requests to that path were seen, this one included.
   */
  intercept?: (request: { url: URL; init: RequestInit; count: number }) => Response | Promise<Response> | void | Promise<void>;
  private seenPaths = new Map<string, number>();

  readonly fetch: WechatFetch = async (input, init) => {
    const url = new URL(input);
    if (this.intercept) {
      const count = (this.seenPaths.get(url.pathname) ?? 0) + 1;
      this.seenPaths.set(url.pathname, count);
      const answer = await this.intercept({ url, init, count });
      if (answer) return answer;
    }
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : init.body ? await new Response(init.body as BodyInit).text() : "";
    this.requests.push({ method: (init.method ?? "GET").toUpperCase(), url, headers, body });
    if (init.redirect === "error" || init.redirect === undefined) {
      // A real fetch with redirect: "error" rejects on a 3xx; mimic that.
    }
    const endpoint = url.pathname.replace(/^\//, "");
    const queued = this.overrides.get(endpoint);
    const scripted = queued?.shift();
    if (scripted) {
      const response = await scripted();
      if (response.status >= 300 && response.status < 400 && init.redirect === "error") throw new TypeError("redirect refused");
      return response;
    }
    if (url.hostname.startsWith("novac2c.cdn")) return this.cdnResponse(url, init, body);
    return this.business(endpoint, url, body, init);
  };

  private async business(endpoint: string, url: URL, body: string, init: RequestInit): Promise<Response> {
    switch (endpoint) {
      case "ilink/bot/get_bot_qrcode":
        return Response.json({ ret: 0, qrcode: this.qr.qrcode, qrcode_img_content: this.qr.content });
      case "ilink/bot/get_qrcode_status": {
        const next = this.qrStatuses[Math.min(this.qrIndex++, this.qrStatuses.length - 1)]!;
        if (next.status === "confirmed")
          return Response.json({
            ret: 0,
            status: "confirmed",
            bot_token: this.account.botToken,
            baseurl: this.account.baseUrl,
            ilink_bot_id: this.account.ilinkBotId,
            ilink_user_id: this.account.ilinkUserId,
            ...next,
          });
        return Response.json({ ret: 0, ...next });
      }
      case "ilink/bot/getupdates": {
        if (this.holdGetUpdates) return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
        const request = JSON.parse(body || "{}") as { get_updates_buf?: string };
        const covered = request.get_updates_buf ? (this.cursors.get(request.get_updates_buf) ?? 0) : 0;
        // "no-replay": an old cursor still only returns what is new since the *latest* one served.
        const floor = this.mode === "replay" ? covered : Math.max(covered, this.servedUpTo);
        const fresh = this.inbox.filter((message) => message.seq > floor);
        const top = fresh.length ? fresh[fresh.length - 1]!.seq : Math.max(floor, covered);
        this.servedUpTo = Math.max(this.servedUpTo, top);
        // The real server holds an empty poll open; without this a test loop would spin.
        if (fresh.length === 0 && this.emptyPollDelayMs > 0)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.emptyPollDelayMs);
            init.signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
          });
        init.signal?.throwIfAborted();
        const token = `buf-${++this.cursorCounter}`;
        this.cursors.set(token, top);
        return new Response(
          // Built by hand: JSON.stringify would round the 64-bit ids.
          `{"ret":0,"msgs":[${fresh.map(encodeMessage).join(",")}],"get_updates_buf":"${token}","longpolling_timeout_ms":${this.longPollingTimeoutMs}}`,
          { headers: { "content-type": "application/json" } }
        );
      }
      case "ilink/bot/sendmessage": {
        const msg = (JSON.parse(body) as { msg: { to_user_id: string; client_id: string; context_token: string; item_list: unknown[] } }).msg;
        this.sent.push({ toUserId: msg.to_user_id, clientId: msg.client_id, contextToken: msg.context_token, items: msg.item_list });
        return Response.json({ ret: 0 });
      }
      case "ilink/bot/getuploadurl":
        return Response.json({ ret: 0, upload_param: `up-${this.cdn.size + 1}` });
      case "ilink/bot/msg/notifystart":
      case "ilink/bot/msg/notifystop":
        return Response.json({ ret: 0 });
      default:
        return new Response("{}", { status: 404 });
    }
  }

  private servedUpTo = 0;

  private async cdnResponse(url: URL, init: RequestInit, body: string): Promise<Response> {
    if ((init.method ?? "GET") === "POST") {
      const bytes = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      const key = `dl-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
      this.cdn.set(key, bytes);
      return new Response("", { headers: { "x-encrypted-param": key } });
    }
    const key = url.searchParams.get("encrypted_query_param") ?? "";
    const bytes = this.cdn.get(key);
    return bytes ? new Response(bytes as unknown as BodyInit) : new Response("missing", { status: 404 });
  }
}

const encodeMessage = (message: SimMessage): string => {
  const items =
    message.items ?? (message.text === undefined ? [] : [{ type: 1, text_item: { text: message.text } }]);
  return (
    `{"message_id":${message.messageId},"from_user_id":${JSON.stringify(message.fromUserId)},"to_user_id":"bot1@im.bot",` +
    `"create_time_ms":${message.createTimeMs ?? 1763280000000},` +
    (message.groupId ? `"group_id":${JSON.stringify(message.groupId)},` : "") +
    (message.contextToken === null ? "" : `"context_token":${JSON.stringify(message.contextToken ?? `ctx-${message.messageId}`)},`) +
    `"item_list":${JSON.stringify(items)}}`
  );
};
