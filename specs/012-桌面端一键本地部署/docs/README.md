# 补充文档目录

`docs/` 存放与 Spec 012 直接关联的补充材料。

| 文件 | 内容 | 关联 |
| --- | --- | --- |
| [`20261123-现状核查记录.md`](20261123-现状核查记录.md) | 对桌面端、CLI、compose 的代码核查结论，区分“已核实”和“未验证” | `requirements.md` 全部需求；`design.md` §1.4 |
| [`20261123-引擎方案对比与选型.md`](20261123-引擎方案对比与选型.md) | 各容器引擎在 Windows、macOS 上的对比、选型结论、内存估算与出处 | `requirements.md` 需求 4、5、6、9；`design.md` §3.3.4、§3.3.6 |
| [`20261123-许可证评估与建议.md`](20261123-许可证评估与建议.md) | 候选组件的许可证、与 `GPL-3.0-only` 的兼容性分析、分发时的合规动作、法务问题清单 | `requirements.md` 需求 14；`design.md` §3.3.9、§8.2 Q11 |
| [`cli-contract.md`](cli-contract.md) | CLI 事件契约与引擎提供者接口 | 任务 2.7 |
| [`acceptance-checklist.md`](acceptance-checklist.md) | M1 手工验收清单；M2、M3 待补 | 任务 3.8、4.5、5.4 |
| [`acceptance-result.md`](acceptance-result.md) | 验收证据与未验证项 | 任务 3.8、4.5、5.4、6.3 |
| [`check_spec.py`](check_spec.py) | 一致性核对脚本：设计章节引用、任务字段（含技术规划与指标）、依赖无环、需求与任务双向追踪、每条验收标准至少被一个任务点名、`design.md` §7.4 无遗漏。用法：`python3 -I specs/012-桌面端一键本地部署/docs/check_spec.py specs/012-桌面端一键本地部署`，退出码 0 为通过 | `tasks.md` 任务 1.1、1.10、2.7、6.3 |

## Windows 引擎发布输入

`apps/cli/engine-assets/windows-x64.Dockerfile` 固定 Debian 13 amd64 镜像摘要、Debian 签名仓库快照以及引擎主要软件包版本。组包时逐项核对实际安装的软件包和 `THIRD-PARTY-NOTICES`，来源和许可证声明随资产交付。

- 本地或 Linux CI 使用 `docker buildx build --platform linux/amd64 --secret id=build_ca,src=/etc/ssl/certs/ca-certificates.crt --file apps/cli/engine-assets/windows-x64.Dockerfile --output type=tar,dest=/tmp/outcomego-rootfs.tar apps/cli/engine-assets`。macOS 的 CA 文件路径为 `/etc/ssl/cert.pem`。
- 在隔离的 Linux root 环境运行 `bun apps/cli/scripts/engine-assets.ts --windows-rootfs /tmp/outcomego-rootfs.tar /tmp/outcomego-engine-candidate`，输出归档、`SHA256SUMS` 和组件清单。两次独立构建后比较归档 SHA-256。
- 任务 4.1 的前置门完成后，发布负责人可显式开启仓库变量 `RELEASE_WINDOWS_ENGINE=true`。分支工作流只组包，现有 tag 工作流执行签名与发布。组包、验签或产物完整性检查失败会阻止发布。
- 发布产物包含归档、`.sigstore.json`、包含归档摘要的 `SHA256SUMS`、`engine-components.json` 和 `THIRD-PARTY-NOTICES`。客户端仍只接受与当前 CLI 相同版本的受信资产。不得将旧版本缺件当作可以跳过校验的理由。
