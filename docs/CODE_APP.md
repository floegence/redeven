# Code App (code-server over Flowersec E2EE)

This document describes the **Code App** implementation in the Redeven runtime:

- `floe_app = com.floegence.redeven.code`
- Browser ↔ Runtime traffic is end-to-end encrypted (E2EE) via **Flowersec tunnel**
- The browser talks to the runtime using `flowersec-proxy/http1` and `flowersec-proxy/ws`

## Tunnel endpoint semantics

- The `tunnel_url` surfaced in grants, active-session views, and audit logs is a routing endpoint, not an authorization boundary.
- Session isolation and blocking decisions are enforced by signed session metadata and tunnel-side policy checks (for example `(aud, iss)` tenant selection and channel binding).
- Different environments can validly use the same tunnel endpoint URL while still remaining isolated by policy.

## What runs where

- Browser side:
  - A trusted launcher origin (`cs-*` or `pf-*`) exchanges the one-time `entry_ticket` for `grant_client`.
  - The browser then navigates to a controller origin (`rt-*`) that owns the real Flowersec proxy runtime.
  - The controller origin loads the actual app in an `app-*` iframe, so the untrusted app is not same-origin with the runtime/controller window.
  - An app-origin Service Worker forwards `fetch()` through a cross-origin bridge to the controller runtime.
  - The injected script patches same-origin `WebSocket` so it also goes through `flowersec-proxy/ws`, but it now uses `registerCodeAppProxyBridge()` instead of reading `window.top.__flowersecProxyRuntime`.

- Runtime side:
  - The runtime starts one `code-server` process per `code_space_id` (localhost only).
  - The runtime hosts a local gateway on `127.0.0.1`:
    - Serves `/_redeven_proxy/inject.js`
    - Proxies everything else to the correct `code-server` instance
  - The Flowersec server endpoint handlers (`flowersec-proxy/http1`, `flowersec-proxy/ws`) are registered with a **fixed upstream**: the local gateway.

## Local data directory

The Code App stores all code space data on the user's machine (not on Redeven servers).

By default, the runtime config is `~/.redeven/config.json`, so the state directory is:

- `state_dir = ~/.redeven/`

Code App data:

```
~/.redeven/
  config.json
  apps/
    code/
      runtime/
        managed/
          bin/code-server
          lib/code-server-<upstream_release>/
        staging/
          <job_id>/
        cache/
          installer/
            install.sh
          code-server/
            code-server-<upstream_release>-<os>-<arch>.tar.gz
      registry.sqlite
      spaces/
        <code_space_id>/
          codeserver/
            user-data/
            extensions/
            xdg-config/
            xdg-cache/
            xdg-data/
            stdout.log
            stderr.log
```

Deleting a codespace via the Env App (Codespaces page) removes:

- `apps/code/spaces/<code_space_id>/` (entire directory)

It does **not** delete the user's `workspace_path` directory.

## Managed runtime model

The runtime does **not** bundle code-server into the base CLI/Desktop installer.
Instead, Codespaces can install a **managed** `code-server` runtime on demand after an explicit user action inside Env App.

Rules:

- Redeven never auto-installs `code-server` on page load or on codespace open.
- The user must explicitly click `Install latest` or `Update to latest`.
- Redeven runs the official upstream `code-server` install script in `standalone` mode and follows the latest stable release flow by default.
- The managed install target lives under the runtime state directory, so no user shell commands or PATH edits are required.
- Redeven does not pin business behavior to one exact upstream `code-server` version.

## Runtime status and install API

Env App uses the local gateway runtime endpoints before it tries to start Code App:

- `GET /_redeven_proxy/api/code-runtime/status`
- `POST /_redeven_proxy/api/code-runtime/install`
- `POST /_redeven_proxy/api/code-runtime/uninstall`
- `POST /_redeven_proxy/api/code-runtime/cancel`

The explicit install flow is:

1. Env App reads runtime status.
2. Env App Settings exposes a dedicated `code-server Runtime` management card that shows:
   - a steady-state runtime summary for the current Codespaces runtime,
   - a separate `Managed runtime` section only when the managed install adds distinct context beyond the current runtime,
   - a focused running/error panel for explicit install or uninstall actions,
   - recent output only while an operation is running or when the last action failed or was cancelled.
3. If the runtime is missing or unusable, Env App Codespaces shows a dedicated install UI instead of trying to start a codespace.
4. After the user explicitly clicks `Install latest` or `Update to latest`, the runtime:
   - downloads the official upstream `install.sh` latest-stable entrypoint,
   - runs it with `--method=standalone --prefix <managed staging prefix>`,
   - validates that the installed binary is usable,
   - promotes the managed runtime into the stable managed prefix.
5. If the user explicitly clicks `Uninstall`, the runtime removes only the Redeven-managed runtime path. Host-installed runtimes and environment overrides are left untouched.
6. Env App shows focused progress while the action is running, then returns to the calm steady state after success. Failed or cancelled actions keep their recent output visible for recovery.

## Runtime status model

`GET /_redeven_proxy/api/code-runtime/status` returns:

- `active_runtime`: the runtime currently selected for Codespaces (`managed`, `system`, `env_override`, or `none`)
- `managed_runtime`: the Redeven-managed runtime under the runtime state directory, whether or not it is currently selected
- `operation`: the current or most recent explicit management operation (`install` / `uninstall`) plus stage, error, and log tail

This split exists so Settings can truthfully show managed runtime state even when an env override or host runtime is active.

## code-server binary resolution

Binary resolution order:

1) Environment variables (highest precedence):
   - `REDEVEN_CODE_SERVER_BIN`
   - `CODE_SERVER_BIN`
   - `CODE_SERVER_PATH`
2) Redeven-managed runtime under `~/.redeven/apps/code/runtime/managed/`
3) Common install locations (`~/.local/bin/code-server`, Homebrew paths, `/usr/local/bin`, `/usr/bin`, ...)
4) `PATH` (`exec.LookPath("code-server")`)

The selected binary must be usable on the current machine. If the resolved runtime is missing or unusable, Env App blocks the Codespaces launch path and asks the user to explicitly install or update the managed runtime.

### Note for macOS/Homebrew

Homebrew installs `code-server` as a **Node.js script** with a hardcoded shebang that points to a specific Homebrew node binary.

To make the runtime more robust, the Code App detects a Node.js shebang and executes:

- `node <code-server-script> ...`

Interpreter resolution order for Node.js shebang scripts:

1) `REDEVEN_CODE_SERVER_NODE_BIN` (if set)
2) shebang interpreter path (if executable)
3) `PATH` lookup (`node`)

If your `node` is not available in `PATH`, you can override it with:

- `REDEVEN_CODE_SERVER_NODE_BIN=/absolute/path/to/node`

## Startup timeout

By default, the runtime waits up to **20s** for `code-server` to start listening on its localhost port.

You can override this with:

- `REDEVEN_CODE_SERVER_STARTUP_TIMEOUT=30s` (any Go `time.ParseDuration` value)

## Extension host reconnection grace

code-server keeps disconnected extension-host sessions alive for a grace period before cleanup.

- In Local UI mode, Redeven sets a shorter default: **30s**.
  - Rationale: localhost links are stable, and multi-hour grace windows mainly accumulate stale extension-host locks after refresh/reopen.
  - Implementation detail: Redeven passes `--reconnection-grace-time` to code-server.
- In non-Local-UI mode, Redeven keeps code-server upstream defaults.

You can override the grace window with:

- `REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME=45s` (any positive Go `time.ParseDuration` value)

## Permissions

For MVP, the runtime requires **all three** permissions before serving Code App sessions:

- `read`
- `write`
- `execute`

This is conservative: code-server is not designed to enforce a partial permission model at the proxy layer.

## Troubleshooting

- "Missing init payload" in the bootstrap page:
  - Open the codespace from the Redeven Env App (Codespaces page). Do not open the sandbox subdomain directly.

- "code-server binary not found":
  - Open Env App -> Runtime Settings -> `Codespaces & Tooling` -> `code-server Runtime` -> `Install latest`.
  - If you intentionally manage `code-server` yourself, set `REDEVEN_CODE_SERVER_BIN` to a usable binary path.

- "code-server binary is present but unusable":
  - Redeven detected a `code-server` binary, but the runtime probe failed on this host.
  - Update the Redeven-managed runtime to latest from Env App -> Runtime Settings -> `Codespaces & Tooling` -> `code-server Runtime`, or point `REDEVEN_CODE_SERVER_BIN` at a usable binary.

- "code-server did not start listening on 127.0.0.1:PORT":
  - Check the per-codespace logs under:
    - `~/.redeven/apps/code/spaces/<code_space_id>/codeserver/stdout.log`
    - `~/.redeven/apps/code/spaces/<code_space_id>/codeserver/stderr.log`
  - Verify `code-server` runs on your machine (`code-server --version`).
  - If Homebrew installs `code-server` as a Node.js script, ensure `node` works, or set `REDEVEN_CODE_SERVER_NODE_BIN`.
  - If startup is slow on your machine (first launch, heavy extensions, slow disk), increase `REDEVEN_CODE_SERVER_STARTUP_TIMEOUT`.

- Frequent "Extension Host reconnect" loops:
  - Redeven now cleans up stale code-server processes for the same codespace session socket before start/stop.
  - Redeven also removes stale `User/workspaceStorage/*/vscode.lock` files before each start.
  - In Local UI mode, Redeven also shortens extension-host reconnection grace to 30s by default to reduce long-lived stale locks.
  - You can tune this per machine via `REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME`.
  - If reconnect loops persist, inspect `remoteagent.log` and `exthost*/remoteexthost.log` under:
    - `~/.redeven/apps/code/spaces/<code_space_id>/codeserver/user-data/logs/<timestamp>/`

- "Handshake timed out":
  - Ensure the launcher/controller bootstrap can load `/_redeven_boot/`, and the app origin can load `/_redeven_app/` plus `/_redeven_app_sw.js`.
  - Ensure popups are allowed.
  - If you refreshed the codespace window after the bootstrap cleared the URL hash, the page must re-request a fresh `entry_ticket` from its opener (Env App). Reopen the codespace from the Env App if the opener is gone.
  - Ensure the runtime is online and reachable via the configured Flowersec tunnel endpoint.
