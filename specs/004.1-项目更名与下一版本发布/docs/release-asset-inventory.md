# 发布资产清单（v0.1.0-beta.19）

记录日期：2026-11-17

数据来源：GitHub API `repos/jingyi0605/OutcomeGo/releases/tags/v0.1.0-beta.19`（资产名称、大小、GitHub 计算的 SHA-256 digest）。本清单只记录 GitHub 返回的事实，不代表已在真实设备上安装验证。

## 版本事实

| 项目 | 值 |
|---|---|
| Release | `OutcomeGo 0.1.0-beta.19`，GitHub 标记为 Latest，非预发布 |
| 发布时间 | 2026-11-17T00:25:24Z |
| Tag | `v0.1.0-beta.19`，指向提交 `7cbb75259`（`修复：消除发布测试的平台与时序假设`） |
| 目标分支 | `OutcomeGo` |
| 生成方式 | `Release` workflow（同 tag 第 3 次运行成功，2026-11-17T00:16:08Z；前两次失败已由 `7cbb75259` 修复） |
| 首个 OutcomeGo 版本 | `v0.1.0-beta.14`，2026-11-12T18:26:55Z 发布，资产结构与本表一致 |
| 上一个旧品牌版本 | `v0.1.0-beta.13`（`aiTeamOS 0.1.0-beta.13`），资产保留未删除，作为回滚参考 |

## 资产

| 资产 | 大小（字节） | SHA-256 | 身份/签名说明 |
|---|---:|---|---|
| `aiTeamOS-0.1.0-beta.19-linux-x86_64.AppImage` | 134101443 | `e9a805fbcd831021f2d9e8bfff90289ad77b1421611d77f783b77f5eed993a7b` | Desktop；artifact 前缀按决定保留 `aiTeamOS-*` |
| `aiTeamOS-0.1.0-beta.19-mac-arm64.dmg` | 128147270 | `6e424dc32e7b9a11aba9874ee3ab84c9d590049a108009e4c91970709fdfdd71` | Desktop macOS；Developer ID 签名与公证流程见 `signing-builds.md` |
| `aiTeamOS-0.1.0-beta.19-mac-arm64.zip` | 126396040 | `075beb0bed5c6d9c8ff4677395899c8b08582c56f28638eef13c2397532040f9` | Desktop macOS updater 包 |
| `aiTeamOS-0.1.0-beta.19-win-x64.exe` | 108125349 | `231e3323378f82b96c04cc4a9406d8fc0ed91f6fad83c1573450d6d40a9cf21e` | Desktop Windows；按决定未做 Authenticode 签名 |
| `*.blockmap`、`latest*.yml` | — | 见 GitHub | Desktop updater 元数据 |
| `DESKTOP_SHA256SUMS` | 752 | `d060dc0a84e5498d95217e2a1e145870ac6a1ca473bbc5e6e31fc3205e27e2ac` | Desktop 校验和 |
| `OutcomeGo-0.1.0-beta.19-android.apk` | 25221907 | `4927bb534658ea5e8b27128467b8be3b4ae8c75758fe43930d06f70640134cc8` | Android `com.outcomego.android` 新安装身份 |
| `android-update.json` | 542 | `3d5c87eb5c94e9383239db03d3df66521d99b175dc2dbadb2eca64326122ae98` | Android 更新清单，用轮换后的 ECDSA P-256 私钥签署 |
| `outcomego-{darwin,linux}-{arm64,x64}`、`outcomego-windows-x64.exe` 及 `.gz` | — | 见 `SHA256SUMS` | CLI；每个二进制附 `.sigstore.json` |
| `outcomego-compose.yaml` | 11269 | `3d0e88b6e2b1a5ed8dd3c4750b6be4e4ef968a8f2e0f055d978b8bf9a06e64e9` | 自托管 Compose；附 `.sigstore.json` |
| `install.sh`、`install.ps1` | — | 见 GitHub | CLI 安装器 |
| `SHA256SUMS` | 1946 | `ffed77d1c02a68e3fadf218cb620db3a7a40b059453a0a4dccc70ed402b10b08` | CLI/Compose 校验和 |

## 未包含

- iOS：按负责人决定延期，不在 Release 资产中。
- 服务端镜像：由 Release workflow 推送到 GHCR 路径 `ghcr.io/jingyi0605/outcomego`（原 `ai-teamos`）；本清单未单独核对镜像 digest。

## 已知发布健康问题（不属于 004.1 范围）

截至 2026-11-17，`OutcomeGo` 分支最新两次 `CI` workflow（`209c770e6`、`3b02ebfe6`）的 `checks` job 失败；`database-fresh-schema` 和三个 docker job 成功。该问题在后续开发中修复，不影响已发布的 beta.19 资产。
