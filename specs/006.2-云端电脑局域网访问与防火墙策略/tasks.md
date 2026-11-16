# 任务清单 - 云端电脑局域网访问与防火墙策略（人话版）

状态：IN_PROGRESS

## 这份文档是干什么的

这份任务清单把 Computer 网络策略、服务端持久化、模型端点例外和 Settings → Server Modal 拆成可验证步骤。每个任务都引用 `requirements.md` 和 `design.md`，完成后立即回写状态。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

---

## 阶段 1：Spec 与回归基线

- [x] 1.1 建立 Spec 目录和主文档
  - 状态：DONE
  - 这一步到底做什么：复制模板并建立需求、设计、任务和补充文档入口。
  - 做完你能看到什么：`specs/006.2-云端电脑局域网访问与防火墙策略/` 下有完整主文档结构。
  - 先依赖什么：无
  - 开始前先看：`specs/000-Spec规范/Spec模板/`
  - 主要改哪里：当前 Spec 目录
  - 这一步先不做什么：不修改业务代码。
  - 怎么算完成：主文档互相引用，内容使用中文。
  - 怎么验证：检查目录结构和文档内容。
  - 对应需求：全部需求
  - 对应设计：`design.md` §1

- [x] 1.2 记录 beta.16/beta.17 网络差异
  - 状态：DONE
  - 这一步到底做什么：固定回归证据、引入 commit、当前生产 nftables 状态和模型端点失败路径。
  - 做完你能看到什么：后续实现可以对照真实故障验证，不会只修复 UI 表象。
  - 先依赖什么：1.1
  - 开始前先看：`requirements.md` 需求 1、需求 3；beta.16/beta.17 git diff。
  - 主要改哪里：`requirements.md`、`design.md`
  - 这一步先不做什么：不改变生产环境。
  - 怎么算完成：Spec 明确 default deny、beta.17 回归、模型端点和安全边界。
  - 怎么验证：本地 git 历史和生产容器只读证据。
  - 对应需求：`requirements.md` 需求 1、需求 3
  - 对应设计：`design.md` §1、§2.3

### 阶段检查

- [x] 1.3 Spec 基线检查
  - 状态：DONE
  - 这一步到底做什么：确认需求、设计和任务可以逐项追踪到代码入口和验证方式。
  - 做完你能看到什么：可以开始数据库和服务端实现。
  - 先依赖什么：1.1、1.2
  - 开始前先看：当前 Spec 全部文件
  - 主要改哪里：Spec 文档
  - 这一步先不做什么：不追加新策略模式。
  - 怎么算完成：每条验收标准都有设计章节和任务入口。
  - 怎么验证：人工走查。
  - 对应需求：全部需求
  - 对应设计：`design.md` 全文

## 阶段 2：服务端策略与接口

- [ ] 2.1 增加策略数据模型和迁移
  - 状态：TODO
  - 这一步到底做什么：新增全局 `ComputerNetworkPolicy`，实现 `lan` 默认值、规则 JSON 和 revision。
  - 做完你能看到什么：新部署和升级部署都能读取合法的默认策略。
  - 先依赖什么：1.3
  - 开始前先看：`requirements.md` 需求 1、需求 2；`design.md` §3.2、§4.1。
  - 主要改哪里：`packages/db/prisma/schema.prisma`、数据库迁移目录、`packages/db` 测试。
  - 这一步先不做什么：不连接 Computer，不写 UI。
  - 怎么算完成：迁移可执行，旧数据库能得到 `lan` global 行，非法数据会被拒绝。
  - 怎么验证：Prisma schema 校验、fresh schema test、升级迁移 test。
  - 对应需求：`requirements.md` 需求 1.1、需求 2.1
  - 对应设计：`design.md` §3.2、§4.1

- [ ] 2.2 实现策略服务和用户 API
  - 状态：TODO
  - 这一步到底做什么：实现读取、更新、输入校验、CAS revision 和 runtime 状态组合。
  - 做完你能看到什么：Desktop 可以通过 API 管理策略，冲突返回 409。
  - 先依赖什么：2.1
  - 开始前先看：`requirements.md` 需求 1、需求 2、需求 4；`design.md` §3.3.1、§3.3.2、§5。
  - 主要改哪里：`apps/server/src/services/computer-network-policy-service.ts`、`apps/server/src/main.ts`、`apps/server/test/`、`packages/contracts/src/`。
  - 这一步先不做什么：不直接执行 nftables，不修改公共 BrowserNetworkService。
  - 怎么算完成：API 能读写两种模式，输入和 revision 都有覆盖，返回结构不含密钥。
  - 怎么验证：server unit/integration tests、API route tests。
  - 对应需求：`requirements.md` 需求 1、需求 2.1、需求 4.1、需求 4.4
  - 对应设计：`design.md` §3.2、§3.3、§5

- [ ] 2.3 增加 Computer 内部策略接口和应用状态
  - 状态：TODO
  - 这一步到底做什么：提供 control token 保护的策略快照接口，并让 Computer 回报应用状态。
  - 做完你能看到什么：Server 能区分策略已保存、Computer 正在应用和实际已应用。
  - 先依赖什么：2.2
  - 开始前先看：`requirements.md` 需求 2.2-2.5；`design.md` §2.3.4、§3.3.3、§3.3.4、§4.2。
  - 主要改哪里：`apps/server/src/main.ts`、`apps/server/src/app-service.ts`、`apps/computer/src/main.ts`、相关 contract。
  - 这一步先不做什么：不引入 Desktop UI。
  - 怎么算完成：未授权请求失败，旧 Computer 显示 unknown/legacy，状态错误不泄露凭据。
  - 怎么验证：server/computer HTTP tests、control token tests。
  - 对应需求：`requirements.md` 需求 2.2-2.5、需求 4.1、需求 4.5
  - 对应设计：`design.md` §3.3、§4.2、§5

### 阶段检查

- [ ] 2.4 阶段检查：服务端策略主链路
  - 状态：TODO
  - 这一步到底做什么：检查数据库、用户 API、内部 API、revision 和状态模型是否形成闭环。
  - 做完你能看到什么：可以开始 Computer reconciler，不需要再改数据契约。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：当前 Spec 全部文件
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不新增 UI 需求。
  - 怎么算完成：主链路测试通过，错误码和状态语义已固定。
  - 怎么验证：完整 server/db focused tests。
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 4
  - 对应设计：`design.md` §3、§4、§5

## 阶段 3：Computer 策略编译与模型端点

- [ ] 3.1 统一模型端点提取和目的地校验
  - 状态：TODO
  - 这一步到底做什么：从 `models.json` 提取合法私有 IP 字面量、端口和模型 provider 信息。
  - 做完你能看到什么：`10.255.0.83:3425` 可被识别，公共和非法端点不会绕过托管出口。
  - 先依赖什么：1.3
  - 开始前先看：`requirements.md` 需求 3；`design.md` §2.3.2、§3.1、§6.3。
  - 主要改哪里：`apps/computer/src/models-config.ts` 或网络策略模块、Python helper tests。
  - 这一步先不做什么：不允许域名解析为私有地址，不改变 UI。
  - 怎么算完成：覆盖合法、删除、替换、非法 URL、公共地址和权限异常。
  - 怎么验证：Python/Bun focused tests。
  - 对应需求：`requirements.md` 需求 3.1-3.3
  - 对应设计：`design.md` §3.2.2、§6.3

- [ ] 3.2 实现两种模式和原子 nftables 应用
  - 状态：TODO
  - 这一步到底做什么：让 Computer 合并服务端策略、模型端点和 host bridge，并安全更新 nftables/ip rule。
  - 做完你能看到什么：lan、allowlist 都能按预期控制私有 TCP；应用失败保持旧规则。
  - 先依赖什么：2.3、3.1
  - 开始前先看：`requirements.md` 需求 1、需求 2、需求 3；`design.md` §2.3.2、§2.3.3、§4.2、§6.1-§6.3。
  - 主要改哪里：`apps/computer/src/browser-network-worker.ts`、`apps/computer/src/computer-network-policy.ts`、`docker/outcomego-computer-network.py`、network integration tests。
  - 这一步先不做什么：不允许 UDP、不开放任意公网 direct route。
  - 怎么算完成：策略变化、模型变化、重启、断线和 helper 失败均有状态和测试。
  - 怎么验证：Linux network fixture、Computer tests、生产镜像 smoke test。
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3
  - 对应设计：`design.md` §2.3.2、§2.3.3、§4.2、§6

### 阶段检查

- [ ] 3.3 阶段检查：真实 LAN 模型回放
  - 状态：TODO
  - 这一步到底做什么：使用生产同构网络验证 `10.255.0.83:3425` 和公共模型 provider 的分流。
  - 做完你能看到什么：机器人可以对话，公共出口和私有模型路径互不误用。
  - 先依赖什么：3.1、3.2
  - 开始前先看：当前 Spec 全部文件
  - 主要改哪里：测试 fixture、镜像构建配置和验证脚本
  - 这一步先不做什么：不修改生产运行中的容器。
  - 怎么算完成：模型 discovery、chat completion、规则删除和重启恢复都有证据。
  - 怎么验证：隔离容器集成测试；生产只读连通性检查。
  - 对应需求：`requirements.md` 需求 1、需求 3
  - 对应设计：`design.md` §2.3.3、§7.2、§7.3

## 阶段 4：Settings → Server Modal

- [ ] 4.1 增加策略 API client 和 Server 设置入口
  - 状态：TODO
  - 这一步到底做什么：让 Desktop Server 设置加载策略、runtime 状态和保存接口。
  - 做完你能看到什么：设置页有“Computer network policy”入口，但尚未完成完整编辑交互。
  - 先依赖什么：2.2、2.3
  - 开始前先看：`requirements.md` 需求 4；`design.md` §3.3.1、§3.3.2、§7.3。
  - 主要改哪里：`packages/client-core/src/client.ts`、`apps/desktop/src/renderer/components/outcomego/settings/server.tsx`、类型和测试。
  - 这一步先不做什么：不直接写本地 firewall 命令。
  - 怎么算完成：API 类型和错误映射完整，Server settings 页面能打开 Modal。
  - 怎么验证：client/server settings tests。
  - 对应需求：`requirements.md` 需求 4.1、需求 4.6
  - 对应设计：`design.md` §3.3.1、§3.3.2

- [ ] 4.2 实现模式、规则编辑和应用状态 Modal
  - 状态：TODO
  - 这一步到底做什么：实现模式说明、规则新增编辑删除、确认、冲突刷新和 applying/error 展示。
  - 做完你能看到什么：用户不需要 SSH 或执行 nft 命令即可管理策略。
  - 先依赖什么：4.1、3.3
  - 开始前先看：`requirements.md` 需求 4.2-4.5；`design.md` §2.3.1、§3.2.2、§4.2、§5。
  - 主要改哪里：`apps/desktop/src/renderer/components/outcomego/settings/computer-network-policy.tsx`、CSS、renderer tests、i18n catalog。
  - 这一步先不做什么：不提供任意 shell 或 nftables 文本输入。
  - 怎么算完成：两种模式、规则验证、revision 冲突、状态刷新、旧策略保留都有测试。
  - 怎么验证：Bun renderer tests、browser settings tests、手工 UI 检查。
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §3.2.2、§3.3、§7.1、§7.3

### 阶段检查

- [ ] 4.3 阶段检查：图形化策略闭环
  - 状态：TODO
  - 这一步到底做什么：走通 Settings → Server 打开、保存、等待应用、失败恢复和重新加载。
  - 做完你能看到什么：UI 状态与服务端/Computer 实际状态一致。
  - 先依赖什么：4.1、4.2
  - 开始前先看：当前 Spec 全部文件
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不添加策略以外的新设置。
  - 怎么算完成：两种模式和真实 Computer 状态都能人工验收。
  - 怎么验证：renderer/API integration tests、隔离部署回放。
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.1、§2.3.4、§7.3

## 阶段 6：出口连通性、可观察性与回归防护

- [x] 6.1 公共出口回包不依赖 `rp_filter`
  - 状态：DONE
  - 这一步到底做什么：在 `nft_ruleset()` 增加 `rpf` 链，设置 `src_valid_mark=1`，并为容器直连网段安装 `ip rule pref 94`。
  - 做完你能看到什么：容器创建后即使 `rp_filter` 被重置为 2，公共地址回包和宿主机对容器的 ARP 请求仍然正常。
  - 先依赖什么：3.2
  - 开始前先看：`requirements.md` 需求 5.1、需求 5.2；`design.md` §2.3.5、§6.5。
  - 主要改哪里：`docker/outcomego-computer-network.py`、`scripts/imessage-bridge-linux/test_network.py`。
  - 这一步先不做什么：不追查 `rp_filter` 被重置的原因，不引入新的内核参数轮询。
  - 怎么算完成：`rpf` 链、`disable_reverse_path_filter()` 和 `connected_prefixes()` 有单元测试，新建容器在 `rp_filter=2` 下能访问公网。
  - 怎么验证：`python3 scripts/imessage-bridge-linux/test_network.py`；调试环境强制重建后 `debug.sh check`。
  - 对应需求：`requirements.md` 需求 5.1、需求 5.2
  - 对应设计：`design.md` §2.3.5、§6.5

- [x] 6.2 修复出口复验子进程拒绝 `ipv4`/`ipv6` 探测
  - 状态：DONE
  - 这一步到底做什么：让复验子进程接受 `ipv4`/`ipv6`，并把探测类型收成 `computerProbeKinds`，发送方和入口共用。
  - 做完你能看到什么：探测通过后 TUN 默认路由不再被立刻撤销，表 18791 中保留 `default dev outcomego0`。
  - 先依赖什么：6.1
  - 开始前先看：`requirements.md` 需求 5.5；`design.md` §2.3.5。
  - 主要改哪里：`apps/computer/src/computer-network-probe.ts`、`apps/computer/src/browser-network-worker.ts`、`apps/computer/test/computer-network-probe.test.ts`。
  - 这一步先不做什么：不改探测目标和超时。
  - 怎么算完成：`parseComputerProbeRequest()` 接受全部 `computerProbeKinds`，拒绝非法请求；`verify` 使用的 family 是其子集。
  - 怎么验证：`bun test apps/computer/test/computer-network-probe.test.ts`、`bunx tsc --noEmit -p apps/computer/tsconfig.json`。
  - 对应需求：`requirements.md` 需求 5.5
  - 对应设计：`design.md` §2.3.5、§6.6

- [x] 6.3 复验失败原因码和 `connectivity` 状态可见
  - 状态：DONE
  - 这一步到底做什么：复验失败时输出固定原因码；`GET /v1/browser-network` 返回 `connectivity`。
  - 做完你能看到什么：出口不可用时，日志和状态接口直接给出 IPv4/IPv6 状态和原因。
  - 先依赖什么：6.2
  - 开始前先看：`requirements.md` 需求 5.3、需求 5.4；`design.md` §3.3.5、§5.1、§6.6。
  - 主要改哪里：`apps/computer/src/computer-network-probe.ts`、`apps/computer/src/browser-network-worker.ts`、`apps/computer/src/browser-network.ts`。
  - 这一步先不做什么：不转发子进程输出，不把原因码放进用户 API 错误。
  - 怎么算完成：原因码只取 `timeout`、`aborted`、`exit_<code>`、`bad_output`、`spawn_failed`，主进程按格式校验后才记录。
  - 怎么验证：类型检查；调试环境读取 `/v1/browser-network` 的 `connectivity`。
  - 对应需求：`requirements.md` 需求 5.3、需求 5.4
  - 对应设计：`design.md` §3.3.5、§5.1、§6.6

- [x] 6.4 调试脚本使用真实流量检查并增加 `smoke`
  - 状态：DONE
  - 这一步到底做什么：`debug.sh check` 增加出口连通性、公网、局域网和宿主机邻居检查；新增 `debug.sh smoke`，强制重建后复测。
  - 做完你能看到什么：控制面正常但容器无法出网时，检查会失败并给出原因。
  - 先依赖什么：6.1、6.3
  - 开始前先看：`requirements.md` 需求 5.6、需求 5.7；`AGENTS.md` 的 Remote Debug Computer 一节。
  - 主要改哪里：`scripts/dev/debug.sh`。
  - 这一步先不做什么：不修改 `openteam-dev`，不触碰 `~/openteam-debug/data`。
  - 怎么算完成：`check` 在容器无法出网时失败；`smoke` 在新建容器上通过。
  - 怎么验证：`bash -n scripts/dev/debug.sh`；`scripts/dev/debug.sh smoke`。
  - 对应需求：`requirements.md` 需求 5.6、需求 5.7
  - 对应设计：`design.md` §2.3.5、§7.2、§8.1

### 阶段检查

- [x] 6.5 阶段检查：出口回归防护闭环
  - 状态：DONE
  - 这一步到底做什么：确认规则、探测契约、状态可见性和调试脚本能一起发现并阻止这类回归。
  - 做完你能看到什么：同类故障要么不会发生，要么在 `check` 中立即失败并带原因。
  - 先依赖什么：6.1、6.2、6.3、6.4
  - 开始前先看：当前 Spec 全部文件、`docs/20261116-云端电脑出网故障复盘与回归防护.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不查找 `rp_filter` 被重置的来源。
  - 怎么算完成：Python 和 Bun 测试通过，`smoke` 通过，调试环境验证记录已写入 `docs/`。
  - 怎么验证：见补充文档中的验证记录。
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.5、§6.5、§6.6、§7

## 阶段 5：生产恢复与发布

- [ ] 5.1 生产镜像和兼容升级
  - 状态：TODO
  - 这一步到底做什么：从干净 worktree 构建 Computer/Server 镜像，验证升级后策略默认值和数据迁移。
  - 做完你能看到什么：生产可通过版本化镜像升级，已有用户策略不丢失。
  - 先依赖什么：2.4、3.3、4.3、6.5
  - 开始前先看：`AGENTS.md`、发布技能、`design.md` §8。
  - 主要改哪里：版本、迁移、Docker image 和发布材料。
  - 这一步先不做什么：不覆盖用户当前未提交的源码变更。
  - 怎么算完成：镜像构建、迁移、Computer health、模型 discovery 和真实 bot turn 通过。
  - 怎么验证：发布前检查、远端滚动重建、生产健康检查。
  - 对应需求：全部需求
  - 对应设计：`design.md` §4、§7、§8

- [ ] 5.2 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认需求、设计、任务、代码、UI、测试和生产证据逐项对应。
  - 做完你能看到什么：LAN 策略功能完成，beta.17 回归被修复，后续维护者可以追踪所有边界。
  - 先依赖什么：5.1
  - 开始前先看：`requirements.md`、`design.md`、`tasks.md`、`docs/`
  - 主要改哪里：当前 Spec 全部文件和相关实现
  - 这一步先不做什么：不追加域名私网解析、UDP 或跨部署策略。
  - 怎么算完成：所有关键任务 DONE，风险和未实现项已写明，生产 bot turn 成功。
  - 怎么验证：完整测试集、发布检查和人工验收清单。
  - 对应需求：全部需求
  - 对应设计：`design.md` 全文
