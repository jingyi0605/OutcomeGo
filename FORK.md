# aiTeamOS (fork of OpenTeam)

aiTeamOS is an **unofficial fork** of [OpenTeam](https://github.com/raghavpillai/openteam)
by Raghav Pillai. It is not affiliated with or endorsed by the upstream project.
The "OpenTeam" name and logo belong to the upstream author. This fork uses the name
"aiTeamOS" only to state its origin.

## Attribution

- Upstream: https://github.com/raghavpillai/openteam (`upstream` remote, `main` branch)
- This fork: https://github.com/jingyi0605/ai-TeamOS
- Copyright in the upstream code belongs to its authors. Copyright in this fork's changes
  belongs to their respective contributors (see `git log`).

## License

This fork is distributed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)),
the same license as upstream. Anyone who receives a build of this fork (for example the
Android APK) can obtain the corresponding source from the repository above, at the commit
or tag the build was made from. Third-party components (noVNC, fonts, `vendor/sheetjs`,
some plugins) keep their own licenses.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Mirror of `upstream/main`. Fast-forward only, no local commits. Source for pull requests to upstream. |
| `ai-TeamOS` | Default branch and product line. Upstream merged in regularly. Releases are tagged here. |
| `feat/*`, `fix/*` | Short-lived branches. Generic fixes start from `main`; fork-specific work starts from `ai-TeamOS`. |

Upstream changes reach `ai-TeamOS` only through `git merge upstream/main` (or the
automated "sync upstream" pull request). Do not rebase `ai-TeamOS`. Upstream changes we do
not want are merged and then reverted, so the same commits do not return as conflicts.

## Upstream tracking

| Item | Value |
|---|---|
| Merge base with `upstream/main` | `6af6444c` (v0.0.15, 2026-11-07) |
| Latest upstream release reviewed | v0.0.16 (`upstream/main` at `be68ae0e`, 2026-11-08) |
| Synced from v0.0.16 | [#258](https://github.com/raghavpillai/openteam/pull/258), digest-pulled Docker image cleanup (cherry-picked as `7da7ec1c`) |
| Not synced from v0.0.16 | Version bump and release metadata (`ae9f7ebb`). They conflict with this fork's own version line and add nothing to it. |

When the fork needs only part of an upstream release, cherry-pick the fix and rename
`openteam-*` identifiers to their `aiteamos-*` forms (for example the image retention tag
prefix `aiteamos-retention-`). Do not merge upstream version bumps. `git cherry -v HEAD
upstream/main` lists upstream commits that are not yet applied, but it matches by patch
content. A pick that needed renaming, such as #258, still shows as `+`, so use the table above
as the record of what has been synced.

## Current release

The current published release is `v0.1.0-beta.11`. Release tags are created from
`ai-TeamOS`, and the GitHub Release contains the server installers, CLI binaries, desktop
artifacts, Android APK, update manifest and checksums. iOS remains source-built in this fork.

## Naming and identifiers

| Item | Upstream | This fork |
|---|---|---|
| Product display name | OpenTeam | aiTeamOS |
| Android `applicationId` | `com.openteam.android` | `com.teambots.android` |
| Android `namespace` and Kotlin package | `com.openteam.android` | unchanged, to keep merges with upstream small |

Because the `applicationId` differs, the fork installs next to an official OpenTeam build
and does not upgrade it. Push, app-link and Firebase configuration must be created for
`com.teambots.android`.

This fork has its own version line, starting at `0.1.0-beta.1`, independent of upstream's
version numbers. Tags are `v<version>` and every package, `bun.lock` and the iOS `release.json`
must match (`bun scripts/release/version.ts check`). See `.github/RELEASING.md`.

## Modifications relative to upstream

Based on upstream `main` at v0.0.15, plus selected fixes from v0.0.16 (see
[Upstream tracking](#upstream-tracking)). Compare with `git diff upstream/main...ai-TeamOS`.

- **Synced upstream fix** (`apps/cli`): cleanup of retired Docker images that were pulled by
  digest, from upstream v0.0.16
  ([#258](https://github.com/raghavpillai/openteam/pull/258)).

- **Android client** (`apps/android`, `mobile/shared`, `scripts/android`, `docs/android`):
  native Android client with chat, bots, routines, push notifications, share target,
  cloud computer viewer, and Chinese localization. Submitted upstream as
  [#236](https://github.com/raghavpillai/openteam/pull/236), not merged.
- **Realtime voice conversation** (`apps/server`, `apps/worker`, `apps/desktop`,
  `apps/ios`, `packages/contracts`, `packages/db`): voice sessions with VAD and Opus
  transport, Volcengine and Deepgram providers, narration of slow tool work,
  and transcript cards on desktop, iOS and Android.
- **Custom model providers** (`packages/contracts`, `apps/server`, `apps/computer`,
  `apps/desktop`, `apps/ios`, `apps/android`): OpenAI Chat, OpenAI Responses and Anthropic
  Messages endpoints, 38 vendor presets, local-server presets, provider icons, and add/remove
  controls in each client.
- **Android update channel** (`apps/android`, `scripts/android`, `.github/workflows/release.yml`):
  signed APK releases include a signed update manifest. The client verifies the manifest,
  checksum, package ID, version code and APK signing certificate before installation. Debug
  builds use `com.teambots.android.debug` so they can coexist with the release app.
- **Cross-client polish**: Android haptic feedback for chat, sessions, sign-in, settings and
  routines; corrected iOS realtime-voice settings grouping; and unified aiTeamOS icon artwork.
- **Model metadata**: Magpie multimodal model capabilities
  ([#198](https://github.com/raghavpillai/openteam/pull/198)).
- **Network fixes**: SOCKS gateway capacity release
  ([#250](https://github.com/raghavpillai/openteam/pull/250)) and AAAA handling for
  exits without IPv6 ([#251](https://github.com/raghavpillai/openteam/pull/251)).
- **Debug tooling**: host-run debug stack script and remote debug computer rules
  (`scripts/dev`, `AGENTS.md`).
- **Branding and IDs**: display name and Android `applicationId` as listed above.

Planned: support for more services and environments in mainland China, plus continued
replacement of upstream-only release infrastructure.

## Release and contribution notes

- Releases are built from tagged commits on `ai-TeamOS`; run
  `bun scripts/release/version.ts check` before creating a tag.
- Android sideload updates require the release workflow's private manifest-signing secret.
  The matching public key is compiled into the Android client and key rotation requires a
  coordinated app release.
- Windows installers are currently published unsigned until an Authenticode certificate is
  configured. macOS artifacts are signed and notarized when the release variables and secrets
  are present.
- Keep upstream attribution, third-party license notices and the fork-specific package IDs
  intact when adding features.
