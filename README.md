# redeven-agent

Redeven Agent is the **endpoint** in the Redeven + Flowersec E2EE architecture.

- Control-plane: the agent connects to control plane via **Flowersec direct** (`/control/ws`, no tunnel).
- Data-plane: the agent receives `grant_server` over the control channel, then attaches to a **Flowersec tunnel server** as `role=server` and serves encrypted RPC/streams.

This repository is intended to be **open-sourced** so users can audit what runs on their machines.

## Status

Implemented in this repo:

- `floe_app = com.floegence.redeven.agent`
  - File system RPC (list/read/write/delete/get_home) + `fs/read_file` stream
  - Terminal RPC (create/list/attach) + bidirectional data notifications
  - Monitor RPC (CPU/network/process snapshot)
  - Agent-bundled Env App UI assets: `internal/envapp/ui_src/` -> `internal/envapp/ui/dist/`
  - Optional: Env App AI Agent (TS sidecar + Go tool executor). Documentation: [`docs/AI_AGENT.md`](docs/AI_AGENT.md)
  - Documentation: [`docs/ENV_APP.md`](docs/ENV_APP.md)
- `floe_app = com.floegence.redeven.code`
  - code-server over Flowersec E2EE proxy (`flowersec-proxy/http1`, `flowersec-proxy/ws`)
  - Agent-bundled UI assets (CSP-safe inject script): `internal/codeapp/ui_src/` -> `internal/codeapp/ui/dist/`
  - Documentation: [`docs/CODE_APP.md`](docs/CODE_APP.md)

Not implemented yet (planned):

- `floe_app = ...` (rebrowser, plugin marketplace apps, etc)

## Build

Requirements:

- Go `1.25.6`

Build:

```bash
go build -o redeven-agent ./cmd/redeven-agent
```

## Quick start

1) Bootstrap (exchange env token for direct control-channel credentials):

```bash
./redeven-agent bootstrap \
  --controlplane https://<region>.<base-domain> \
  --env-id <env_public_id> \
  --env-token <env_token> \
  --permission-policy execute_read
```

This writes a local config file (default: `~/.redeven-agent/config.json`).

2) Run:

```bash
./redeven-agent run
```

## Security notes

- The config file contains secrets (PSK). Keep it private (`chmod 600`).
- The agent **does not** trust browser-claimed permissions; it only trusts `session_meta` delivered by control plane over the direct control channel.
- Capability-to-permission mapping (what each permission enables): [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md).
- Local permission cap (`permission_policy`): [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md).

## FS path model

FS RPC paths use a **virtual root**:

- `/` is the agent's configured filesystem root directory.
- All FS requests/responses use POSIX-like absolute paths (e.g. `/projects/app`).
