# 研究试点验收回放记录

Fixture：[`research-pilot.json`](research-pilot.json)

状态：未执行（等待任务 4.3）

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
