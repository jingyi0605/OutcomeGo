# 运行时恢复与版本验收发布决策

2026-11-17，第 3 波 task-26 / task-30。决策：**BLOCKED，不放行发布**。

本线已经执行独立一次性 PostgreSQL 上的 schema 首次部署/重复部署、完整 canonical 根命令、六类故障 CLI 和真实服务定向复验。根命令退出 1，实际 `6570 PASS / 351 FAIL / 102 SKIP`。没有执行发布、push、旧镜像启动、远端 rebuild 或设备操作，没有 CI 全绿证据。原始日志摘要与各失败身份见 [首轮结果](../../004-OutcomeGo整体项目/docs/20261117-第3波后端组合验收首轮结果.md)。

| 门槛 | 当前证据 | 状态/负责人 |
|---|---|---|
| 第 0 波完整数据库与 CI | 历史失败基线仍在；所有数据库失败阻塞 | BLOCKED，lead/原失败负责线 |
| canonical 全量激活 | 51 个文件/57 处 legacy URL 读取支持 canonical；根命令串行、25 个 Turbo 任务均实际执行 | PASS（覆盖激活）；整体 4 包失败继续 BLOCKED |
| 六场景实际 JSON/DB 对账 | 六个实际 JSON PASS，包含实际本地进程退出、真实 receipt 回滚、统一 Review、未知外部回执不重试 | PASS（本地一次性环境）；远端/provider PENDING |
| 普通聊天/Group/Routine/Memory/Stop | 跨阶段 11 PASS；首轮 server 294 FAIL / worker 51 FAIL；后续新库 server 1445 PASS / 69 FAIL / 11 SKIP，集成 memory 九文件 26 PASS / 534 assertions | BLOCKED，后续通过不覆盖首轮根结果，剩余失败继续修复 |
| 备份 unknown table/missing target/orphan | integrator 真实 validator 23 项及直接 CLI 7 / 7，通过三个原负例与最终 schema 关系校验；见[组合记录](../../004-OutcomeGo整体项目/docs/20261117-全规格组合验证与修复记录.md) | PASS（本地校验器与负例）；不等于旧镜像回退 |
| `pg_dump` / restore | 实际 86 表行数/内容摘要一致，22 表有数据、123 FK validated；六个实际故障 fixture，dump 333755 bytes | PASS（本地 PostgreSQL 同版本），见第二检查点；Planning/Explore 有数据回退仍 PENDING |
| 关闭 Outcome 入口 | 操作与断言已写手册；实际运行待验 | PENDING，恢复/集成负责人 |
| populated Outcome 表回退旧镜像 | 已知 schema/fingerprint 风险；没有旧镜像运行日志 | PENDING，发布负责人 |
| metrics/日志不含敏感正文 | 真实 metrics/attention 幂等与 provider error canary 检查 PASS，日志只使用虚构 fixture | PASS（本地查询与诊断）；远端复核 PENDING |
| 远端 Computer、live API/真实模型 | 没有部署授权与本次回放 | PENDING，lead |
| Desktop/Android/iOS 安装/签名/更新 | 其他 lane 提供各自证据；本线未执行 | PENDING，客户端/发布负责人 |

旧镜像实际失败日志尚未产生，不能编造错误文本；完整根测试的真实失败日志已归档，不能表述为没有失败证据。后续旧镜像演练必须归档完整命令、旧/新 image digest、schema fingerprint、备份 SHA-256、实际拒绝或启动日志和对账；日志存储前检查没有 token、密钥、资料全文和 Decision 自定义文字。

回退优先保留新 schema/数据并关闭 Outcome 入口。旧镜像只对可丢弃副本演练，不删除 Outcome 表迁就旧镜像，不通过 SQL 改业务状态掩盖失败。入口关闭与镜像回退是两个独立门槛。

代码回滚只撤销本线脚手架/测试/文档提交；`870ebac90` 是依赖合并，不应把其他 lane 已集成实现整体回滚。本线没有新增 schema。正式数据回退需要保留已填充 Outcome 数据及人工证据，遵守父 design §16/§36 与 004.5 §48。
