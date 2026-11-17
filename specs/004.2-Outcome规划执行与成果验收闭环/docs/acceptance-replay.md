# 研究试点验收回放记录

Fixture：[`research-pilot.json`](research-pilot.json)

状态：真实试点未执行（等待线 1 运行时组合验证及远端 computer 调用授权）

每次回放按 fixture 的 `requestSequence` 逐步执行，并在下表记录真实 ID 和结果。没有执行的步骤保持空白，不填写预期值。

| 步骤 | 请求/动作 | 关键 ID | 实际状态 | 结果 |
|---|---|---|---|---|
| 1 | 生成规划 | planId= | | |
| 2 | 创建 Outcome | outcomeId=、revisionId= | | |
| 3 | 批准 revision 1 | — | | |
| 4 | 开始执行 | workItemId=、rootRunId= | | |
| 5 | 主对话发消息 | mainRunId= | | |
| 6 | 子线程结算 | outputId= | | |
| 7 | 逐项验收 | reviewIds= | | |

幂等断言：

| 断言 | 结果 |
|---|---|
| 重复步骤 2 | |
| 重复步骤 3 | |
| 重复步骤 4（同一 clientRequestId） | |
| 重复步骤 4（不同 clientRequestId） | |

失败路径记录：见任务 5.4。


## 2026-11-17 第 1 波线 2 本地验证边界

- 规划、Evidence、Review、返工和预审的本地 fixture/API 函数验证见 [产品功能验证](20261117-第1波产品功能验证.md)。这些测试不填写上表真实试点 ID。
- 真实 `kind=planning` 调用：PENDING，未请求远端 computer 同步重建或真实模型调用授权。
- 真实 `kind=prereview` 调用：PENDING，只有独立模型 fixture 及失败注入验证。
- 真实返工子线程、取消和 transcript：PENDING，等待线 1 组合验证；冻结 fake 不等同于真实 Run。
- Desktop 交互及视觉回放：PENDING，本次未启动前端或渲染服务。
- 任务 5.1 与 7.1 继续按后续波次执行；本记录不宣称端到端研究试点通过。
