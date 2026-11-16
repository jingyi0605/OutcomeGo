# WeChat (iLink) connector

Lets a user talk to their OpenTeam Bot from WeChat. The user links their own WeChat account by scanning a QR
code. Messages the account owner sends to their WeChat ClawBot become a conversation with the chosen Bot, and
the Bot's replies are sent back to the same WeChat chat.

This package is the connector only. Conversations, de-duplication, waking the Bot and delivery state belong
to the Server's external messaging service (`specs/009-外部消息服务`). The connector owns the WeChat protocol,
its local queue, the provider cursor, reply tokens and media encryption (`specs/009.1-微信iLink消息服务集成`).

## Limits to know

- The WeChat account needs the ClawBot entry, which WeChat is rolling out in stages.
- The ClawBot can only reply after the user writes, and only for about a day afterwards.
- Direct chats only. Group chats are not supported.
- Only text and still pictures are sent. File and video sending stays off until a real account shows they arrive.
- `sent` means WeChat accepted the request, not that the message was shown.
- This uses a channel WeChat opened for OpenClaw. Availability depends on Tencent.
- The iLink protocol has no public specification. Several behaviours (see the probe list in the spec docs) are
  taken from the reference client and are **not yet verified** against a real account.

## Layout

| File | Role |
| --- | --- |
| `connector/api.ts`, `json.ts`, `protocol.ts` | The iLink HTTP client, lossless 64-bit ids, wire constants |
| `connector/account.ts` | Linking by QR code, credentials, the account state machine |
| `connector/receive.ts`, `journal.ts`, `normalize.ts` | Long-poll loop, crash-safe batch journal, message mapping |
| `connector/spool.ts` | The durable queue the Server drains |
| `connector/media.ts` | Download, decrypt, upload, and the exchange folder rules |
| `connector/deliver.ts`, `split.ts` | Sending replies at most once |
| `connector/peers.ts` | Who has written, and each person's reply context |
| `connector/server.ts`, `tools.ts` | The MCP tools |

State lives in `$OPENTEAM_PLUGIN_STATE_DIR` and is removed with the account.
