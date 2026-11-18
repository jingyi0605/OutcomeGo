# 父级发布与回滚决策

日期：2026-11-17；当前工作树版本 `0.1.0-beta.19`，没有创建新版本/tag/release、推送或部署。实现基线`93d5ff665`加未提交开发并集；当前正式发布结论 **PENDING / 不放行**。父任务3.2为 **BLOCKED**：原依赖3.1未关闭；本具名报告已交付，不能再将“文件未写”列为当前缺口。

## 变更、构建及测试

- 本轮产品修改仅ReceiptForm/HumanAction错误恢复/权威状态代际和重复提交、backup.sh同一Compose项目选择；validator增加unknown类型窄化。其余为DOM测试依赖、可执行A/C/B/有数据备份fixture、CI/既有26目标类型入口与证据文档。**本轮没有schema变更**，不要求新migration、不写生产数据库。
- integrator本轮完整Desktop786P/0F/1S、最终隔离受影响server80P/0F460assert、根脚本30P/0F88、gate3P/0F26；Desktop/server完整类型0，26目标owned/dependency诊断0，workflow PASS。[首次并集命令](20261117-开发收尾证据/combined-checks.json)、[最终隔离复验](20261117-开发收尾证据/isolated-followup-checks.json)及[新开发台账](20261117-开发任务收尾与验收边界.md)区分执行者与源码。
- task69实际18 mounted/99assert含乱序成功竞争；task70最终CLI研究19/人工32检查，task73 B16检查；task72同版已填充恢复14/14，4Planning/3Explore/2Outcome、86表123FK、dump315021字节SHA `616ff76f531326291635e02b2aecc625205e0e2223c7b2c87b9854b74c4035f4`。
- 历史六完整包4950P/0F83S、七包类型/架构/真实Desktop bundle、Android43+86及Swift329仍按原source归属。**本轮没有重打包**；历史APK不声称包含本轮UI源码。完整iOS App当时TLS拉取未进入全编译，设备/live API/CI均不写PASS。未重复Computer/messaging/mobile/root或production build。

## 保留的发布门与责任

| 条件 | 当前结论 | 所需输入与负责人 |
| --- | --- | --- |
| 远端CI全部job | PENDING，004/1.3未勾 | 集成/CI负责人获准推送后记录精确source、run/job；本地检查不替代。 |
| 真实研究Bot与最终004.2 | PENDING，3.1/3.2/7.1→7.2/7.3依赖未闭 | 产品/运行时准备开发Bot、推理配置和远端Computer，执行真实研究及并行聊天，禁止以受控fixture冒充。 |
| 两真实客户端与004.3最终门 | PENDING，4.1→4.3/4.4未闭 | 客户端/Inbox负责人准备真实Desktop与移动会话，验证并发resolve/过期/撤回/通知/认证深链。本地B报告已完整交付。 |
| 新安装/导入/签名更新/名称/GHCR | PENDING，004.1八项未闭 | 发布负责人准备指定候选/起始资产/平台/账号和授权；名字查核范围、匿名pull与旧包处置记录不能由脚本存在推断。 |
| 有数据回退/旧镜像与004.5最终门 | 本地同版有数据restore PASS；正式3.4、4.1、4.2未闭 | 发布/恢复负责人提供旧镜像digest和一次性目标，实际关闭入口/保留新数据/兼容回退。未执行旧镜像，未编造digest。 |
| 人工本地产品闭环 | DONE（004.4全部字面条件） | 具名human报告、18需求/失败矩阵与父八问均齐；现场provider/窗口/设备观察仍保留独立限制，不新增原标准没有的门。 |

## 回滚方法与数据原则

首选关闭Outcome新规划/Explore propose/start派发入口（既有`OUTCOMEGO_OUTCOMES_ENABLED`），保持读取、Decision/receipt/Review/cancel/reconcile等处理及新表。先在获准一次性目标验证，再决定实际发布回退；本轮未执行环境开关操作。撤本轮开发时只恢复授权源码/测试/CI增量，已有13WIP文档有独立备份；保留Outcome、revision、WorkItem、Run、Output、Evidence、Review、receipt、Explore和资产。**不运行会删新表的旧schema，不删除业务数据，不假设旧镜像兼容。** backup.sh明确一个项目用于dump/config/volumes，源备份和原始RED字节保持。

数据恢复证明是同版PG custom dump，不等于portable JSON手册导入或真实旧镜像回退。发布负责人负责候选和恢复目标，恢复负责人负责完整行/关联/业务视图核对，客户端负责人负责更新/签名/设备。下一步按[父A–H报告](final-replay.md)和各未闭任务逐格补授权实际证据；只有依赖满足后重审父3.1/3.2/3.3。本报告交付完成，不授予release/CI/设备/真实provider验收许可。
