# 父级场景 A–H 本地回放与正式边界

日期：2026-11-17；实现基线 `93d5ff665` 加本轮未提交源码。报告交付完成，父任务 3.1 仍 **BLOCKED**：原依赖 2.1、2.2、2.4 最终检查点未完成；2.3 已按自身字面标准接受。本报告给每个场景明确结论，不伪造真实客户端、模型、安装或发布执行。

## 执行来源与逐步记录

| 场景及原步骤 | 实际记录、ID和结果 | 结论 / 缺项 / 责任人 |
| --- | --- | --- |
| A 新实例导入后创建并完成 Outcome，步骤1–8 | 本地当前 schema / 服务测试及同版恢复已执行；[研究完整回放](../../004.2-Outcome规划执行与成果验收闭环/docs/acceptance-replay.md)保存输入→Planning→确认→批准→Worker.claim→主对话并行→Output→Evidence→Review的11次请求与19检查。实际 Outcome `23e1a024-a7d5-47df-971b-74162a208a41`，完整 request、Run、context、Output/Evidence/Review ID 在[当前隔离版JSON](20261117-开发收尾证据/product-isolation/research-isolated.json)。 | 本地生产服务链 PASS；全场景 PENDING。新实例登录/手册导入及真实研究Bot未执行；发布负责人/产品运行时负责人补004.1安装矩阵及004.2/7.1。受控推理/Computer不称真实研究运行。 |
| B 执行中需要用户决策，步骤1–6 | [具名B回放](../../004.3-Outcome收件箱与决策通知/docs/scenario-b-replay.md)：实际 trusted RequestOutcomeDecision→Inbox→present→两个真实Request resolve（200/409）→胜者同key回放→同WorkItem/context continuation→Output/transcript。Outcome `e9dc5e6d-b53d-4fe0-966f-ebd826239adc`，Decision `2b9b4030-0e11-4867-a799-ddaac6835e8b`，16/16检查。[实际JSON](20261117-开发收尾证据/decision-replay.json)保存所有请求和持久查询。 | 本地服务/路由链 PASS；正式场景 PENDING。初始Outcome为明确GIVEN fixture；没有监听服务、真实Agent或两个原生客户端。客户端负责人补004.3/4.1双客户端、过期/撤回及通知现场。 |
| C 现实任务闭环，步骤1–6 | [人工具名回放](../../004.4-现实任务与知识资料闭环/docs/human-task-replay.md)保存25步请求/ID/结果；Outcome `6e536ee3-f26d-43bd-b771-695fd61c969f`，human WorkItem `468e3703-8304-46f5-a2d7-e44ed99505cd`。资料search/read→trusted工具→start/pause→缺材料UNVERIFIED/错误PASS拒绝→FAIL→补交→Review PASS→同context继续→最终accepted，32/32检查。另18个实际mounted表单用例覆盖错误/刷新/重连/乱序响应。 | 本地固定fixture与004.4字面任务 PASS。现场材料虚构、推理受控；真实provider/挂载/窗口/设备仍PENDING，并非该本地完成标准新增前提。负责人：人工任务与客户端。 |
| D 中断和重复事件，步骤1–4 | [既有最终故障报告](../../004.5-运行时恢复与版本验收/docs/final-replay.md)、[六份实际JSON](20261117-第3波组合验收证据/faults/)覆盖restart/duplicate/interrupt/Decision/receipt-retry/unknown，共40检查。真实executor已退出137/SIGKILL；初始exitObserved=false原始日志保留。 | 本地六故障 PASS；真实远端故障 PENDING。unknown为明确虚构持久fault adapter，实际一次尝试且不自动重发，不代表外部provider确认。运行时负责人补现场凭据/执行器。 |
| E Contract变更，步骤1–5 | [004.2逐项报告](../../004.2-Outcome规划执行与成果验收闭环/docs/20261117-逐项任务验收记录.md)和历史完整server记录含successor5+history1、实际Decision supplement/依赖等待、批准后旧控制409；pending-only revision与N/N+1历史保留均有真实DB回归。 | 本地事务/状态规则 PASS；一次真实模型/客户端全E链 PENDING，无新增统一E执行ID。产品/Inbox负责人按既有生产入口补现场对账，不拼接不同Outcome。 |
| F 外部内容不能改写Contract，步骤1–4 | [合同矩阵](cross-phase-contract-matrix.md)、[004.2失败/验收报告](../../004.2-Outcome规划执行与成果验收闭环/docs/20261117-逐项任务验收记录.md)证明只有用户revision API改Contract、Decision提议与FAIL/UNVERIFIED阻止错误accepted；本轮human链实际拒绝缺材料PASS。 | 合同/接口局部 PASS；恶意外部资料真实研究全过程 PENDING。没有工具级拦截声明；产品/Review负责人准备原固定材料，保留原始Contract及逐项结果。 |
| G 结果不满足验收，步骤1–3 | 既有Review16实际DB及review-cycle回归覆盖FAIL→real rework enqueue/Worker.claim→settle两次→唯一新未读/通知；human链记录UNVERIFIED→FAIL→补交→PASS完整ID。见[004.3逐项报告](../../004.3-Outcome收件箱与决策通知/docs/20261117-逐项任务验收记录.md)和人工具名回放。 | 本地验收/返工规则 PASS；真实客户端完整Agent返工统一链 PENDING，不把人工补交当全部Agent返工现场已验。负责人：Review/客户端。 |
| H 旧客户端与新服务端边界，步骤1–3 | [跨阶段合同矩阵](cross-phase-contract-matrix.md)、既有oldDTO/unknown-field/nativePush及普通聊天/通知完整回归，ID-only固定通知和snapshot过滤均已验。 | 本地协议/兼容fixture PASS；beta.13真实旧客户端×新服务端、新客户端×旧服务端矩阵 PENDING。客户端/发布负责人准备隔离候选与镜像；不要求原地升级。 |

## 实际命令与重复计数边界

本轮命令的cwd、环境名称白名单、完整argv、退出值、时长和原始SHA见[combined-checks.json](20261117-开发收尾证据/combined-checks.json)及[最终隔离复验](20261117-开发收尾证据/isolated-followup-checks.json)：

```sh
# Desktop cwd apps/desktop；环境只保留HOME/PATH/TMPDIR
bun --no-env-file test --pass-with-no-tests --isolate
# 根目录；显式一次性本地 OUTCOMEGO_TEST_DATABASE_URL
bun --no-env-file test ./apps/server/test/outcome-product-replay.integration.test.ts ./apps/server/test/outcome-decision-full-replay.integration.test.ts ./apps/server/test/human-receipt.integration.test.ts ./apps/server/test/outcome-decision-tool.test.ts ./apps/server/test/outcome-inbox-service.test.ts ./apps/server/test/outcome-review-service.test.ts ./apps/server/test/human-work-service.test.ts ./apps/server/test/knowledge-provider.test.ts ./apps/server/test/outcome-inbox-routes.test.ts
```

实际完整Desktop **786 PASS / 0 FAIL / 1 SKIP / 20262 assertions / 141 files**；最终隔离版server受影响 **80 PASS / 0 FAIL / 460 assertions / 9 files**。18 mounted案例包含在Desktop内，A/C/B主流程及隔离测试包含server受影响批次，不再相加。此前78P451仍为历史检查点；owner之后增第5项纯测试并单文件5P43，不声称完整9文件81。task70另有实际CLI19/32检查，B16检查是对应JSON事实校验，不另造完整包总数。旧六包4950/0/83、九专库恢复/一个enrollment及六CLI40是历史独立证据，未重跑未变更包。

## 依赖和下一步

A–H全部有本地/正式结论；缺失现场步骤保留PENDING，而不是补造request/ID。父3.1原显式前置中004.2/7.3、004.3/4.4、004.5/4.2未关闭，因此报告交付不等于父3.1 DONE。发布负责人补候选安装/更新/旧镜像；产品与客户端补真实研究Bot/双客户端；远端CI需获准推送后的实际run。下一阶段使用上述同一场景记录模板扩充新执行，不改本次不可变JSON或历史RED。
