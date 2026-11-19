# 插件事件来源泛化 (005.4)

## 概述

把宿主现有的插件事件轮询从"仅 Email、仅本机连接器"泛化为"任意插件，含 Remote MCP"：插件声明一个轮询工具，宿主定期带游标调用，把事件派发给触发器为 `plugin` 的 routine。Bot 订阅 = 创建一个 routine；没有事件时不唤醒 Bot，不需要公网地址。

本规格是 Spec 005.3（DSH-WEB 插件集成）中"Bot 订阅会话并在状态变化时被唤醒"的宿主侧基础。

## 文档结构

```
specs/005.4-插件事件来源泛化/
├── README.md        # 本文档
├── requirements.md  # 7 个需求
├── design.md        # 清单、轮询协议、触发器、宿主改动、测试策略
├── tasks.md         # 8 个阶段的任务
└── docs/            # 验收结果等补充文档
```

## 关键决定

- 新增通用来源 `plugin` 和通用触发器 `{ "type": "plugin", "plugin", "events"?, "resourceIds"?, "actors"? }`，不为每个插件新增类型
- `resourceIds` 与 `actors` 至少一个非空，避免对整个插件无条件订阅
- 宿主覆盖事件的 `source`、`plugin`、`account`，事件标识加命名空间，连接器不能冒充
- 轮询工具对 Bot 隐藏；Remote MCP 发现结果同样过滤
- 不新增数据库迁移，沿用 `eventCursor` 与 `eventsPolledAt`
- 客户端遇到该触发器显示通用文案，专用文案为可选后续任务

## 与其他规格的关系

- **005.3 DSH-WEB 插件集成**：F2 改用本机制；后端新增 `session_events` 轮询工具（见任务 6.1、6.2）
- **005 插件扩展体系**：沿用其声明式插件规则，不在 `apps/server` 写插件专属逻辑
- 参考实现：Email 插件的 `poll_new_mail`（提交 `ef0e4147c` 是新增事件触发器的完整改动清单）
