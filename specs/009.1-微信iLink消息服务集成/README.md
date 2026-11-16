# Spec 009.1：微信 iLink 消息服务集成

状态：IN_PROGRESS

文档关系：

- 基础服务：[`../009-外部消息服务/README.md`](../009-外部消息服务/README.md)
- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 任务：[`tasks.md`](tasks.md)
- 补充文档：[`docs/README.md`](docs/README.md)
- 协议事实与探测清单：[`docs/20261116-iLink协议事实与探测清单.md`](docs/20261116-iLink协议事实与探测清单.md)

本 Spec 实现微信 ClawBot（iLink Bot API）的 packaged MCP connector，并通过 Spec 009 的外部消息服务，让账户所有者在微信里与自己的 OpenTeam Bot 对话。

connector 只负责平台协议：二维码登录、长轮询接收、持久化批次与入站队列、只读 peer 列表、媒体加解密、带会话 token 的外发。Channel 映射、去重、Bot 唤醒、回复路由和外发状态全部由 Spec 009 负责。

## 首版边界

| 项目 | 首版行为 |
| --- | --- |
| 会话类型 | 只支持账户所有者本人与 bot 的单聊 |
| 主动发送 | 不支持。iLink 只允许在用户来消息后的会话窗口内回复 |
| 入站内容 | 文本、图片、文件、视频；带转写文字的语音按文本处理 |
| 外发内容 | 文本、图片；文件与视频待实机探测通过后启用；语音不做 |
| Bot 可见工具 | 只读的 `connection_status` 和 `list_peers`；发送统一经过 Spec 009 |

## 开发与联调条件

- 任务 1.2 固定参考版本和离线行为矩阵；API client、simulator、状态机和收发实现不等待全部实机探测。
- 任务 1.5 按能力探测，任务 4.3 进行实机联调，均需要一个已获得「微信 ClawBot」入口的微信号。未验证的可选文件、视频不启用，不阻塞已验证的文本和图片。
- 恢复保证从当前 provider 批次首次落盘后开始；落盘前的网络响应是否可恢复依赖 provider 重放行为，不能无条件承诺。

## 不在本 Spec 内

QQ、微信群聊、历史回填、个人微信逆向协议或桌面自动化、任何 automation trigger。
