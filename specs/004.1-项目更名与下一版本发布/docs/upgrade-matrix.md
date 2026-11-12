# 新安装和数据导入矩阵（待真实候选资产）

状态：PENDING 模板

本文件为任务 3.x/6.x 的记录模板。OutcomeGo 使用全新身份和当前完整 schema，不支持旧安装原地升级或旧数据库字段转换。真实新安装、当前格式手动备份导入、设备安装和回滚仍待候选包及隔离环境。

| 客户端/服务 | 起始版本 | 候选版本 | 数据/登录断言 | 更新/签名断言 | 回滚结果 | 状态 |
|---|---|---|---|---|---|---|
| CLI | 空白安装环境 | `0.1.0-beta.14` | 新实例；不读取旧配置目录 | release signature、错误来源和下载 URL | 待执行 | PENDING |
| Desktop | 空白安装环境 | `0.1.0-beta.14` | OutcomeGo 安装；`userData=aiTeamOS` 是固定保留路径；业务数据从当前格式备份导入 | appId、artifact prefix、updater 和中断恢复 | 待执行 | PENDING |
| Android | 未安装 OutcomeGo 的设备 | `0.1.0-beta.14` | 安装新 package ID 并导入当前格式备份 | application ID、签名证书、manifest hash | 待执行 | PENDING |
| iOS | 未安装 OutcomeGo 的设备 | 下一候选 | 新安装身份；手动数据导入 | profile、签名、推送和深链 | 延期 | PENDING |
| Compose/server | 新数据库和 volume | `0.1.0-beta.14` | 当前完整 schema 初始化，再手动导入当前格式备份 | 镜像 tag、签名、schema fingerprint、服务健康；不执行旧 schema 转换 | 待执行 | PENDING |

每次回放需要附：版本、source commit、构建命令、资产路径和 SHA-256、身份、签名结果、新安装/导入结果、回滚结果、阻塞项和复核日期。
