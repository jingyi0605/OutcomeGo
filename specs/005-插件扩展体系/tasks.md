# 任务清单 - 插件扩展体系（人话版）

状态：Draft

关联文档：[README.md](README.md) · [requirements.md](requirements.md) · [design.md](design.md)

## 这份文档是做什么的

这份父级任务清单负责安排插件扩展体系和子规格的交付顺序。具体 provider 的代码任务放在对应 `005.x/tasks.md` 中；父级任务只负责共同契约、跨插件检查、子规格追踪和最终验收。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住，必须写清楚阻塞原因
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写清楚原因

## 阶段 1：插件体系基线和共同契约

- [ ] 1.1 盘点现有插件类型和生命周期
  - 状态：TODO
  - 这一步到底做什么：盘点 Skills-only、Remote MCP、Packaged MCP、Hybrid、plugin runtime fields、connector accounts、Skill cache、MCP runtime 和 1Password 现状。
  - 做完你能看到什么：有一份当前能力矩阵，明确每种插件的配置存储、运行位置、worker scope、更新和卸载路径。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 5、需求 8
    - `design.md` §2、§3、§5、§7
    - `packages/plugins/README.md`
    - `packages/plugins/1password/`
    - `apps/server/src/services/plugin/`
  - 主要改哪里：
    - `specs/005-插件扩展体系/docs/`
    - 必要时新增无代码的 capability matrix
  - 这一步先不做什么：不修改现有插件行为，不为未来 provider 添加空接口。
  - 怎么算完成：
    1. 每种插件类型都有逻辑权威、运行位置、配置位置和退出路径。
    2. 1Password 的 direct read、browser worker 和 token lifecycle 有证据引用。
    3. 005.1 的共享依赖被列入父级矩阵。
  - 怎么验证：
    - 人工走查代码和现有插件测试
    - 检查矩阵中的文件路径均存在
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 5、需求 8
  - 对应设计：`design.md` §2、§3、§5、§7

- [ ] 1.2 固定插件 package 和 runtime field 共同契约
  - 状态：TODO
  - 这一步到底做什么：将普通 runtime field、secret field、Skill scope、connector tool risk、package revision 和公开配置视图的规则写成可测试契约。
  - 做完你能看到什么：新增插件可以只依赖稳定 SDK 契约，不需要复制 server 级字段和生命周期逻辑。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 3、需求 4、需求 6
    - `design.md` §3、§4、§6、§7.2
    - `packages/plugin-sdk/src/types.ts`
    - `packages/plugin-sdk/src/manifest.ts`
    - `packages/plugin-sdk/src/configuration.ts`
  - 主要改哪里：
    - `packages/plugin-sdk/src/types.ts`
    - `packages/plugin-sdk/src/manifest.ts`
    - `packages/plugin-sdk/src/configuration.ts`
    - `packages/plugin-sdk/test/`
  - 这一步先不做什么：不引入通用 IAM、策略引擎或多租户授权。
  - 怎么算完成：
    1. runtime field 的 secret/non-secret 组合有明确校验。
    2. package revision、Skill agents 和 connector risk 有测试样例。
    3. 现有插件 manifest 和测试继续通过。
  - 怎么验证：
    - `bun test packages/plugin-sdk/test`
    - `bun run --cwd packages/plugin-sdk typecheck`
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 4、需求 6
  - 对应设计：`design.md` §3、§4、§6

- [ ] 1.3 共同契约阶段检查点
  - 状态：TODO
  - 这一步到底做什么：确认 package、runtime field、Skill scope、tool risk 和公开 view 的契约已经可以供 005.1 使用。
  - 做完你能看到什么：005.1 可以开始实现，不需要在插件目录中临时改变共享协议。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md` 阶段 1
    - `005.1/requirements.md`、`005.1/design.md`
  - 主要改哪里：阶段 1 相关文件和父级文档
  - 这一步先不做什么：不标记 005.1 已完成，不连接真实 provider。
  - 怎么算完成：
    1. 005.1 的共享依赖有明确任务和依赖关系。
    2. 1Password 回归边界已经写清楚。
    3. SDK/server/desktop 影响面和测试入口已登记。
  - 怎么验证：
    - 文档交叉引用检查
    - 相关 package tests 和 typecheck
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 10
  - 对应设计：`design.md` §3、§4、§9

## 阶段 2：凭据类插件扩展

- [ ] 2.1 完成 `005.1` Bitwarden/Vaultwarden 子规格
  - 状态：TODO
  - 这一步到底做什么：按 `005.1/tasks.md` 完成 runtime field 扩展、Bitwarden plugin package、固定 CLI、只读 wrapper、Bot/browser workflow 和 Vaultwarden 兼容矩阵。
  - 做完你能看到什么：OpenTeam 可以安装 Bitwarden/Vaultwarden 插件，Bot 能读取 username/password/TOTP 并完成测试网站登录。
  - 先依赖什么：1.3
  - 开始前先看：
    - [`005.1/README.md`](../005.1-Bitwarden与Vaultwarden凭据插件接入/README.md)
    - [`005.1/requirements.md`](../005.1-Bitwarden与Vaultwarden凭据插件接入/requirements.md)
    - [`005.1/design.md`](../005.1-Bitwarden与Vaultwarden凭据插件接入/design.md)
    - [`005.1/tasks.md`](../005.1-Bitwarden与Vaultwarden凭据插件接入/tasks.md)
  - 主要改哪里：由 `005.1/tasks.md` 定义。
  - 这一步先不做什么：不把 Bitwarden provider-specific 逻辑复制到通用 server，不实现 MCP connector 或 Vault 写入。
  - 怎么算完成：`005.1/tasks.md` 的最终检查点为 DONE，兼容性矩阵和验收记录已回填。
  - 怎么验证：执行 `005.1` 任务中登记的 SDK、server、worker、computer 和 Vaultwarden 验收命令。
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 6、需求 7、需求 9、需求 10
  - 对应设计：`design.md` §4、§6、§8、§9

- [ ] 2.2 凭据类插件共同边界检查
  - 状态：TODO
  - 这一步到底做什么：从 005.1 的实现中提取哪些行为属于通用 runtime field、secret redaction、direct read、browser Skill 和 provider wrapper，哪些仍属于 Bitwarden 专属逻辑。
  - 做完你能看到什么：不会把 Vaultwarden 的特殊处理误加入所有插件，也不会让其他凭据插件重复实现通用清理逻辑。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 6、需求 7
    - `design.md` §4、§6、§8
    - `005.1` 的实现提交和兼容性文档
  - 主要改哪里：
    - 父级 `docs/`
    - 必要时 `packages/plugin-sdk`、server runtime 或测试
  - 这一步先不做什么：不创建 005.2，除非确实有第二个插件需求证明共享抽象不足。
  - 怎么算完成：
    1. 通用变化和 provider-specific 变化有明确列表。
    2. 1Password、Bitwarden 和现有 connector 的共同行为有回归测试。
    3. 后续插件可以引用清晰的扩展点。
  - 怎么验证：
    - 代码走查
    - 相关 plugin/sdk/runtime tests
    - 父级 capability matrix 更新
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 6、需求 10
  - 对应设计：`design.md` §2.3、§4、§6、§9

### 阶段检查

- [ ] 2.3 凭据类插件阶段检查点
  - 状态：TODO
  - 这一步到底做什么：确认至少一个凭据类插件能从安装到 Bot/browser 使用完成闭环，并且现有 1Password 不回归。
  - 做完你能看到什么：插件扩展体系有真实 provider 证据，而不是只通过 manifest 测试。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - 父 `requirements.md` 需求 3、需求 4、需求 6、需求 7、需求 9
    - `005.1` 全部主文档和验收记录
  - 主要改哪里：阶段 2 测试、兼容性矩阵和父级证据文件
  - 这一步先不做什么：不增加未评审的第二个密码管理器，不改变 005.1 的只读范围。
  - 怎么算完成：
    1. 005.1 子规格 DONE。
    2. 1Password 回归通过。
    3. 父级记录 provider、CLI、网络、TLS、浏览器和脱敏验证证据。
  - 怎么验证：按父级插件验收场景 1、4、6、7 回放。
  - 对应需求：`requirements.md` 需求 3、需求 6、需求 7、需求 9
  - 对应设计：`design.md` §6、§8、§9

## 阶段 3：插件生命周期、连接和发布质量

- [ ] 3.1 建立跨插件生命周期回归矩阵
  - 状态：TODO
  - 这一步到底做什么：对现有插件和 005.1 统一验证安装、配置、认证、工具刷新、更新、回滚、账号移除和卸载。
  - 做完你能看到什么：每种插件类型都有可重复的 lifecycle matrix，而不是只测试安装成功。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 8、需求 9
    - `design.md` §5、§7、§8
    - `apps/server/test/plugin/`
  - 主要改哪里：
    - `apps/server/test/plugin/`
    - `apps/computer/test/runtime/`
    - `packages/plugin-sdk/test/`
    - `specs/005-插件扩展体系/docs/`
  - 这一步先不做什么：不新增 provider 功能，不修改账号数据模型以支持未验证的未来场景。
  - 怎么算完成：
    1. Skills-only、Remote MCP、Packaged MCP、Hybrid 都有至少一个 lifecycle fixture。
    2. 更新和回滚验证兼容账号与运行值边界。
    3. 卸载验证连接、secret、cache 和子进程清理。
  - 怎么验证：相关 server/computer/plugin tests 和 fixture replay。
  - 对应需求：`requirements.md` 需求 3、需求 8、需求 9
  - 对应设计：`design.md` §5、§7、§8

- [ ] 3.2 建立插件来源和 package release 检查
  - 状态：TODO
  - 这一步到底做什么：统一检查版本、registry、source revision、二进制完整性、包导出、安装缓存和回滚资产。
  - 做完你能看到什么：插件升级有可复核的 package digest、变更摘要和回滚来源。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 7、需求 9
    - `design.md` §3.2、§5.3、§7.2、§7.3
    - `packages/plugins/scripts/generate.ts`
    - `packages/plugins/src/`
  - 主要改哪里：
    - `packages/plugins/scripts/`
    - `packages/plugin-sdk/src/`
    - `apps/server/test/plugin/`
    - 父级发布和兼容性文档
  - 这一步先不做什么：不接入通用 marketplace 发布服务，不改变已有插件来源策略。
  - 怎么算完成：
    1. package revision 可重复生成。
    2. 上游文件和二进制完整性失败时安装/更新失败。
    3. 导出包不包含 credentials、runtime fields 或 OAuth session。
  - 怎么验证：`packages/plugins` generate/upstream/package tests 和导出检查。
  - 对应需求：`requirements.md` 需求 1、需求 7、需求 9
  - 对应设计：`design.md` §3.2、§5.3、§7.2、§7.3

- [ ] 3.3 插件发布质量阶段检查点
  - 状态：TODO
  - 这一步到底做什么：确认插件可以在版本升级、runtime 重启和配置轮换后恢复，不依赖人工修改数据库或清理 secret 文件。
  - 做完你能看到什么：插件发布和回滚有统一的检查表和实际证据。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - 父 `requirements.md` 需求 3、需求 7、需求 8、需求 9
    - `design.md` §5、§7、§8
  - 主要改哪里：父级 docs、测试 fixture 和必要的通用生命周期代码
  - 这一步先不做什么：不替子规格声明 provider 兼容性，不把 pending 结果写成 passed。
  - 怎么算完成：
    1. 现有插件和 005.1 的升级/回滚矩阵通过。
    2. 所有失败场景有稳定 error code 和恢复方式。
    3. 活动、诊断和测试输出不含 secret。
  - 怎么验证：父级插件验收场景 2、3、5、6 和 lifecycle matrix。
  - 对应需求：`requirements.md` 需求 3、需求 6、需求 8、需求 9
  - 对应设计：`design.md` §5、§6、§7、§8

## 阶段 4：父级最终验收

- [ ] 4.1 更新插件扩展能力矩阵和子规格状态
  - 状态：TODO
  - 这一步到底做什么：汇总当前插件类型、已完成子规格、支持的 provider、runtime scope、兼容性、风险和未完成能力。
  - 做完你能看到什么：父 README、requirements、design、tasks 和 docs 中的状态一致。
  - 先依赖什么：2.3、3.3
  - 开始前先看：
    - 父级全部文档
    - `005.1` 全部文档和证据
    - 所有现有插件 README、manifest 和测试
  - 主要改哪里：
    - `specs/005-插件扩展体系/README.md`
    - `specs/005-插件扩展体系/docs/`
    - `specs/005.1` 状态和证据引用
  - 这一步先不做什么：不把预留的 005.2/005.3 标记完成。
  - 怎么算完成：
    1. 005.1 状态和父级状态一致。
    2. 每个已支持插件类型有事实来源和测试入口。
    3. 风险、未验证 provider 和待创建子规格明确列出。
  - 怎么验证：文档 link/path 检查和人工交叉走查。
  - 对应需求：`requirements.md` 需求 7、需求 9、需求 10
  - 对应设计：`design.md` §9、§10

- [ ] 4.2 执行父级插件验收场景
  - 状态：TODO
  - 这一步到底做什么：执行安装、双账号 connector、更新回滚、浏览器凭据、恶意 provider 内容、卸载清理和 1Password 回归场景。
  - 做完你能看到什么：父规格有一份可复核的端到端验收报告。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 1–10
    - `design.md` §8.5
    - `docs/20261112-插件扩展验收记录.md`
  - 主要改哪里：
    - `specs/005-插件扩展体系/docs/20261112-插件扩展验收记录.md`
    - 相关 fixture 和测试输出
  - 这一步先不做什么：不增加新的 provider 或临时绕过失败检查。
  - 怎么算完成：
    1. 七个父级验收场景都有结果。
    2. 失败、阻塞和待外部环境项有明确状态。
    3. 1Password 现有 direct read 和 browser workflow 不回归。
  - 怎么验证：父级 fixture replay、相关 package/server/computer tests 和人工检查。
  - 对应需求：全部需求
  - 对应设计：`design.md` §8.5、§9

- [ ] 4.3 父 Spec 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认插件扩展体系的需求、设计、任务、子规格和验证证据可以逐项追踪。
  - 做完你能看到什么：父 Spec 可以交付复核；后续 005.2/005.3 可以从明确的缺口继续，而不需要重做基础分析。
  - 先依赖什么：4.1、4.2
  - 开始前先看：
    - `README.md`
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前父 Spec 全部文件和子规格状态引用
  - 这一步先不做什么：不追加未评审能力，不把预留子规格当成交付结果。
  - 怎么算完成：
    1. 每条父需求都有任务和验证方式。
    2. 每个 DONE 子规格都有实现、测试和兼容性证据。
    3. 已知限制、风险、BLOCKED/PENDING 项和回滚方式已记录。
    4. 父 Spec 状态更新为可复核或 DONE。
  - 怎么验证：全量文档结构、内部链接、任务状态和验证证据检查。
  - 对应需求：全部需求
  - 对应设计：`design.md` 全文

## 子规格执行规则

每个 `005.x` 子规格必须：

1. 在 README 中链接父规格。
2. 明确自己使用的插件类型、worker scope、配置存储和 provider 版本。
3. 在 requirements、design、tasks 和 docs 中保持需求、设计、任务、验证可追踪。
4. 不复制父规格已经定义的 package、生命周期、secret redaction 或连接模型。
5. 完成时回写实现提交、测试命令、兼容性矩阵、已知限制和回滚方法。
6. 如果需要改变父规格共同契约，必须先在父级任务中记录影响，再修改共享 SDK/runtime。

## 证据登记模板

每个子规格完成阶段时，在对应 `docs/` 目录记录：

```text
子规格：005.x
插件类型：Skills-only / Remote MCP / Packaged MCP / Hybrid
实现提交：<commit>
Package revision：<digest>
数据库变化：<migration or none>
运行时变化：<paths>
测试命令：<commands>
兼容性矩阵：<path>
端到端回放：<fixture/report>
已知限制：<none or list>
回滚方法：<method>
复核日期：<date>
```
