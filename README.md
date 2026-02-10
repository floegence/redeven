# Redeven Agent

![Go Version](https://img.shields.io/badge/Go-1.25.7-00ADD8?logo=go)
![Node Version](https://img.shields.io/badge/Node.js-20-339933?logo=node.js)
![Architecture](https://img.shields.io/badge/Architecture-E2EE%20Endpoint-5B2CFF)

Redeven Agent is the **endpoint runtime** in the Redeven + Flowersec architecture.
It runs on the user machine, receives control-plane grants from control plane, and serves encrypted RPC/streams over Flowersec.

> This repository is designed to be open-source and auditable, so users can inspect exactly what runs locally.

## Why Redeven Agent

- **E2EE by design**: business traffic is encrypted end-to-end between browser and endpoint.
- **Clear trust boundary**: control-plane metadata and data-plane bytes are separated by architecture.
- **Local-first runtime**: files, terminals, monitoring, and code-server run on the user machine.
- **Auditable behavior**: release and verification flow are documented and reproducible.

## Architecture at a Glance

```text
                           (control-plane, direct)
control plane  -------------------------------------------->  Redeven Agent
  /control/ws, grant_server + session_meta                     (endpoint runtime)

Browser (Sandbox)  <========== Flowersec Tunnel ==========>  Redeven Agent
      E2EE client attach token + PSK            E2EE server role + app handlers
                           (data-plane bytes only)
```

Control-plane and data-plane are intentionally split:

- **Control-plane**: authenticate, authorize, issue grants, deliver `session_meta`.
- **Data-plane**: forward encrypted bytes; tunnel cannot decrypt application data.

## Quick Start (2 Minutes)

### Prerequisites

- Go `1.25.7`
- Node.js `20`
- npm
- pnpm (or Node.js `corepack`)

### Build

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

Notes:

- `internal/**/dist/` is generated and embedded via Go `embed`.
- Generated `dist` assets are not checked into git.

### Bootstrap and run

```bash
./redeven bootstrap \
  --controlplane https://<region>.<base-domain> \
  --env-id <env_public_id> \
  --env-token <env_token>

./redeven run
```

What bootstrap writes by default:

- Config path: `~/.redeven/config.json`
- Default local permission cap: `execute_read_write`

### Success checklist

- `redeven run` starts without config validation errors.
- control plane sees the endpoint online through direct control channel.
- Env App can open and perform basic file/terminal actions through E2EE sessions.

## What You Get Today

### `floe_app = com.floegence.redeven.agent`

- File system RPC (`list/read/write/delete/get_home`) + `fs/read_file` stream
- Terminal RPC (`create/list/attach`) with bidirectional data notifications
- Monitor RPC (CPU/network/process snapshots)
- Agent-bundled Env App UI assets
- Optional AI Agent (TypeScript sidecar + Go executor)
- Installer-managed Node.js runtime bootstrap for AI sidecar (`node >= 20`)

Details:

- Env App: [`docs/ENV_APP.md`](docs/ENV_APP.md)
- AI Agent: [`docs/AI_AGENT.md`](docs/AI_AGENT.md)

### `floe_app = com.floegence.redeven.code`

- code-server over Flowersec E2EE proxy (`flowersec-proxy/http1`, `flowersec-proxy/ws`)
- Agent-bundled inject script for CSP-safe WebSocket/fetch proxying
- Local codespace lifecycle management via agent local gateway

Details:

- Code App: [`docs/CODE_APP.md`](docs/CODE_APP.md)

## Security Model

- The agent **does not trust browser-claimed permissions**.
- Effective permissions come from:
  - control-plane `session_meta`
  - intersected with local `permission_policy` cap
- Capability behavior is explicit and documented:
  - [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md)
  - [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md)
- Config contains sensitive material (including E2EE PSK); keep local files private (`chmod 600`).

## Data and State on Disk

Default state directory is derived from config path:

- Config: `~/.redeven/config.json`
- State dir: `~/.redeven/`

Common local files:

- `~/.redeven/config.json` (runtime config)
- `~/.redeven/agent.lock` (single-process lock for one state dir)
- `~/.redeven/secrets.json` (local secrets such as AI provider API keys)
- `~/.redeven/audit/events.jsonl` (audit metadata log)
- `~/.redeven/apps/code/...` (code-server spaces and logs)

Multi-environment mode uses isolated state per environment:

- `~/.redeven/envs/<env_public_id>/config.json`

## Operations and Release

- GitHub Release is the source of truth for versioned binaries and checksums.
- On `v*` tag push, `Release Agent` publishes GitHub Release assets, then `.github/workflows/sync-release-assets-to-r2.yml` auto-runs via `workflow_run` and mirrors assets to package mirror (`release-assets/<tag>/...`).
- After mirror integrity verification succeeds, the workflow deploys the version-manifest Worker for `https://version.agent.example.invalid/v1/manifest.json` (no manifest bucket required).
- `install.sh` downloads from GitHub first, then falls back to external delivery mirror.
- Installer worker deployment (`example.invalid/install.sh`) stays on downstream deployment automation and is triggered only via the `release` branch flow.

Release details:

- [`docs/RELEASE.md`](docs/RELEASE.md)

## Documentation Map

- **Env App runtime**: [`docs/ENV_APP.md`](docs/ENV_APP.md)
- **Code App runtime**: [`docs/CODE_APP.md`](docs/CODE_APP.md)
- **AI sidecar and behavior**: [`docs/AI_AGENT.md`](docs/AI_AGENT.md)
- **AI settings and secrets model**: [`docs/AI_SETTINGS.md`](docs/AI_SETTINGS.md)
- **Capability-to-permission contract**: [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md)
- **Local permission policy**: [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md)
- **Release and artifact verification**: [`docs/RELEASE.md`](docs/RELEASE.md)

## FAQ / Troubleshooting

### `bootstrap failed` or `missing direct connect info`

- Verify `--controlplane`, `--env-id`, and `--env-token` are correct.
- Confirm control plane can reach the environment and issue bootstrap credentials.

### Code App says `code-server binary not found`

- Install `code-server` locally, or set `REDEVEN_CODE_SERVER_BIN` to an absolute path.
- See detailed binary resolution and platform notes in [`docs/CODE_APP.md`](docs/CODE_APP.md).

### Codespace page shows `Missing init payload`

- Open codespace from Env App (Codespaces page), not by directly visiting sandbox URL.
- If opener context is gone after refresh, reopen from Env App to mint a new entry ticket.

## Roadmap (Near Term)

- Add more `floe_app` surfaces on top of the same control/data-plane contract.
- Continue hardening runtime permissions and auditability.
- Improve operational diagnostics for endpoint-side troubleshooting.
