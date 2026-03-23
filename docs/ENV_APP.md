# Env App (env details UI over Flowersec E2EE)

This document describes the **Env App** implementation in the Redeven agent.

Key points:

- The Env App UI is **agent-bundled** (built + embedded into the agent binary).
- The browser accesses it over a **Flowersec E2EE proxy** (runtime mode).
- Env details features live here (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower).
- Flower thread history keeps the chat `title` separate from the latest `last_message_preview` snippet: untitled chats render as `New chat` until the agent later writes a generated title, while the preview line continues to reflect the newest visible message text.
- Flower auto titles are best-effort but resilient: the agent retries transient generation failures in the background, can expand the title-generation output budget once for reasoning-heavy models, and also recovers recent untitled threads after restart, so users should see the final title appear without manual refresh or rename in normal cases.
- File Browser text/code previews now use a Monaco-based viewer/editor path for the primary experience, matching the shared Floe Webapp editor surface.
- When the environment grants `can_write`, text previews can switch into an editable mode and save changes back through the agent file RPC.
- Languages that Monaco can only treat as plain text still stay on the same Monaco surface so preview and Edit mode remain visually aligned.
- Truncated reads and Monaco load failures fall back to the lightweight Shiki/plain-text preview path so preview remains responsive.
- Desktop-managed runs can promote serializable overlay surfaces into dedicated desktop child windows by reopening the same Env App entrypoint in a detached-scene mode (`file_preview` and `file_browser` today).

## Accessibility baseline

Env App targets a WCAG 2.2 AA baseline. The implementation follows an upstream-first split:

- Shared shell landmarks, skip-link behavior, main-region targeting, dropdown semantics, and generic tab behavior come from released `@floegence/floe-webapp-*` packages.
- Redeven-specific code only handles product-owned surfaces such as the local access gate, AI sidebar, custom tool blocks, git widgets, terminal integration, and file-browser composition.

Contributor rules for this surface:

- Prefer upstream primitives and contracts over page-level ARIA patching.
- Custom file-browser compositions that bypass the standard `FileBrowser` wrapper must mount `FileBrowserDragPreview` from `@floegence/floe-webapp-core/file-browser` whenever drag and drop stays enabled, so the shared drag affordance remains visible.
- Use real buttons, inputs, fieldsets, tabs, and panels for interactive behavior. Do not nest interactive elements.
- Keep visible focus indicators intact. Do not suppress focus rings on terminal, file, or chat surfaces without providing an equally visible replacement.
- When a control behaves like tabs, it must implement tab semantics completely, including roving `tabindex`, arrow key handling, and `aria-controls` / `aria-labelledby` pairing.
- Status and validation feedback should be programmatically associated with the relevant control, and blocking failures should move focus to the surfaced error or recovery target.

Current product-specific accessibility contract:

- The access gate uses explicit labels, help text, error associations, and focused recovery after unlock failures.
- AI thread rows keep thread selection and deletion as separate buttons instead of nested interactive content.
- Tool-call disclosures use a dedicated disclosure button, stable controlled content IDs, and separate approval actions. Web-search domain filters are grouped toggle buttons rather than fake tabs.
- Git view switching and branch subviews use keyboard-complete tablists with roving focus.
- The terminal surface keeps a visible focus treatment. Product-owned terminal, Ask Flower composer, and file-browser controls were audited during this work and intentionally kept on their existing semantic button/input patterns.

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
- Flower assistant live rendering treats reasoning as visible content, not hidden telemetry. Provider-side reasoning fragments must preserve user-visible whitespace semantics, and realtime transport may coalesce frequent low-priority assistant updates, but the active thread UI must converge to the same complete reasoning/markdown content already preserved in the persisted transcript when the run ends.
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
- Agent Settings exposes a Diagnostics panel under Logging and reads data through:
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
