# Server commands

Manage your server with the `outcomego` command on the host.

## Common commands

| Command | What it does |
| --- | --- |
| `outcomego status` | Shows the server URL, version, and health of each service |
| `outcomego doctor` | Checks for setup, connection, storage, and model problems |
| `outcomego start` | Starts the server and waits until it's ready |
| `outcomego stop` | Stops the server. Your data is kept. |
| `outcomego logs --follow` | Streams logs from all services |
| `outcomego setup` | Changes connection mode, including Tailscale HTTPS |
| `outcomego setup --advanced` | Also changes API port, time zone, and tasks at once |
| `outcomego tailscale enable [--https-port <port>]` | Configures and verifies private HTTPS through Serve |
| `outcomego tailscale status` | Checks Tailscale, route ownership, and HTTPS readiness |
| `outcomego tailscale disable` | Returns to local access and removes unchanged OutcomeGo-managed mappings |
| `outcomego model` | Chooses the model, reasoning level, and voice transcription |
| `outcomego provider` | Signs in to, signs out of, or adds model providers |
| `outcomego account update` | Changes your username or password |
| `outcomego update` | Updates the server and the CLI |
| `outcomego uninstall` | Removes the server containers and CLI while preserving configuration and data |

Run `outcomego <command> --help` for options. If you installed to a different directory, add `--dir <path>`.

## Diagnose a problem

Start with `outcomego status`. If a service isn't healthy or bots aren't responding, run `outcomego doctor`. It explains each failed check and what to do. Doctor sends one short request to your model provider, which counts toward your usage. It doesn't start services or change your settings.

To see logs for one service:

```sh
outcomego logs server --follow
```

The main services are `server`, `worker`, `computer`, and `postgres`, plus `caddy` if you use automatic HTTPS.

## Change your account

```sh
outcomego account update
```

This asks for a new username and password, and signs out every connected app. To change only one, add `--username <name>` or `--password`.

## Uninstall

```sh
outcomego uninstall
```

This removes the containers and the `outcomego` CLI, but keeps your data and configuration. Run the installer again to restore the CLI and bring the server back with the preserved data.

To delete everything, including your bots, conversations, files, and update backups:

```sh
outcomego uninstall --purge
```

This can't be undone. Make a [backup](backups.md) first if you might want your data back. Both uninstall modes remove the `outcomego` CLI; on Windows, deletion completes immediately after the running CLI process exits.
