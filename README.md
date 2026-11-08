<p align="center">
  <img src="apps/landing/public/ai-teamOS-app-icon.png" alt="ai-TeamOS logo" width="120">
</p>

# ai-TeamOS

**An AI-native team operating system: spend your scarce attention directing a team of AI agents.**

ai-TeamOS is an independent, long-lived fork of [OpenTeam](https://github.com/raghavpillai/openteam).
It is not affiliated with or endorsed by the upstream project. See [FORK.md](FORK.md) for
attribution, branch rules and the list of changes.

## Standing on excellent work

ai-TeamOS exists because OpenTeam is an outstanding project, and we want to say so first.
[Raghav Pillai](https://github.com/raghavpillai) built a complete, self-hosted way to work with
AI agents: bots that own a real computer, keep their memory and logins between tasks, work
together in group chats, run routines on a schedule, and reach you from desktop and mobile apps.
The architecture is clean, the product is polished, and it ships at a remarkable pace.
Everything in this repository sits on top of that work, and we merge upstream changes
selectively and regularly so that we keep benefiting from it.

## What this fork focuses on

### 1. Compatibility with the mainland China ecosystem

OpenTeam is built around services and networks that are often hard to reach or unsuitable from
mainland China. This fork adapts it so that it works well there:

Available now:

- Voice and speech providers usable in China, such as Volcengine.
- A Chinese-language Android client.

Planned:

- Model, push-notification and messaging integrations that do not rely on services that are
  blocked or unreliable in the mainland. Firebase push, for example, generally does not reach
  phones in China.
- Defaults, documentation, update checks and release channels that do not depend on upstream
  infrastructure.

Generic fixes that benefit everyone are sent upstream as pull requests. Work that only makes
sense for China stays in this fork.

### 2. Exploring an all-in-AI way of working

In the age of AI agents, each person's range of capability keeps growing: one person can now
direct research, writing, coding, browsing and operations at the same time. **Attention is still
scarce.** The limit is no longer what you can do, but how much you can notice, decide and
verify.

The question this fork explores is:

> How do we raise the value of each person's attention, and through it, their personal
> productivity?

Directions we are working on:

- **Direct, don't supervise.** Let agents run in the background and bring you only what needs a
  human decision, with enough context to decide quickly.
- **Make work easy to interrupt and resume.** Voice conversation with agents, so you can steer
  them away from the keyboard, and native mobile clients so that nothing waits for you at a
  desk.
- **Protect focus.** Notifications, activity indicators and summaries that show the state of
  the whole team at a glance instead of demanding that you read every message.
- **Keep agents accountable.** Visible screens, transcripts and routines so that trust comes from
  being able to check quickly, not from reading everything.

These are directions, not a finished design. Design notes and specifications live in
[specs](specs) and [docs](docs).

## What is in this fork today

Compared with upstream OpenTeam v0.0.15, this branch adds:

- A native **Android client** with chat, bots, routines, push notifications, a share target and
  a cloud computer viewer. Submitted upstream as
  [#236](https://github.com/raghavpillai/openteam/pull/236).
- **Realtime voice conversation** across the server, worker, desktop, iOS and Android, with VAD,
  Opus transport, Volcengine and Deepgram providers, and narration of slow tool work.
- Magpie multimodal model metadata
  ([#198](https://github.com/raghavpillai/openteam/pull/198)) and network fixes
  ([#250](https://github.com/raghavpillai/openteam/pull/250),
  [#251](https://github.com/raghavpillai/openteam/pull/251)).

The full list is in [FORK.md](FORK.md).

## Branches

| Branch | Purpose |
| --- | --- |
| `ai-TeamOS` | Default branch and product line. Upstream is merged in regularly. |
| `main` | Mirror of upstream `main`. Never receives local commits. Pull requests to upstream start here. |

## What OpenTeam provides

Everything below comes from upstream OpenTeam and works the same way in this fork.

- **Give bots a computer.** Each bot has its own screen and browser. All bots share a workspace
  and website sign-ins, so they can build on each other's files and you only sign in once.
- **Keep context.** Conversations resume after restarts. Bots remember what they learn about
  themselves and you across conversations.
- **Work as a team.** Bring multiple bots into a group chat, let them message each other, or delegate
  tasks to subagents.
- **Automate recurring work.** Save instructions as routines that run on a schedule or respond
  to configured events.
- **Connect your tools.** Add skills and plugins for services such as Gmail, GitHub, Slack, and
  Notion, or connect a custom MCP server. Connected accounts are available to every bot.

[![OpenTeam desktop and iPhone apps showing the same vendor comparison and weekday pricing check](docs/images/openteam-desktop-mobile.png)](docs/images/openteam-desktop-mobile.png)

## Get started

You need an **x64 or arm64 machine** with a running **Docker Engine for Linux containers** and
**Docker Compose 2.20+**. We recommend **8 GB RAM** and **8 GB free disk**. On macOS and Windows,
Docker Desktop supplies the engine and Compose. See the [requirements](https://openteam.so/docs/getting-started/installation#requirements).

> **The installer and apps below are upstream's.** The commands in this section download the
> official OpenTeam CLI and server images, which do not include this fork's changes. To run
> ai-TeamOS, build from this repository; see
> [development from source](https://openteam.so/docs/development/from-source) and the Android
> instructions in [apps/android/README.md](apps/android/README.md). This fork does not publish
> releases yet.

### 1. Install the server (upstream OpenTeam)

Run this on the machine that will host your bots.

**macOS / Linux**

```sh
curl -fsSL https://openteam.so/install | sh
```

**Windows PowerShell**

```powershell
irm https://openteam.so/install.ps1 | iex
```

The installer downloads the CLI, adds it to your `PATH`, and starts guided setup. Node.js and Bun are not required.

### 2. Finish setup

Choose how you'll connect, then create your OpenTeam username and password. Setup defaults to a
private connection over your LAN or VPN, starts the server, and prints your **server URL**.
Setup includes private Tailscale HTTPS, public HTTPS, and existing proxy options. Use `openteam setup --advanced` for additional server settings.

### 3. Open the app

[Download the desktop app](https://openteam.so/download), enter the server URL from setup,
and sign in with the account you just created. The app then helps you connect a model with a
ChatGPT or Claude sign-in, or an OpenAI, Anthropic, or OpenRouter API key, and checks that it
replies. Then create your first bot and send it a task. To use your own model server, add it on
the host with `openteam provider add`; see [model providers](https://openteam.so/docs/configuration/models#use-your-own-model-server).

The host and Docker must stay running for bots and routines to work. Server-side work continues
when you close the app. Keep the desktop app open when bots need access to your physical computer.

## Apps

| App | Get it |
| --- | --- |
| Desktop for macOS (Apple silicon) and Linux (x64) | Upstream [downloads](https://openteam.so/download) |
| iPhone (beta) | Upstream [TestFlight](https://testflight.apple.com/join/KFBFPkjP) · [build from source](apps/ios/README.md) |
| Android | [Build from source](apps/android/README.md) |

All apps connect to your server for chat and live screens. Most server settings, such as the model, are in the desktop app.

## Useful commands

```sh
openteam status    # Check the server and its version
openteam doctor    # Diagnose setup or connection problems
openteam setup     # Change the connection mode
openteam update    # Update the CLI and server with backup and rollback
```

See [server commands](https://openteam.so/docs/manage/server), [remote access](https://openteam.so/docs/configuration/remote-access),
[backups](https://openteam.so/docs/manage/backups), and [troubleshooting](https://openteam.so/docs/manage/troubleshooting) for ongoing operation.

## Documentation

- [FORK.md](FORK.md): attribution, branch rules, identifiers and the list of changes in this fork.
- [Server settings](https://openteam.so/docs/configuration/server): where to change each setting after setup.
- [Plugins](https://openteam.so/docs/usage/plugins): connect accounts and control bot access.
- [How hosting works](https://openteam.so/docs/overview/architecture): what runs where and what needs to stay on.
- [Development from source](https://openteam.so/docs/development/from-source): run from source and run checks.

Browse [all upstream documentation](https://openteam.so/docs) for feature guides and implementation notes.

## License

ai-TeamOS is licensed under the [GNU General Public License v3.0](LICENSE), the same license as
OpenTeam. Some bundled third-party components, such as noVNC, fonts, and a few plugins, keep their
own licenses, which are included alongside them. "OpenTeam" and its logo belong to the upstream
author.
