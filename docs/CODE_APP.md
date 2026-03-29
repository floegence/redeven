# Code App (code-server over Flowersec E2EE)

This document describes the **Code App** implementation in the Redeven agent:

- `floe_app = com.floegence.redeven.code`
- Browser ↔ Agent traffic is end-to-end encrypted (E2EE) via **Flowersec tunnel**
- The browser talks to the agent using `flowersec-proxy/http1` and `flowersec-proxy/ws`

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

- Agent side:
  - The agent starts one `code-server` process per `code_space_id` (localhost only).
  - The agent hosts a local gateway on `127.0.0.1`:
    - Serves `/_redeven_proxy/inject.js`
    - Proxies everything else to the correct `code-server` instance
  - The Flowersec server endpoint handlers (`flowersec-proxy/http1`, `flowersec-proxy/ws`) are registered with a **fixed upstream**: the local gateway.

## Local data directory

The Code App stores all code space data on the user's machine (not on Redeven servers).

By default, the agent config is `~/.redeven/config.json`, so the state directory is:

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
          lib/code-server-<supported_version>/
        staging/
          <job_id>/
        cache/
          installer/
            <supported_version>/install.sh
          code-server/
            code-server-<supported_version>-<os>-<arch>.tar.gz
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

The agent does **not** bundle code-server into the base CLI/Desktop installer.
Instead, Codespaces can install a **managed** `code-server` runtime on demand after an explicit user action inside Env App.

Rules:

- Redeven never auto-installs `code-server` on page load or on codespace open.
- The user must explicitly click `Install code-server`.
- Redeven runs the official upstream `code-server` install script in `standalone` mode and pins one supported version.
- The managed install target lives under the agent state directory, so no user shell commands or PATH edits are required.

Current supported version:

- `4.108.2`

## Runtime status and install API

Env App uses the local gateway runtime endpoints before it tries to start Code App:

- `GET /_redeven_proxy/api/code-runtime/status`
- `POST /_redeven_proxy/api/code-runtime/install`
- `POST /_redeven_proxy/api/code-runtime/cancel`

The explicit install flow is:

1. Env App reads runtime status.
2. If the runtime is missing or incompatible, Env App shows a dedicated install UI instead of trying to start a codespace.
3. After the user clicks `Install code-server`, the agent:
   - downloads or reuses the official upstream `install.sh` for the pinned version,
   - runs it with `--method=standalone --prefix <managed staging prefix> --version <supported_version>`,
   - validates the installed binary version,
   - promotes the managed runtime into the stable managed prefix.
4. Env App shows progress, result state, and any recent installer output.

## code-server binary resolution

Binary resolution order:

1) Environment variables (highest precedence):
   - `REDEVEN_CODE_SERVER_BIN`
   - `CODE_SERVER_BIN`
   - `CODE_SERVER_PATH`
2) Redeven-managed runtime under `~/.redeven/apps/code/runtime/managed/`
3) Common install locations (`~/.local/bin/code-server`, Homebrew paths, `/usr/local/bin`, `/usr/bin`, ...)
4) `PATH` (`exec.LookPath("code-server")`)

The selected binary must match the pinned supported version. If the resolved runtime is missing or incompatible, Env App blocks the Codespaces launch path and asks the user to explicitly install the managed runtime.

### Note for macOS/Homebrew

Homebrew installs `code-server` as a **Node.js script** with a hardcoded shebang that points to a specific Homebrew node binary.

To make the agent more robust, the Code App detects a Node.js shebang and executes:

- `node <code-server-script> ...`

Interpreter resolution order for Node.js shebang scripts:

1) `REDEVEN_CODE_SERVER_NODE_BIN` (if set)
2) shebang interpreter path (if executable)
3) `PATH` lookup (`node`)

If your `node` is not available in `PATH`, you can override it with:

- `REDEVEN_CODE_SERVER_NODE_BIN=/absolute/path/to/node`

## Startup timeout

By default, the agent waits up to **20s** for `code-server` to start listening on its localhost port.

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

For MVP, the agent requires **all three** permissions before serving Code App sessions:

- `read`
- `write`
- `execute`

This is conservative: code-server is not designed to enforce a partial permission model at the proxy layer.

## Troubleshooting

- "Missing init payload" in the bootstrap page:
  - Open the codespace from the Redeven Env App (Codespaces page). Do not open the sandbox subdomain directly.

- "code-server binary not found":
  - Open Env App -> Codespaces -> `Install code-server`.
  - If you intentionally manage `code-server` yourself, set `REDEVEN_CODE_SERVER_BIN` to a compatible binary path.

- "unsupported code-server version":
  - Redeven detected a `code-server` binary, but it does not match the pinned supported version.
  - Install the Redeven-managed runtime from Env App -> Codespaces, or point `REDEVEN_CODE_SERVER_BIN` at a compatible binary.

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
  - Ensure the agent is online and reachable via the configured Flowersec tunnel endpoint.
