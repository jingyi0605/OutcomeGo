# Server commands

Manage your server with the `aiteamos` command on the host.

## Common commands

| Command | What it does |
| --- | --- |
| `aiteamos status` | Shows the server URL, version, and health of each service |
| `aiteamos doctor` | Checks for setup, connection, storage, and model problems |
| `aiteamos start` | Starts the server and waits until it's ready |
| `aiteamos stop` | Stops the server. Your data is kept. |
| `aiteamos logs --follow` | Streams logs from all services |
| `aiteamos setup` | Changes connection mode, including Tailscale HTTPS |
| `aiteamos setup --advanced` | Also changes API port, time zone, and tasks at once |
| `aiteamos tailscale enable [--https-port <port>]` | Configures and verifies private HTTPS through Serve |
| `aiteamos tailscale status` | Checks Tailscale, route ownership, and HTTPS readiness |
| `aiteamos tailscale disable` | Returns to local access and removes unchanged aiTeamOS-managed mappings |
| `aiteamos model` | Chooses the model, reasoning level, and voice transcription |
| `aiteamos provider` | Signs in to, signs out of, or adds model providers |
| `aiteamos account update` | Changes your username or password |
| `aiteamos update` | Updates the server and the CLI |
| `aiteamos uninstall` | Removes the server containers and CLI while preserving configuration and data |

Run `aiteamos <command> --help` for options. If you installed to a different directory, add `--dir <path>`.

## Diagnose a problem

Start with `aiteamos status`. If a service isn't healthy or bots aren't responding, run `aiteamos doctor`. It explains each failed check and what to do. Doctor sends one short request to your model provider, which counts toward your usage. It doesn't start services or change your settings.

To see logs for one service:

```sh
aiteamos logs server --follow
```

The main services are `server`, `worker`, `computer`, and `postgres`, plus `caddy` if you use automatic HTTPS.

## Change your account

```sh
aiteamos account update
```

This asks for a new username and password, and signs out every connected app. To change only one, add `--username <name>` or `--password`.

## Uninstall

```sh
aiteamos uninstall
```

This removes the containers and the `aiteamos` CLI, but keeps your data and configuration. Run the installer again to restore the CLI and bring the server back with the preserved data.

To delete everything, including your bots, conversations, files, and update backups:

```sh
aiteamos uninstall --purge
```

This can't be undone. Make a [backup](backups.md) first if you might want your data back. Both uninstall modes remove the `aiteamos` CLI; on Windows, deletion completes immediately after the running CLI process exits.
