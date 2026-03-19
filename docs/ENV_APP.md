# Env App (env details UI over Flowersec E2EE)

This document describes the **Env App** implementation in the Redeven agent.

Key points:

- The Env App UI is **agent-bundled** (built + embedded into the agent binary).
- The browser accesses it over a **Flowersec E2EE proxy** (runtime mode).
- Env details features live here (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower).
- File Browser text previews now use Shiki-based syntax highlighting for recognized code/config formats, with large files degrading to plain text for responsiveness.
- Desktop-managed runs can promote serializable overlay surfaces into dedicated desktop child windows by reopening the same Env App entrypoint in a detached-scene mode (`file_preview` and `file_browser` today).

## What runs where

Browser side:

- A sandbox bootstrap window (`env-<env_id>.<region>.<base-sandbox-domain>`, for example `env-demo.dev.redeven-sandbox.test`) creates a runtime-mode proxy:
  - A Service Worker forwards `fetch()` to the proxy runtime via `postMessage + MessageChannel`.
  - The runtime forwards HTTP/WS traffic over Flowersec E2EE to the agent.
- The bootstrap then loads the Env App UI via a same-origin iframe:
  - `/_redeven_proxy/env/`
- This same-origin iframe pattern is specific to the trusted Env App origin.
  - Codespace and port-forward windows opened from Env App use a different path:
    `cs-*` / `pf-*` trusted launcher -> `rt-*` controller origin -> `app-*` untrusted app origin.
  - The untrusted app never runs on the same origin as the Env App runtime/controller window.

Agent side:

- The agent serves Env App static assets under `/_redeven_proxy/env/*` via the local gateway.
- The Env App UI talks to the agent using **Flowersec RPC/streams** (fs/terminal/monitor domains).
- Detached desktop child windows keep using the same Env App runtime, access gate, and Flowersec protocol path; only the scene rendered inside the window changes.
- Terminal initializes new users with the `Dark` color theme and `Monaco` font while still preserving any saved per-user overrides.
- On mobile, Terminal defaults to the built-in Floe keyboard, keeps taps from auto-triggering the system IME in Floe mode, and offers suggestion rails for recent commands, common commands, scripts, and paths. The default mobile input mode is chosen in Terminal settings as a strict `Floe Keyboard` / `System IME` toggle, while the More menu only exposes temporary show/hide actions when Floe Keyboard mode is active. Floe Keyboard stays as a bottom overlay, the terminal viewport aligns itself to the measured keyboard inset instead of reserving a separate blank spacer above it, and vertical touch drags on the terminal surface are translated into native terminal scrolling on mobile.

## Session bootstrap flow used by the Env App UI

The Env App UI runs on sandbox origins and uses the Redeven session-bootstrap flow:

- Portal issues a one-time `boot_ticket` for Env App startup.
- Sandbox bootstrap exchanges `boot_ticket` for an HttpOnly `env_session` cookie.
- Env App uses `env_session` to mint one-time `entry_ticket` values on demand.
- `entry_ticket` is then redeemed to establish Flowersec sessions.

Security baseline:

- Env App UI never stores long-lived capability credentials in browser storage.
- High-value credentials are HttpOnly cookies scoped to the sandbox origin.
- One-time `entry_ticket` values are exchanged on demand with short TTL.
- If sandbox session context is missing or expired, the browser must return to the Redeven web app for re-issuance.

## Audit log

There are **two** audit log sources:

1) Redeven service-side session audit log.
   - This is **not** shown in the Env App.
   - It is surfaced in the Redeven web app for environment admins.

2) Agent-local audit log (user operations): recorded and persisted by the agent.
   - Env App reads it via the local gateway API (env admin only):
     - `GET /_redeven_proxy/api/audit/logs?limit=<n>`
   - Storage (JSONL + rotation):
     - `<state_dir>/audit/events.jsonl`
     - `state_dir` is the directory of the agent config file (default: `~/.redeven/`)
   - The log is metadata-only and must not contain secrets (PSK/attach token/AI secrets/file contents).

## Diagnostics mode

Diagnostics mode is enabled implicitly when the agent config uses:

- `logging.log_level = "debug"`

Behavior:

- Agent-side request/direct-session diagnostics are stored separately from audit logs:
  - `<state_dir>/diagnostics/agent-events.jsonl`
- Desktop builds that attach to the same runtime may also write:
  - `<state_dir>/diagnostics/desktop-events.jsonl`
- Local UI and gateway share a single trace header:
  - `X-Redeven-Debug-Trace-ID`
- Env Settings exposes a Diagnostics panel under Logging and reads data through:
  - `GET /_redeven_proxy/api/debug/diagnostics`
  - `GET /_redeven_proxy/api/debug/diagnostics/export`

The diagnostics stream is timing-focused and must remain separate from the audit log because it is intended for troubleshooting performance and startup issues rather than user-operation auditing.

## Codespaces (code-server) management

The Env App UI manages local codespaces via the agent local gateway API:

- `GET /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces`
- `POST /_redeven_proxy/api/spaces/:id/start`
- `POST /_redeven_proxy/api/spaces/:id/stop`
- `DELETE /_redeven_proxy/api/spaces/:id`

When opening a codespace, the Env App mints a one-time ticket for `com.floegence.redeven.code`, then opens:

- `https://cs-<code_space_id>.<region>.<base-sandbox-domain>/_redeven_boot/#redeven=<b64url(init)>`

Notes:

- Codespace/3rd-party app windows never receive `boot_ticket` or `env_session`. They only get one-time `entry_ticket`.
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
