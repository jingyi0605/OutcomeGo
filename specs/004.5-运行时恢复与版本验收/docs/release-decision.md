# 运行时恢复与版本验收发布决策

2026-11-17，第 3 波 task-26 / task-30。决策：**本机已验证范围 PASS；正式发布仍 BLOCKED/PENDING**，不能表述为整个 Spec 或 CI 已完成。

最终四包合计 **3988 PASS / 0 FAIL / 82 SKIP / 52881 assertions**；专库九项恢复另行通过，六类真实本地 CLI 共 40/40 checks。Computer/Messaging 生产冻结 `5e2ce81d8`，Server/Worker 纯测试后继 `727d410f2`，无生产差异。精确矩阵/命令/日志 SHA/skip inventory 见[最终本机结果](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收最终本机结果.md)。没有再次运行整个 Turbo root 或远端 CI。

| 门槛 | 当前证据 | 状态/负责人 |
|---|---|---|
| canonical 本地四包完整回归 | Computer 1360/0/68；Messaging 857/0/0；Server 1535/0/11；Worker 236/0/3，实际 fresh DB 串行 | PASS（本机指定环境）；73 个平台/外部 skip 未执行 |
| 普通聊天/Group/Routine/Memory/Stop 与恢复 | 最新完整 Server/Worker 实际通过，独立 startup 6/0、dispatch fence 3/0 | PASS（本地）；真实 UI/远端隔离仍 PENDING |
| canonical 激活与审计 | 原 51 个 legacy fixture 补齐；后续新增后 integrator checker 52 文件、纯测试 3 PASS/26 | PASS（入口/静态，不等于远端 CI） |
| 六场景 §42 JSON/DB | 本地进程真实退出、receipt 回滚/统一 Review、unknown 不重试，40 checks | PASS（本地）；远端 Computer/provider PENDING |
| metrics/诊断 canary | 四个 recovery-service DB 案例与 cross-phase canary/attention 幂等/事实 N/Q 查询通过 | PASS（本地查询/诊断）；T 未上报为 null |
| live UI attention/provider 日志/普遍 PII 审计/latency percentile | 未采集实际线上或设备样本，分位数未观测 | PENDING，Req12；不能由 canary 推断 |
| 备份 unknown table/missing target/orphan | integrator 实际 validator 23 项及 CLI 7/7 负例通过 | PASS（本地），不等于旧镜像回退 |
| 同版本 pg_dump/restore | 86 表内容摘要/行数一致，22 表有数据、123 FK validated，dump 333755 bytes | PASS（本地），原 dump 保留 |
| Planning/Explore populated rollback | 本次这两类表无数据 | PENDING，完整 3.4 不关闭 |
| 关闭 Outcome 入口 | 已有本地 feature-off route/compose 证据由 integrator 提供；真实环境关闭未演练 | 本地 PASS / 真实环境 PENDING |
| populated Outcome 表回退旧镜像 | 没有旧 image digest/运行日志与数据对账 | PENDING，发布负责人 |
| 远端 CI | 没有本次 GitHub/远端 runner 成功记录；未 push | PENDING，lead/发布负责人 |
| 真实 Bot/live API/远端 Computer/真实模型与 provider | 没有部署与真实回放；不以 fixture ID 替代 | PENDING；004.2 3.1/3.2/3.4 正式 BLOCKED |
| Desktop/Android/iOS 安装、签名、更新、真实设备 | 客户端 lane 分别持有本地证据；iOS 完整 App/实际安装设备矩阵未补齐 | PENDING，客户端/发布负责人 |

本机 004.5 3.1/3.3/3.5 在明确范围 DONE；3.2、3.4、最终发布与需求 12 外部观察继续 OPEN。真实外部门槛需要相应授权与证据，不增加框架、不伪造运行 ID 或 provider 发送结果。

## 历史失败保留

首轮 root 退出 1：6570 PASS / **351 failed occurrences** / 102 SKIP，340 个去重 package/file/title keys（Server 294 occurrences / 283 keys）；中间 server2 1445/69/11；首次 final-source Server 1534/1/11、Worker 234/2/3，专库 startup 5/1。raw 与 SHA 全部保留，不能覆盖或声称那些命令通过。Task60/61 最后测试 fixture 的原始 red 经过真实修正、新库整包复验后通过；其他真实产品缺陷由 34–59 原 owner 修复。最新 PASS 不把历史 root 变成 CI 成功。

badge 首次失败时的两条无关事实 producer 仍未知；事后导出全 0 无法反推原来源。受控 reply/reaction 两事实复现和 fixture 修复的证明另存。此未知历史归属不等同于未关闭的当前产品缺陷。

回退优先保留新 schema/数据并关闭 Outcome 入口；旧镜像只对可丢弃副本演练，不删除 Outcome 表迁就旧镜像，不通过 SQL 改业务状态。旧镜像失败日志未产生，不能编造。后续需保存旧/新镜像 digest、schema fingerprint、备份 SHA、实际拒绝或启动日志与对账。最终 docs/evidence 提交可单独撤销，无 schema 变化；本线依赖 merge 不交给集成 cherry-pick。原日志、dump、基线源码、APK 与工作树均保留，清理仅本线一次性库/fixture。
