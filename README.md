# Redeven Agent

![Go Version](https://img.shields.io/badge/Go-1.25.8-00ADD8?logo=go)
![Node Version](https://img.shields.io/badge/Node.js-24-339933?logo=node.js)
![Architecture](https://img.shields.io/badge/Architecture-E2EE%20Endpoint-5B2CFF)

Redeven Agent is the endpoint runtime in the Redeven + Flowersec architecture.
It runs on the user machine, receives session grants from the Redeven service, and serves encrypted RPC and streams over Flowersec.

> This repository is intended to stay open-source and auditable. Public docs in this repo describe only the agent runtime, its local behavior, and the public release contract.

## Why the agent exists

- End-to-end encrypted browser sessions terminate on the endpoint, not on the control plane.
- Session metadata and encrypted application bytes are intentionally separated.
- Local capabilities such as files, terminals, monitoring, and code-server run on the user machine.
- Public release artifacts and verification steps are reproducible from this repository.

## Architecture at a glance

```text
                        (management channel, direct)
Redeven Service  ------------------------------------------>  Redeven Agent
  bootstrap + session_meta                                      (endpoint runtime)

Browser (Sandbox)  <========== Flowersec Tunnel ==========>  Redeven Agent
      E2EE client attach token + PSK            E2EE server role + app handlers
                           (data-plane bytes only)
```

Management channel and E2EE transport are split by design:

- Management channel: authenticate, authorize, issue grants, deliver `session_meta`
- E2EE transport: forward encrypted bytes; tunnel cannot decrypt application data

## Build and run

### Prerequisites

- Go `1.25.8`
- Node.js `24`
- npm
- pnpm (or Node.js `corepack`)

### Build

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

Notes:

- `internal/**/dist/` assets are generated and embedded via Go `embed`.
- Generated `dist` assets are not checked into git.
- `./scripts/lint_ui.sh` validates the Env App and Code App source packages before asset bundling.
- `./scripts/check_desktop.sh` validates the Electron desktop shell package (lint, typecheck, tests, build).
- Desktop development and packaging require Node.js `24+`.

### Enable local guardrails

```bash
./scripts/install_git_hooks.sh
```

The pre-commit hook runs `scripts/open_source_hygiene_check.sh --staged`.

### Bootstrap and run

```bash
./redeven bootstrap \
  --controlplane https://<redeven-environment-host> \
  --env-id <env_public_id> \
  --env-token <env_token>

./redeven run
```

By default bootstrap writes:

- `~/.redeven/config.json`
- local permission cap preset `execute_read_write`

Expected result:

- `redeven run` starts without config validation errors
- the Redeven service shows the endpoint online
- Env App can open basic file and terminal actions over E2EE sessions

## Current capability surfaces

### `floe_app = com.floegence.redeven.agent`

- File system RPC (`list/read/write/delete/get_path_context`) and `fs/read_file` stream
- Terminal RPC (`create/list/attach`) with bidirectional data notifications
- Monitor RPC (CPU, network, process snapshots)
- Agent-bundled Env App UI assets
- Optional Flower runtime

See:

- [`docs/ENV_APP.md`](docs/ENV_APP.md)
- [`docs/AI_AGENT.md`](docs/AI_AGENT.md)

### `floe_app = com.floegence.redeven.code`

- code-server over Flowersec E2EE proxy (`flowersec-proxy/http1`, `flowersec-proxy/ws`)
- Agent-bundled inject script for CSP-safe proxying
- Local codespace lifecycle management through the agent gateway

See:

- [`docs/CODE_APP.md`](docs/CODE_APP.md)

## Security model

- The agent does not trust browser-claimed permissions.
- Effective permissions come from server-issued `session_meta`, clamped by local `permission_policy`.
- Capability-to-permission behavior is documented in:
  - [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md)
  - [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md)
- Local config contains sensitive material, including E2EE PSKs; keep local files private.

## Local state

Default state directory is derived from the config path:

- Config: `~/.redeven/config.json`
- State dir: `~/.redeven/`

Common local files:

- `~/.redeven/config.json`
- `~/.redeven/agent.lock`
- `~/.redeven/secrets.json`
- `~/.redeven/audit/events.jsonl`
- `~/.redeven/apps/code/...`

Multi-environment mode uses isolated state per environment:

- `~/.redeven/envs/<env_public_id>/config.json`

Desktop-managed launch preferences are stored separately in the desktop app user data directory. They cover startup-only settings such as:

- Local UI bind address
- Local UI password for non-loopback exposure
- One-shot “register to Redeven on next start” bootstrap values

## Release contract

- GitHub Release is the source of truth for versioned CLI tarballs, desktop installers, and checksums.
- On `v*` tag push, `Release Agent` publishes GitHub Release assets, checksums, signatures, and release notes.
- `scripts/install.sh` resolves versions from GitHub Releases and downloads release assets directly from GitHub.
- This public repository does not document downstream private packaging or deployment wrappers.

Details:

- [`docs/RELEASE.md`](docs/RELEASE.md)

## Documentation map

- Env App runtime: [`docs/ENV_APP.md`](docs/ENV_APP.md)
- Code App runtime: [`docs/CODE_APP.md`](docs/CODE_APP.md)
- Flower runtime and behavior: [`docs/AI_AGENT.md`](docs/AI_AGENT.md)
- Flower settings and secrets: [`docs/AI_SETTINGS.md`](docs/AI_SETTINGS.md)
- Capability-to-permission contract: [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md)
- Local permission policy: [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md)
- Release and artifact verification: [`docs/RELEASE.md`](docs/RELEASE.md)
- Desktop shell packaging and runtime contract: [`docs/DESKTOP.md`](docs/DESKTOP.md)

## Troubleshooting

### `bootstrap failed` or `missing direct connect info`

- Verify `--controlplane`, `--env-id`, and `--env-token`.
- Confirm the Redeven environment is reachable and can issue bootstrap credentials.

### Code App says `code-server binary not found`

- Install `code-server`, or set `REDEVEN_CODE_SERVER_BIN` to an absolute path.
- See [`docs/CODE_APP.md`](docs/CODE_APP.md) for details.

### Codespace page shows `Missing init payload`

- Open codespace from Env App instead of visiting the sandbox URL directly.
- If opener context is gone after refresh, reopen from Env App so a new entry ticket can be minted.

### Redeven Desktop says another agent is already using `~/.redeven`

- Desktop reuses an existing Local UI automatically when the current state directory already exposes one.
- If the existing agent is running without Local UI (for example `redeven run --mode remote`), Desktop stays open and shows a blocked page instead of crashing.
- In that case, stop the existing agent or restart it in a Local UI mode (`local`, `hybrid`, or desktop-managed), then use `Retry`.
- Use `Settings` from the blocked page or `CommandOrControl+,` from the app menu to update Desktop startup settings.
- Use `Copy diagnostics` from the blocked page to capture the lock owner mode, PID, and state paths for troubleshooting.

### Redeven Desktop needs a different bind address or first-time registration

- Open the native Desktop Settings window with `CommandOrControl+,`.
- Set `Local UI bind address` to values such as `127.0.0.1:0` or `0.0.0.0:24000`.
- If you expose Local UI on a non-loopback address, also set a Local UI password.
- To register Desktop to a Redeven environment on the next start, fill in `Control plane URL`, `Environment ID`, and `Environment token`, then save.
- `CommandOrControl+Q` now asks for confirmation before quitting the desktop app.
