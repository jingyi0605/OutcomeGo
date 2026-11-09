# Project Rules

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
