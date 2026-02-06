# Env App (env details UI over Flowersec E2EE)

This document describes the **Env App** implementation in the Redeven agent.

Key points:

- The Env App UI is **agent-bundled** (built + embedded into the agent binary).
- The browser accesses it over a **Flowersec E2EE proxy** (runtime mode).
- Env details features live here (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/AI).

## What runs where

Browser side:

- A sandbox bootstrap window (`env-<env_id>.<region>.<base-domain>`) creates a runtime-mode proxy:
  - A Service Worker forwards `fetch()` to the proxy runtime via `postMessage + MessageChannel`.
  - The runtime forwards HTTP/WS traffic over Flowersec E2EE to the agent.
- The bootstrap then loads the Env App UI via a same-origin iframe:
  - `/_redeven_proxy/env/`

Agent side:

- The agent serves Env App static assets under `/_redeven_proxy/env/*` via the local gateway.
- The Env App UI talks to the agent using **Flowersec RPC/streams** (fs/terminal/monitor domains).

## Control-plane APIs used by the Env App UI

The Env App UI does not use Redeven login cookies. It uses a `broker_token` stored in
the sandbox origin `sessionStorage`.

- `POST /api/srv/v1/floeproxy/entry` (Env App only; broker_token -> one-time entry_ticket for itself)
- `GET /api/srv/v1/floeproxy/environments/:envId`
- `POST /api/srv/v1/floeproxy/environments/:envId/entry` (Env App launcher; mint one-time entry_ticket for target apps)

All requests are `credentials: 'omit'` and include:

- `Authorization: Bearer <broker_token>`

## Audit log

There are **two** audit log sources:

1) Region-side grant audit log (control plane): recorded by control plane at `/v1/channel/init*`.
   - This is **not** shown in the Env App.
   - It is surfaced in the Console Dashboard environments list (env admin only).

2) Agent-local audit log (user operations): recorded and persisted by the agent.
   - Env App reads it via the local gateway API (env admin only):
     - `GET /_redeven_proxy/api/audit/logs?limit=<n>`
   - Storage (JSONL + rotation):
     - `<state_dir>/audit/events.jsonl`
     - `state_dir` is the directory of the agent config file (default: `~/.redeven/`)
   - The log is metadata-only and must not contain secrets (PSK/attach token/AI secrets/file contents).

## Codespaces (code-server) management

The Env App UI manages local codespaces via the agent local gateway API:

- `GET /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces/:id/start`
- `POST /_redeven_proxy/api/spaces/:id/stop`
- `DELETE /_redeven_proxy/api/spaces/:id`

When opening a codespace, the Env App uses its own `broker_token(com.floegence.redeven.agent)` to mint a one-time `entry_ticket` for `com.floegence.redeven.code`, then opens:

- `https://cs-<code_space_id>.<region>.<base-domain>/_redeven_boot/#redeven=<b64url(init)>`

Notes:

- Codespace/3rd-party app windows never receive or persist `broker_token`. They only get a short-lived one-time `entry_ticket`.
- If a codespace window is refreshed after the hash is cleared, it can request a fresh `entry_ticket` from the opener Env App via `postMessage` handshake.

## Build

Env App UI sources:

- `internal/envapp/ui_src/`

Build output (embedded by Go `embed`):

- `internal/envapp/ui/dist/env/*`

Build (recommended):

```bash
./scripts/build_assets.sh
```

Note: `internal/envapp/ui/dist/` is generated and not checked into git.
