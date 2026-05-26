# Browser Editor (code-server over Flowersec E2EE)

This document describes the **Browser Editor** implementation in the Redeven runtime:

- `floe_app = com.floegence.redeven.code`
- Browser ↔ Runtime traffic is end-to-end encrypted (E2EE) via **Flowersec tunnel**
- The browser talks to the runtime using `flowersec-proxy/http1` and `flowersec-proxy/ws`

## Tunnel endpoint semantics

- The `tunnel_url` surfaced in grants, active-session views, and audit logs is a routing endpoint, not an authorization boundary.
- Session isolation and blocking decisions are enforced by signed session metadata and tunnel-side policy checks (for example `(aud, iss)` tenant selection and channel binding).
- Different environments can validly use the same tunnel endpoint URL while still remaining isolated by policy.

## What runs where

- Browser side:
  - A trusted launcher origin exchanges a short-lived bootstrap credential for a runtime connection artifact, and Flowersec uses the embedded tunnel grant to establish the runtime session.
  - The browser then navigates to an isolated runtime origin that owns the real Flowersec proxy runtime.
  - The runtime origin loads the actual app in an untrusted app iframe, so the app is not same-origin with the runtime window.
  - An app-origin Service Worker forwards `fetch()` through a cross-origin bridge to the runtime.
  - The injected script patches same-origin `WebSocket` so it also goes through `flowersec-proxy/ws`, but it now uses `registerCodeAppProxyBridge()` instead of reading `window.top.__flowersecProxyRuntime`.
  - In Redeven Desktop, Env App requests the desktop shell to open browser editor sessions in the system browser, but the browser-facing bootstrap contract stays the same: the first load still starts from the trusted launcher with a short-lived bootstrap credential.
  - For desktop-managed Local UI with an access password, the first protected `http://127.0.0.1:23998/cs/<code_space_id>/...` request can arrive with only `redeven_access_resume`. Local UI exchanges that resume token into the normal `redeven_local_access` cookie before returning the page so code-server subresources can continue on the standard same-origin session path.

- Runtime side:
  - The runtime starts one `code-server` process per `code_space_id` (localhost only).
  - The runtime hosts a local gateway on `127.0.0.1`:
    - Serves `/_redeven_proxy/inject.js`
    - Proxies everything else to the correct `code-server` instance
  - The Flowersec server endpoint handlers (`flowersec-proxy/http1`, `flowersec-proxy/ws`) are registered with a **fixed upstream**: the local gateway.

## Local data directory

The browser editor stores all code space data in the endpoint runtime state, not on Redeven servers.

By default, the Local Environment config is `~/.redeven/local-environment/config.json`, so the state directory is:

- `state_dir = ~/.redeven/local-environment/`
- `state_root = ~/.redeven/`

Browser editor code space data:

```
~/.redeven/
  local-environment/
    config.json
    apps/
      code/
        runtime/
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

Shared managed browser editor runtime data:

```
~/.redeven/
  shared/
    code-server/
      <os>-<arch>/
        local-environment.json
        lock
        downloads/
          uploads/
            <upload_id>.json
            <upload_id>.part
        staging/
          <operation_id>/
        versions/
          <version>/
            bin/code-server
            lib/code-server-<upstream_release>/
```

Deleting a browser editor workspace via the Env App removes:

- `apps/code/spaces/<code_space_id>/` (entire directory)

It does **not** delete the user's `workspace_path` directory.

## Managed browser editor engine

The runtime does **not** bundle code-server into the base CLI/Desktop installer.
Instead, the browser editor uses a managed engine that is set up or updated only after an explicit user action inside Env App.
The managed browser editor engine currently uses upstream `code-server` release tarballs.
Redeven Desktop does not query GitHub Releases from the user's network during setup.
It reads Redeven's Browser Editor Catalog, which is published by private operations after the upstream release assets have been mirrored and verified.

Rules:

- Redeven never sets up the browser editor engine on page load or merely because Env App connected.
- The first `Open`, `Start`, `Set up browser editor`, or `Update browser editor` action asks the user to confirm before Desktop prepares the latest browser editor package for the connected environment.
- After confirmation, Desktop resolves the latest package from Redeven's Browser Editor Catalog, downloads the matching mirrored package on the user's machine, caches only that latest package for each platform, and sends that package to the connected environment.
- Setting up a managed version stores it once under the shared runtime root.
- The current endpoint stores one managed runtime selection in `shared/code-server/<os>-<arch>/local-environment.json`.
- The user-facing actions are `Set up browser editor`, `Update browser editor`, `Open`, and `Start`.
- The runtime accepts a Desktop-generated artifact manifest plus package bytes, then verifies, extracts, probes, promotes, and selects the version.
- Official `code-server` tarballs may contain internal relative symlinks. Redeven allows those symlinks only when they resolve within the extracted package root, and continues to reject hard links, special archive entries, or links that escape that root.
- The `apps/code/runtime/managed` path is only a symlink to the selected shared version.
- No user shell commands or PATH edits are required for the managed runtime.
- Redeven Desktop reads the Browser Editor Catalog only when the user explicitly starts setup or update. It does not refresh Browser Editor package metadata in the background.
- If the selected managed version is missing or unusable, Redeven reports the problem directly and does **not** silently fall back to another managed or host runtime.

Managed runtime precedence remains:

1. `REDEVEN_CODE_SERVER_BIN`
2. `CODE_SERVER_BIN`
3. `CODE_SERVER_PATH`
4. current endpoint managed selection
5. host runtime discovery

## Runtime status and preparation API

Env App uses the local gateway runtime endpoints before it tries to start the browser editor:

- `GET /_redeven_proxy/api/code-runtime/status`
- `POST /_redeven_proxy/api/code-runtime/import-sessions`
- `PUT /_redeven_proxy/api/code-runtime/import-sessions/<upload_id>/chunks/<chunk_index>`
- `POST /_redeven_proxy/api/code-runtime/import-sessions/<upload_id>/complete`
- `POST /_redeven_proxy/api/code-runtime/select`
- `POST /_redeven_proxy/api/code-runtime/remove-version`
- `POST /_redeven_proxy/api/code-runtime/cancel`

The explicit preparation flow is:

1. Env App reads runtime status.
2. If the browser editor engine is missing or unusable, Env App blocks startup and starts setup only after the user's explicit `Open`, `Start`, `Set up browser editor`, or `Update browser editor` action.
3. Desktop resolves the latest matching Browser Editor package from Redeven's Browser Editor Catalog and uses the local package cache only when it already has that latest package.
4. Desktop uploads the package either through runtime-control direct upload or through the Env App session-mediated import-session path.
5. Runtime validates the manifest, size, checksum, platform, archive layout, safe internal symlinks, and staged binary, then promotes it to `shared/code-server/<os>-<arch>/versions/<version>/` and selects it for the current endpoint.
6. Existing usable versions are reused instead of reinstalled; `POST /remove-version` deletes only a non-selected managed version.
7. Running, failed, or cancelled operations keep focused status and recent output visible in the Browser Editor setup activity panel so the user can recover explicitly.

## Browser Editor Catalog

Redeven's Browser Editor Catalog is the product runtime dependency for managed Browser Editor setup.
The upstream `coder/code-server` release remains the supply source, but Desktop consumes the Redeven-published catalog and mirrored package URLs instead of calling GitHub's `releases/latest` API during user setup.

Catalog endpoints:

```text
https://version.agent.redeven.com/v1/browser-editor/code-server/latest.json
```

The catalog contains:

- `schema_version`: catalog format version.
- `engine`: currently `code-server`.
- `source`: upstream release provenance.
- `latest`: the release tag and version selected by Redeven private ops.
- `platforms`: platform-keyed package entries with mirrored download URL, sha256, size, archive compression, and root directory hint.
- `mirror_complete`: must be `true` before Desktop accepts the catalog.

Desktop setup uses this catalog as follows:

```text
User confirms setup/update
  |
  v
Desktop fetches latest.json
  |
  v
Desktop selects status.platform.platform_id
  |
  v
Desktop downloads the mirrored package
  |
  v
Desktop caches only the latest package for that platform
  |
  v
Desktop uploads the package to the connected environment
```

There is intentionally no GitHub fallback in Desktop.
If the catalog is unavailable or malformed, setup fails in the inline Browser Editor setup activity and waits for the user to retry.
This keeps GitHub API rate limits, upstream release instability, and mirror publication failures inside Redeven's private operations boundary rather than exposing them as user-side setup dependencies.

## Setup activity and failure ownership

Browser Editor setup has a single primary progress surface: the inline setup activity panel in the Browser Editor page, with the same operation details also visible from Runtime Settings -> `Browser Editor`.
Toast notifications may announce that attention is needed, but they are only supplementary.
They must not be the only place where setup progress, blocking failures, or retry context appears.

The activity panel stays visible while setup is running and after setup fails or is cancelled.
It should show the pending user intent (`Open` or `Start` when setup was triggered from a codespace action), the current stage, the shared engine root, the selected editor path when known, the last error, and the runtime log tail.
The user can refresh, cancel an active setup, retry a failed setup, or dismiss a completed/non-blocking panel.

Failures from both halves of the setup path belong in this activity model:

- Desktop-side preparation failures:
  - Browser Editor Catalog lookup timeouts, HTTP failures, malformed catalog metadata, incomplete mirror state, or missing platform assets
  - package download, cache read/write, checksum, or cache-pruning failures on the user's machine
  - direct Desktop-to-runtime upload failures before the runtime can finish importing the package
- Runtime-side import and verification failures:
  - import-session creation, chunk receive, size, or checksum mismatches
  - manifest, platform, archive layout, unsafe archive link, extraction, binary probe, validation, promotion, or selection failures

For runtime-side failures, `GET /_redeven_proxy/api/code-runtime/status` carries the authoritative `operation` state (`stage`, `last_error`, `last_error_code`, `target_version`, and `log_tail`).
For Desktop-side failures that happen before the runtime can record a terminal operation state, Env App must still keep the Browser Editor setup activity open and render the failure there after refreshing runtime status.
Retry starts a new explicit setup/update request; Redeven does not silently continue or auto-retry a failed setup in the background.

Upload limits:

- Default chunk size: 8 MiB.
- Maximum package size: 256 MiB.

## Runtime status model

`GET /_redeven_proxy/api/code-runtime/status` returns:

- `active_runtime`: the runtime currently selected for the browser editor (`managed`, `system`, `env_override`, or `none`)
- `managed_runtime`: the managed version currently selected for this endpoint, whether or not it is active
- `managed_prefix`: the selected managed runtime install prefix, when available
- `managed_runtime_version`: the managed version selected by this endpoint
- `managed_runtime_source`: `managed` or `none`
- `shared_runtime_root`: the shared runtime directory
- `installed_versions[]`: every managed version installed for this endpoint, including current selection, removability, and health
- `platform`: the target platform descriptor Desktop uses to choose the matching latest package
- `operation`: the current or most recent explicit management operation (`prepare_workspace_engine` / `remove_local_environment_version`) plus stage, error, target version, and log tail
- `updated_at_unix_ms`: the runtime-status snapshot timestamp

This split exists so Settings can truthfully show managed inventory, the current endpoint selection, and active runtime precedence without inferring hidden state on the client.

## code-server binary resolution

Binary resolution order:

1) Environment variables (highest precedence):
   - `REDEVEN_CODE_SERVER_BIN`
   - `CODE_SERVER_BIN`
   - `CODE_SERVER_PATH`
2) The current endpoint managed version selection, if present
3) Common install locations (`~/.local/bin/code-server`, Homebrew paths, `/usr/local/bin`, `/usr/bin`, ...)
4) `PATH` (`exec.LookPath("code-server")`)

The selected binary must be usable on the current host. If the managed selection is missing or unusable, Redeven reports that exact problem and does not silently fall back to host discovery. If no managed selection exists at all, Env App blocks the browser editor launch path and asks the user to explicitly set up the browser editor.

### Note for macOS/Homebrew

Homebrew installs `code-server` as a **Node.js script** with a hardcoded shebang that points to a specific Homebrew node binary.

To make the runtime more robust, the browser editor detects a Node.js shebang and executes:

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

For MVP, the runtime requires **all three** permissions before serving browser editor sessions:

- `read`
- `write`
- `execute`

This is conservative: code-server is not designed to enforce a partial permission model at the proxy layer.

Browser editor workspace paths are resolved through the same runtime `filesystem_scope` registry used by Files, Git, Terminal, and Flower tools. `agent_home_dir` remains the default starting point, but workspace paths are not implicitly Home-only; a workspace may target any authorized root that passes the runtime path checks. The browser editor still requires `read + write + execute` because code-server itself is not a root-aware permission sandbox.

## Troubleshooting

- "Missing init payload" in the bootstrap page:
  - Open the browser editor from the Redeven Env App. Do not open the sandbox subdomain directly.

- "code-server binary not found":
  - Open Env App -> Runtime Settings -> `Browser Editor` and use `Set up browser editor`.
  - If you intentionally manage `code-server` yourself, set `REDEVEN_CODE_SERVER_BIN` to a usable binary path.

- "code-server binary is present but unusable":
  - Redeven detected a `code-server` binary, but the runtime probe failed on this host.
  - Update or reselect a usable managed version from Env App -> Runtime Settings -> `Browser Editor`, or point `REDEVEN_CODE_SERVER_BIN` at a usable binary.

- "code-server did not start listening on 127.0.0.1:PORT":
  - Check the per-codespace logs under:
    - `~/.redeven/local-environment/apps/code/spaces/<code_space_id>/codeserver/stdout.log`
    - `~/.redeven/local-environment/apps/code/spaces/<code_space_id>/codeserver/stderr.log`
  - Verify `code-server` runs on the host (`code-server --version`).
  - If Homebrew installs `code-server` as a Node.js script, ensure `node` works, or set `REDEVEN_CODE_SERVER_NODE_BIN`.
  - If startup is slow on the host (first launch, heavy extensions, slow disk), increase `REDEVEN_CODE_SERVER_STARTUP_TIMEOUT`.

- Frequent "Extension Host reconnect" loops:
  - Redeven now cleans up stale code-server processes for the same codespace session socket before start/stop.
  - Redeven also removes stale `User/workspaceStorage/*/vscode.lock` files before each start.
  - In Local UI mode, Redeven also shortens extension-host reconnection grace to 30s by default to reduce long-lived stale locks.
  - You can tune this per Local Environment via `REDEVEN_CODE_SERVER_RECONNECTION_GRACE_TIME`.
  - If reconnect loops persist, inspect `remoteagent.log` and `exthost*/remoteexthost.log` under:
    - `~/.redeven/local-environment/apps/code/spaces/<code_space_id>/codeserver/user-data/logs/<timestamp>/`

- "Handshake timed out":
  - Ensure the launcher/runtime bootstrap can load the configured Redeven bootstrap routes.
  - Ensure popups are allowed.
  - If you refreshed the codespace window after the bootstrap cleared the URL hash, the page must re-request a fresh bootstrap credential from its opener (Env App). Reopen the codespace from the Env App if the opener is gone.
  - Ensure the runtime is online and reachable via the configured Flowersec tunnel endpoint.
