# 任务清单 - 钉钉个人工作区插件

状态：IN_PROGRESS（真实资源验收受企业 CLI 访问策略阻塞）

文档关系：

- 总览：[`README.md`](README.md)
- 需求：[`requirements.md`](requirements.md)
- 设计：[`design.md`](design.md)
- 验证证据：[`docs/README.md`](docs/README.md)

## 阶段 1：Spec、上游版本和插件骨架

- [x] 1.1 建立 Spec 005.2 文档
  - 状态：DONE
  - 验证：四个主文档和补充文档入口已建立，需求、设计、任务可以互相追踪。
  - 对应需求：全部需求
  - 对应设计：§1、§7

- [x] 1.2 固定 DWS 发布版本和资产清单
  - 状态：DONE
  - 实现：固定官方 DWS `v1.0.68`、提交
    `ba02fc6cdbdb3543d21d0cdb70f027bf0d142692`、macOS/Linux 四个架构资产和
    SHA-256。
  - 文件：`packages/plugins/dingtalk-workspace/20261115-上游资产清单.json`
    和 `skills/dingtalk-setup/scripts/ensure-dws.sh`。
  - 验证：官方 macOS arm64 资产已安装并通过版本检查；安装器测试覆盖固定下载源、摘要错误和不覆盖未知版本。
  - 对应需求：需求 1、需求 5
  - 对应设计：§3.2.1、§3.3.1、§6.1

- [x] 1.3 完成 skills-only 插件骨架
  - 状态：DONE
  - 实现：新增 `plugin.json`、README、图标、中文本地化、许可证、NOTICE、安装技能和工作区路由技能。
  - 设计决策：只分发针对待办、消息、Drive/文档的本地简要指导；参数以固定 CLI 的动态 Schema 为准，不复制完整上游产品手册。
  - 验证：插件生成器可发现并打包 `dingtalk-workspace`；包导出回读和路径检查通过。
  - 对应需求：需求 1、需求 5
  - 对应设计：§2.1、§2.2、§3.1

- [x] 1.4 完成插件骨架阶段检查
  - 状态：DONE
  - 验证：`git diff --check`、Shell 语法检查、技能快速校验和插件专项测试通过。
  - 对应需求：需求 1、需求 5
  - 对应设计：§2、§3、§7

## 阶段 2：安装、授权和能力路由

- [x] 2.1 实现 DWS CLI 安装技能
  - 状态：DONE
  - 实现：`skills/dingtalk-setup/scripts/ensure-dws.sh` 固定版本和官方 HTTPS 下载地址，校验 SHA-256，拒绝相对路径和未知已有二进制，并在目标文件系统暂存安装。
  - 验证：当前 macOS arm64 已安装到
    `/Users/jackson/.local/share/outcomego/dws/v1.0.68/dws`，版本输出为
    `dws version v1.0.68`；专项测试覆盖缓存复用、平台拒绝、损坏归档和清理。
  - 对应需求：需求 1、需求 5
  - 对应设计：§2.3.1、§3.3.1、§5

- [x] 2.2 集成 DWS 个人授权和状态技能
  - 状态：DONE（组织授权门槛已确认）
  - 实现：提供设备流登录、只读状态检查、重登录和权限故障说明；包装脚本保持配置目录、凭据目录和 profile 参数。
  - 验证：真实设备流登录中扫码/授权步骤成功，随后被组织策略拒绝；失败后的只读状态为
    `authenticated: false`、`message: 未登录`。详见
    [`20261115-真实账号验收结果.md`](docs/20261115-真实账号验收结果.md)。
  - 对应需求：需求 1
  - 对应设计：§2.3.1、§4.2

- [x] 2.2.1 增加 Computer-side 状态和退出登录入口
  - 状态：DONE
  - 实现：新增 `dws-status.sh`，并在 setup Skill 中补充 `auth status`、`profile list`、`auth logout` 和 `auth reset` 的范围说明。
  - 验证：状态脚本只读转发 `auth status --readonly --format json`，退出登录仍通过当前 Computer 的 DWS profile 执行。
  - 对应需求：需求 1、需求 5
  - 对应设计：§2.3.2、§3.3.3、§4.2

- [x] 2.2.2 增加 portable auth bundle 一次性迁移
  - 状态：DONE
  - 实现：新增 `dws-auth-export.sh` 和 `dws-auth-import.sh`；导入限制在 workspace，验证 `authenticated: true` 后删除目标侧 bundle，失败时保留。
  - 迁移入口：用户 Computer 使用 `CopyToBox` 将 bundle 交给目标 Bot Computer；不通过聊天正文或插件 manifest 传递。
  - 验证：专项测试覆盖成功导入清理、状态不可信时保留、workspace 外路径拒绝和导出路径限制。
  - 对应需求：需求 1、需求 5
  - 对应设计：§2.3.2、§3.3.3、§4.2、§6.4

- [x] 2.3 实现待办、消息、事件、Drive 和文档路由
  - 状态：DONE（能力契约已验证，真实资源读取受组织策略阻塞）
  - 实现：工作区技能覆盖三项用户目标，引用待办、消息和文档操作材料；命令参数通过 DWS Schema 查询。
  - Schema 验证：
    - 待办读取：`todo +get-related-tasks`
    - 消息读取：`chat +chat-messages`
    - Drive 搜索：`drive +search`
    - 文档读取：`doc +fetch`
    - 写入契约已检查但未执行：`todo +complete`、`todo +update`、
      `chat +messages-reply`、`doc +update`
    - `event +listen-im` 识别为会创建订阅的效果写操作，本次未运行。
  - 对应需求：需求 2、需求 3、需求 4
  - 对应设计：§2.2、§2.3.2、§2.3.3、§3.3.3

- [x] 2.4 完成授权和能力阶段检查
  - 状态：DONE（离线检查通过；在线业务检查 BLOCKED）
  - 验证：安装器、包装脚本、插件导出、技能引用和十个 CLI Schema 检查通过；组织未授权个人 CLI 数据访问，无法继续真实资源读取。
  - 对应需求：需求 1、需求 2、需求 3、需求 4
  - 对应设计：§4.2、§5、§7

## 阶段 3：验证、文档和验收

- [ ] 3.1 验证待办查看和处理
  - 状态：BLOCKED
  - 已完成：待办只读命令 Schema 和路由检查。
  - 未完成：真实待办读取、更新或完成；用户明确选择本轮只读检查，因此没有执行写入。
  - 阻塞原因：组织未授权通过 CLI 访问个人数据。
  - 对应需求：需求 2

- [ ] 3.2 验证消息查看和回复
  - 状态：BLOCKED
  - 已完成：消息读取和回复 Schema 检查；确认应用提醒不一定存在可回复会话。
  - 未完成：真实消息读取和回复；本轮没有发送消息。
  - 阻塞原因：组织未授权通过 CLI 访问个人数据。
  - 对应需求：需求 3

- [ ] 3.3 验证 Drive 文档查看和编辑
  - 状态：BLOCKED
  - 已完成：Drive 搜索、文档读取和更新 Schema 检查。
  - 未完成：真实 Drive/文档读取和编辑；本轮没有修改文档。
  - 阻塞原因：组织未授权通过 CLI 访问个人数据。
  - 对应需求：需求 4

- [x] 3.4 完成插件目录、类型和测试
  - 状态：DONE（专项检查通过；完整套件有一个既有超时）
  - 验证范围：插件生成器、TypeScript 类型检查、专项测试和插件完整测试；不启动开发服务器。
  - 结果：生成器和类型检查通过；DWS 专项测试 10/10 通过；完整插件测试 409 通过、19 跳过、1 失败。失败是既有 Signal chaos 测试的 5 秒超时，单独重跑该测试文件后 6/6 通过。
  - 说明：写入测试按用户选择未执行，不能把只读/Schema 检查描述为写入验收。
  - 对应需求：需求 5
  - 对应设计：§7

## 阶段 4：后续在线验收

- [ ] 4.1 管理员开启组织 CLI 个人数据访问
  - 状态：WAITING
  - 管理入口：`https://open-dev.dingtalk.com/fe/old#/developerSettings`
  - 完成条件：管理员开启访问后，重新执行设备流登录并确认 DWS 通过组织策略检查。

- [ ] 4.2 重新执行三类资源只读验收
  - 状态：WAITING
  - 完成条件：在不写入资源的前提下读取待办、消息和授权 Drive/文档，并记录脱敏结果。

- [ ] 4.3 受控写入验收
  - 状态：WAITING（需用户另行授权和测试目标）
  - 完成条件：使用明确指定的测试待办、测试消息会话和测试文档，分别验证待办处理、消息回复和文档编辑后的读回结果。
