# ai-TeamOS (fork of OpenTeam)

ai-TeamOS is an **unofficial fork** of [OpenTeam](https://github.com/raghavpillai/openteam)
by Raghav Pillai. It is not affiliated with or endorsed by the upstream project.
The "OpenTeam" name and logo belong to the upstream author. This fork uses the name
"ai-TeamOS" only to state its origin.

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

## Naming and identifiers

| Item | Upstream | This fork |
|---|---|---|
| Product display name | OpenTeam | ai-TeamOS |
| Android `applicationId` | `com.openteam.android` | `com.teambots.android` |
| Android `namespace` and Kotlin package | `com.openteam.android` | unchanged, to keep merges with upstream small |

Because the `applicationId` differs, the fork installs next to an official OpenTeam build
and does not upgrade it. Push, app-link and Firebase configuration must be created for
`com.teambots.android`.

Release versions follow `<upstream version>-cn.<n>`, for example `0.0.15-cn.1`.

## Modifications relative to upstream

Based on upstream `main` at v0.0.15. Compare with `git diff upstream/main...ai-TeamOS`.

- **Android client** (`apps/android`, `mobile/shared`, `scripts/android`, `docs/android`):
  native Android client with chat, bots, routines, push notifications, share target,
  cloud computer viewer, and Chinese localization. Submitted upstream as
  [#236](https://github.com/raghavpillai/openteam/pull/236), not merged.
- **Realtime voice conversation** (`apps/server`, `apps/worker`, `apps/desktop`,
  `apps/ios`, `packages/contracts`, `packages/db`): voice sessions with VAD and Opus
  transport, Volcengine and Deepgram providers, narration of slow tool work,
  and transcript cards on desktop, iOS and Android.
- **Model metadata**: Magpie multimodal model capabilities
  ([#198](https://github.com/raghavpillai/openteam/pull/198)).
- **Network fixes**: SOCKS gateway capacity release
  ([#250](https://github.com/raghavpillai/openteam/pull/250)) and AAAA handling for
  exits without IPv6 ([#251](https://github.com/raghavpillai/openteam/pull/251)).
- **Debug tooling**: host-run debug stack script and remote debug computer rules
  (`scripts/dev`, `AGENTS.md`).
- **Branding and IDs**: display name and Android `applicationId` as listed above.

Planned: support for services and environments in mainland China.

## Pending before a public release

- Replace upstream logos and icons.
- Check that update checks, release feeds, deep-link hosts and telemetry do not point at
  upstream infrastructure.
- Audit bundled third-party licenses.
