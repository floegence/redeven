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
  - A trusted launcher origin (`cs-*` or `pf-*`) exchanges the one-time `entry_ticket` for a canonical `connect_artifact`, and Flowersec uses the embedded tunnel grant to establish the runtime session.
  - The browser then navigates to a controller origin (`rt-*`) that owns the real Flowersec proxy runtime.
  - The controller origin loads the actual app in an `app-*` iframe, so the untrusted app is not same-origin with the runtime/controller window.
  - An app-origin Service Worker forwards `fetch()` through a cross-origin bridge to the controller runtime.
  - The injected script patches same-origin `WebSocket` so it also goes through `flowersec-proxy/ws`, but it now uses `registerCodeAppProxyBridge()` instead of reading `window.top.__flowersecProxyRuntime`.
  - In Redeven Desktop, Env App requests the desktop shell to open Codespaces in the system browser, but the browser-facing bootstrap contract stays the same: the first load still starts from the trusted launcher with a one-time `entry_ticket`.
  - For desktop-managed Local UI with an access password, the first protected `http://127.0.0.1:23998/cs/<code_space_id>/...` request can arrive with only `redeven_access_resume`. Local UI exchanges that resume token into the normal `redeven_local_access` cookie before returning the page so code-server subresources can continue on the standard same-origin session path.

- Runtime side:
  - The runtime starts one `code-server` process per `code_space_id` (localhost only).
  - The runtime hosts a local gateway on `127.0.0.1`:
    - Serves `/_redeven_proxy/inject.js`
    - Proxies everything else to the correct `code-server` instance
  - The Flowersec server endpoint handlers (`flowersec-proxy/http1`, `flowersec-proxy/ws`) are registered with a **fixed upstream**: the local gateway.

## Local data directory

The Code App stores all code space data in the user's Local Environment state, not on Redeven servers.

By default, the Local Environment config is `~/.redeven/local-environment/config.json`, so the state directory is:

- `state_dir = ~/.redeven/local-environment/`
- `state_root = ~/.redeven/`

Local Environment-scoped Code App data:

```
~/.redeven/
  local-environment/
    config.json
    apps/
      code/
        runtime/
          current.json
          managed -> ~/.redeven/shared/code-server/<os>-<arch>/versions/<version>/
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

Local Environment-scoped shared managed runtime data:

```
~/.redeven/
  shared/
    code-server/
      <os>-<arch>/
        local-environment.json
        lock
        downloads/
          install.sh
        staging/
          <job_id>/
        versions/
          <version>/
            bin/code-server
            lib/code-server-<upstream_release>/
```

Deleting a codespace via the Env App (Codespaces page) removes:

- `apps/code/spaces/<code_space_id>/` (entire directory)

It does **not** delete the user's `workspace_path` directory.

## Managed runtime model

The runtime does **not** bundle code-server into the base CLI/Desktop installer.
Instead, Codespaces can install a **managed** `code-server` runtime on demand after an explicit user action inside Env App.

Rules:

- Redeven never auto-installs `code-server` on page load or on codespace open.
- Installing a managed version stores it once per Local Environment under the shared runtime root.
- Each environment stores only its own managed version selection in `apps/code/runtime/current.json`.
- New environments inherit the Local Environment default managed version when they do not pin their own version.
- The user must explicitly click `Install and use for this environment` or `Install latest and use for this environment`.
- Redeven runs the official upstream `code-server` install script in `standalone` mode and follows the latest stable release flow by default.
- The environment-local `apps/code/runtime/managed` path is only a symlink to the selected shared version.
- No user shell commands or PATH edits are required for the managed runtime.
- Redeven does not pin business behavior to one exact upstream `code-server` version.
- If an environment explicitly selected a managed version and that version is missing or unusable, Redeven reports the problem directly and does **not** silently fall back to another managed or host runtime.

Managed selection precedence remains:

1. `REDEVEN_CODE_SERVER_BIN`
2. `CODE_SERVER_BIN`
3. `CODE_SERVER_PATH`
4. explicit environment-managed selection
5. Local Environment default managed selection
6. host runtime discovery

## Runtime status and install API

Env App uses the local gateway runtime endpoints before it tries to start Code App:

- `GET /_redeven_proxy/api/code-runtime/status`
- `POST /_redeven_proxy/api/code-runtime/install`
- `POST /_redeven_proxy/api/code-runtime/select`
- `POST /_redeven_proxy/api/code-runtime/default`
- `POST /_redeven_proxy/api/code-runtime/detach`
- `POST /_redeven_proxy/api/code-runtime/remove-version`
- `POST /_redeven_proxy/api/code-runtime/cancel`

The explicit install flow is:

1. Env App reads runtime status.
2. Env App Settings exposes a dedicated `code-server Runtime` management card that shows:
   - the current environment selection,
   - the Local Environment runtime version inventory and Local Environment default,
   - a focused running/error panel for explicit install or Local Environment version removal actions,
   - recent output only while an operation is running or when the last action failed or was cancelled.
3. If the runtime is missing or unusable, Env App Codespaces shows a dedicated install UI instead of trying to start a codespace.
4. After the user explicitly clicks `Install and use for this environment` or `Install latest and use for this environment`, the runtime:
   - downloads the official upstream `install.sh` latest-stable entrypoint,
   - runs it with `--method=standalone --prefix <shared staging prefix>`,
   - validates the staged binary and resolves the upstream `code-server` version,
   - promotes that install into `shared/code-server/<os>-<arch>/versions/<version>/`,
   - selects that version for the current environment,
   - sets the Local Environment default only when one does not already exist.
5. If the resolved latest version is already installed for the Local Environment, Redeven reuses it and only updates the current environment selection instead of running a second install.
6. `POST /detach` removes only the current environment pin. It does not delete any Local Environment runtime files.
7. `POST /remove-version` deletes only one Local Environment runtime version, and only when it is not the Local Environment default and no environment still selects it.
8. Env App shows focused progress while the action is running, then returns to the calm steady state after success. Failed or cancelled actions keep their recent output visible for recovery.

## Runtime status model

`GET /_redeven_proxy/api/code-runtime/status` returns:

- `active_runtime`: the runtime currently selected for Codespaces (`managed`, `system`, `env_override`, or `none`)
- `managed_runtime`: the managed version currently selected for the environment or inherited from the Local Environment default, whether or not it is active
- `environment_selection_version`: the managed version chosen by or inherited into the current environment
- `environment_selection_source`: `environment`, `local_environment_default`, or `none`
- `local_environment_default_version`: the managed version inherited by new environments in this Local Environment
- `shared_runtime_root`: the Local Environment-scoped shared runtime directory
- `installed_versions[]`: every managed version installed for this Local Environment, including selection counts, removability, default status, and health
- `operation`: the current or most recent explicit management operation (`install` / `remove_local_environment_version`) plus stage, error, target version, and log tail

This split exists so Settings can truthfully show managed inventory, environment selection, and active runtime precedence without inferring hidden state on the client.

## code-server binary resolution

Binary resolution order:

1) Environment variables (highest precedence):
   - `REDEVEN_CODE_SERVER_BIN`
   - `CODE_SERVER_BIN`
   - `CODE_SERVER_PATH`
2) The current environment's explicit managed version selection, if present
3) The Local Environment default managed version, if present
4) Common install locations (`~/.local/bin/code-server`, Homebrew paths, `/usr/local/bin`, `/usr/bin`, ...)
5) `PATH` (`exec.LookPath("code-server")`)

The selected binary must be usable on the current host. If an explicit managed selection is missing or unusable, Redeven reports that exact problem and does not silently fall back to host discovery. If no managed selection exists at all, Env App blocks the Codespaces launch path and asks the user to explicitly install the managed runtime.

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
  - Open Env App -> Runtime Settings -> `Codespaces & Tooling` -> `code-server Runtime` and use the explicit install action for the current environment.
  - If you intentionally manage `code-server` yourself, set `REDEVEN_CODE_SERVER_BIN` to a usable binary path.

- "code-server binary is present but unusable":
  - Redeven detected a `code-server` binary, but the runtime probe failed on this host.
  - Reinstall or reselect a usable managed version from Env App -> Runtime Settings -> `Codespaces & Tooling` -> `code-server Runtime`, or point `REDEVEN_CODE_SERVER_BIN` at a usable binary.

- "code-server did not start listening on 127.0.0.1:PORT":
  - Check the per-codespace logs under:
    - `~/.redeven/apps/code/spaces/<code_space_id>/codeserver/stdout.log`
    - `~/.redeven/apps/code/spaces/<code_space_id>/codeserver/stderr.log`
  - Verify `code-server` runs on the host (`code-server --version`).
  - If Homebrew installs `code-server` as a Node.js script, ensure `node` works, or set `REDEVEN_CODE_SERVER_NODE_BIN`.
  - If startup is slow on the host (first launch, heavy extensions, slow disk), increase `REDEVEN_CODE_SERVER_STARTUP_TIMEOUT`.

- Frequent "Extension Host reconnect" loops:
  - Redeven now cleans up stale code-server processes for the same codespace session socket before start/stop.
  - Redeven also removes stale `User/workspaceStorage/*/vscode.lock` files before each start.
  - In Local UI mode, Redeven also shortens extension-host reconnection grace to 30s by default to reduce long-lived stale locks.
  - You can tune this per Local Environment via `REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME`.
  - If reconnect loops persist, inspect `remoteagent.log` and `exthost*/remoteexthost.log` under:
    - `~/.redeven/apps/code/spaces/<code_space_id>/codeserver/user-data/logs/<timestamp>/`

- "Handshake timed out":
  - Ensure the launcher/controller bootstrap can load `/_redeven_boot/`, and the app origin can load `/_redeven_app/` plus `/_redeven_app_sw.js`.
  - Ensure popups are allowed.
  - If you refreshed the codespace window after the bootstrap cleared the URL hash, the page must re-request a fresh `entry_ticket` from its opener (Env App). Reopen the codespace from the Env App if the opener is gone.
  - Ensure the runtime is online and reachable via the configured Flowersec tunnel endpoint.
