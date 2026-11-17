# 运行时恢复与版本验收发布决策

2026-11-17，第 3 波 task-26。决策：**BLOCKED，不放行发布**。

本次交付固定 fixture、合同检查、故障回放脚手架和测试入口修复，没有执行发布、push、数据库备份/恢复、旧镜像启动、远端 rebuild 或设备操作。没有 CI 全绿证据。

| 门槛 | 当前证据 | 状态/负责人 |
|---|---|---|
| 第 0 波完整数据库与 CI | 历史失败基线仍在；所有数据库失败阻塞 | BLOCKED，lead/原失败负责线 |
| canonical 全量激活 | 543eef450 已修 51 个 legacy 读取点；新的实际集合未跑 | PENDING，集中验证负责人 |
| 六场景实际 JSON/DB 对账 | 真实服务脚手架完成，未执行 | PENDING，task-26/组合验证 |
| 普通聊天/Group/Routine/Memory/Stop | 历史结果保留；新跨阶段用例待跑 | PENDING，组合验证与各负责线 |
| 备份 unknown table/missing target/orphan | 集成线已有校验修复，需实际负例/restore | PENDING，备份负责人/组合验证 |
| `pg_dump` / restore | 没有本次备份文件、摘要或实际 restore 结果 | PENDING，获准的一次性环境执行人 |
| 关闭 Outcome 入口 | 操作与断言已写手册；实际运行待验 | PENDING，恢复/集成负责人 |
| populated Outcome 表回退旧镜像 | 已知 schema/fingerprint 风险；没有旧镜像运行日志 | PENDING，发布负责人 |
| metrics/日志不含敏感正文 | 新 canary/attention 测试已编写；实际结果待验 | PENDING，恢复/组合验证 |
| 远端 Computer、live API/真实模型 | 没有部署授权与本次回放 | PENDING，lead |
| Desktop/Android/iOS 安装/签名/更新 | 其他 lane 提供各自证据；本线未执行 | PENDING，客户端/发布负责人 |

实际失败日志样例尚未产生，不能编造旧镜像错误文本。后续演练必须归档完整命令、旧/新 image digest、schema fingerprint、备份 SHA-256、实际拒绝或启动日志和对账；日志存储前检查没有 token、密钥、资料全文和 Decision 自定义文字。

回退优先保留新 schema/数据并关闭 Outcome 入口。旧镜像只对可丢弃副本演练，不删除 Outcome 表迁就旧镜像，不通过 SQL 改业务状态掩盖失败。入口关闭与镜像回退是两个独立门槛。

代码回滚只撤销本线脚手架/测试/文档提交；`870ebac90` 是依赖合并，不应把其他 lane 已集成实现整体回滚。本线没有新增 schema。正式数据回退需要保留已填充 Outcome 数据及人工证据，遵守父 design §16/§36 与 004.5 §48。
