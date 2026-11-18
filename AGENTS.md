# Project Rules

## 文档语言

- 所有技术文档和规格文档内容必须使用中文，包括设计方案、架构说明、任务计划和实现规格。
- 代码标识符、代码注释、文档字符串和提交消息继续使用英文，除非项目其他规则明确要求使用不同语言。
- 说明性 Markdown 文档使用带日期的中文文件名，例如 `20251119-文档标题.md`。

## Spec 文档位置和模板

- 所有 Spec 文档必须保存到当前独立工作树的 `specs/` 目录下，不得回到主工作树 `/Users/jackson/Code/openteam/specs` 写入，也不得新建到 `docs/development/specs` 或其他目录。
- 新建 Spec 必须以 `specs/000-Spec规范/Spec模板` 为模板，复制其目录结构和 `README.md`、`requirements.md`、`design.md`、`tasks.md` 文件。
- Spec 目录使用 `<编号>-<功能名称>` 命名；子规格使用带小数的编号，例如 `specs/002.1-群聊实时语音对话`。
- `requirements.md`、`design.md` 和 `tasks.md` 必须相互引用，需求、设计章节、任务和验证方式必须可以逐项追踪。
- Spec 文档内容必须使用中文；代码标识符、路径、协议字段和命令可以保留原文。

## Spec 004 独立工作树

- 负责人于 2026-11-17 明确要求：`data/spec004-并行开发提示词` 相关的所有后续工作都必须在独立 Git worktree 完成，包括代码、规格、测试、构建、回放、暂存和提交。
- 主工作树 `/Users/jackson/Code/openteam` 只读，不在其中切换任务分支、修改文件或执行会写入仓库的命令。
- 独立集成工作树为 `/Users/jackson/Code/openteam-spec004`，分支为 `outcome/spec004`；各线从该分支创建独立工作树，放在 `/Users/jackson/Code/openteam-spec004-worktrees/`。
- 先通过 `git worktree list`、`git rev-parse --show-toplevel` 和 `git branch --show-current` 验证工作树与任务分支。复用已登记的工作树，不能覆盖其他会话的目录、分支或未提交改动。
- 提示词的真实目录为 `/Users/jackson/Code/openteam-spec004/data/spec004-并行开发提示词`；主工作树下同名路径仅为指向此目录的符号链接。
- 跨线日常集成仅在独立集成工作树进行。推送或最终合入 `OutcomeGo` 必须由负责人另行明确授权，不能从“完成某波/某条线”推断。
- 完整路径、分支和交接规则见 [独立工作树执行约定](specs/004-OutcomeGo整体项目/docs/20261117-独立工作树执行约定.md) 和提示词通用约束 §2。

## Git Commit Messages

- Write Git commit messages in Chinese.
- Use one of these formats: `前端：xxxxx`, `修复：xxxxxx`, or `IOS：xxxxx：`.

## Android Debug Packaging

- Package the current working tree with `bash scripts/android/package-debug.sh`.
- On macOS, double-click `scripts/android/package-debug.command` for the same build.
- The script must use a compatible JDK 17–24 and run `:mobile:androidApp:assembleDebug`.
- SDK lookup order: `ANDROID_HOME`/`ANDROID_SDK_ROOT`, then `local.properties`, then `~/Library/Android/sdk`. Do not write `local.properties` into the repo just to build.
- Do not run `./gradlew` directly or experiment with JDKs (Android Studio's bundled JDK 25 is unsupported by AGP 8.11.1); always use the script.
- The generated APK is `apps/android/app/build/outputs/apk/debug/androidApp-debug.apk`.
- Report the absolute APK path and SHA-256 after every successful package.
- Preserve uncommitted source changes; the packaging command must not reset, clean, delete, or commit files.
- Packaging must not start development servers, backend services, frontend servers, or rendering scripts.
- Installing and launching on the Xiaomi device is a separate action handled by `bash scripts/android/run-xiaomi.sh`.

## Remote Debug Computer

The `computer` runtime (the pi agent loop, tool execution, voice narration and streamed speech) does not run on this Mac. `scripts/dev/debug.sh up` starts only the server and worker locally. The computer runs as a Docker container on a remote host, so a change under `apps/computer`, `packages/contracts`, `packages/shell-jobs`, `packages/plugin-sdk` or `packages/plugins` takes effect only after the remote copy is synced and the container is rebuilt.

- Host: `ubuntu@10.255.0.45` (Unraid, Docker). SSH works non-interactively with the default key; use `ssh -o BatchMode=yes ubuntu@10.255.0.45`.
- Debug project: `~/openteam-debug` (compose project `openteam-debug`, files `docker-compose.yml` and `docker-compose.override.yml`). It is a plain copy of the sources, not a git checkout. Its `.env` holds the secrets; never print or copy it.
- Never touch the `openteam-dev` project (`~/openteam`) on the same host, or the bind-mounted `~/openteam-debug/data` (`workspace`, `agent-data`).
- Inspect (read-only): `docker ps --filter name=openteam-debug`, `docker logs --tail 200 openteam-debug-computer-1`, `docker compose ls`.
- Sync, from the repo root, only what the computer image copies. Dry-run first by adding `-n` and compare checksums with `-c`:
  `rsync -rlc --itemize-changes --exclude node_modules --exclude dist --exclude .git --exclude .turbo --exclude _generated --exclude test --exclude '*.log' package.json turbo.json tsconfig.base.json patches vendor docker apps/computer packages/contracts packages/shell-jobs packages/plugin-sdk packages/plugins --relative ubuntu@10.255.0.45:openteam-debug/`
- Before overwriting, back up the files that differ into `~/openteam-debug-backups/` on the host with `tar czf`.
- Rebuild and restart only the computer, in the debug project:
  `ssh -o BatchMode=yes ubuntu@10.255.0.45 'cd ~/openteam-debug && set -a && . ./.env && set +a && docker compose -p openteam-debug -f docker-compose.yml -f docker-compose.override.yml up -d --build computer'`
- Always recreate `computer-memory-init` together with `computer` (`up -d --build computer computer-memory-init`, or add `--force-recreate` if the helper was left in `Exited (137)`). The computer waits for that helper at start; with the helper down it restarts in a loop logging `memory-init helper did not become ready`.
- Rebuilding interrupts any bot task running on that computer. Ask the user before doing it unless they already asked for the rebuild, and verify with `docker ps` (status `healthy`) afterwards.
- `scripts/dev/debug.sh check` verifies the share mount, database and computer health; run it after a rebuild.
