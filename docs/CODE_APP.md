# Code App (code-server over Flowersec E2EE)

This document describes the **Code App** implementation in the Redeven agent:

- `floe_app = com.floegence.redeven.code`
- Browser ↔ Agent traffic is end-to-end encrypted (E2EE) via **Flowersec tunnel**
- The browser talks to the agent using `flowersec-proxy/http1` and `flowersec-proxy/ws`

## What runs where

- Browser side:
  - A runtime-mode proxy is created in the top-level sandbox window.
  - A Service Worker forwards `fetch()` to the runtime via `postMessage + MessageChannel`.
  - An injected script patches same-origin `WebSocket` so it also goes through `flowersec-proxy/ws`.

- Agent side:
  - The agent starts one `code-server` process per `code_space_id` (localhost only).
  - The agent hosts a local gateway on `127.0.0.1`:
    - Serves `/_redeven_proxy/inject.js`
    - Proxies everything else to the correct `code-server` instance
  - The Flowersec server endpoint handlers (`flowersec-proxy/http1`, `flowersec-proxy/ws`) are registered with a **fixed upstream**: the local gateway.

## Local data directory

The Code App stores all code space data on the user's machine (not in control plane).

By default, the agent config is `~/.redeven/config.json`, so the state directory is:

- `state_dir = ~/.redeven/`

Code App data:

```
~/.redeven/
  config.json
  apps/
    code/
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

## code-server binary resolution

The agent does **not** bundle code-server. It expects code-server to be installed locally.

Binary resolution order:

1) Environment variables (highest precedence):
   - `REDEVEN_CODE_SERVER_BIN`
   - `CODE_SERVER_BIN`
   - `CODE_SERVER_PATH`
2) Common install locations (`~/.local/bin/code-server`, Homebrew paths, `/usr/local/bin`, `/usr/bin`, ...)
3) `PATH` (`exec.LookPath("code-server")`)

If code-server cannot be found, Code App sessions will fail with an error.

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
  - Install code-server on your machine or set `REDEVEN_CODE_SERVER_BIN` to an absolute path.

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
  - Ensure the sandbox subdomain can load `/_redeven_boot/` and `/_redeven_sw.js`.
  - Ensure popups are allowed.
  - If you refreshed the codespace window after the bootstrap cleared the URL hash, the page must re-request a fresh `entry_ticket` from its opener (Env App). Reopen the codespace from the Env App if the opener is gone.
  - Ensure the agent is online and reachable via the Flowersec tunnel.
