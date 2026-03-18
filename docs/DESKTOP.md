# Desktop Shell

This document describes the public Electron desktop shell that is published together with each `redeven-agent` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for agent behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse the existing Local UI over the configured local HTTP bind instead of adding a second UI runtime.

## Architecture

- Electron is a thin shell.
- `redeven run --mode desktop --desktop-managed` remains the only runtime entrypoint.
- Desktop-owned startup settings are stored separately from agent runtime state, so the shell can control launch arguments without introducing a second runtime.
- The desktop shell waits for a machine-readable desktop launch report file from `redeven`.
- If a compatible Local UI instance is already running from the same default state directory, the desktop shell reuses that reported Local UI URL instead of failing on the agent lock.
- If the default state directory is locked by another agent without an attachable Local UI, the desktop shell stays open and renders a blocked page instead of crashing with raw stderr.
- Electron only allows navigation to the exact reported Local UI origin (`localhost` / loopback / explicit local IP) and opens all other URLs in the system browser.
- Desktop exposes a native Settings window and explicit quit accelerators (`CommandOrControl+,`, `CommandOrControl+Q`).

## Runtime contract

Desktop packages always start the bundled binary through `redeven run --mode desktop --desktop-managed`.

The default launch shape is:

```bash
redeven run \
  --mode desktop \
  --desktop-managed \
  --local-ui-bind 127.0.0.1:0 \
  --startup-report-file <temp-path>
```

Desktop may add user-configured startup flags on top of that base command:

- `--local-ui-bind <host:port>`
- `--password-env REDEVEN_DESKTOP_LOCAL_UI_PASSWORD`
- `--controlplane <url>`
- `--env-id <env_public_id>`
- `--env-token-env REDEVEN_DESKTOP_ENV_TOKEN`

Behavior:

- Local UI always starts.
- Remote control channel is enabled only when the local config is already bootstrapped and remote-valid.
- `--desktop-managed` disables CLI self-upgrade semantics; restart remains available.
- `--startup-report-file` lets Electron wait for a structured desktop launch report instead of scraping terminal output.
- On lock conflicts, the runtime first tries to attach to an existing Local UI from the same state directory before reporting a blocked launch outcome.
- Desktop-managed startup settings do not create a separate agent state directory; `~/.redeven` remains the runtime source of truth.

### Launch outcomes

The launch report distinguishes these outcomes:

- `ready`: the spawned desktop-managed process started Local UI successfully
- `attached`: the desktop shell found an attachable Local UI from the same state directory and reuses it
- `blocked`: another agent owns the same state directory, but Desktop cannot attach to a Local UI from it

The first stable blocked code is:

- `state_dir_locked`

That blocked payload includes lock owner metadata and the relevant state paths so Desktop can show actionable diagnostics without guessing from stderr text.

## Desktop settings

Desktop owns a small native settings model for launch-time configuration:

- Persistent settings:
  - `local_ui_bind`
  - `local_ui_password`
- One-shot bootstrap settings:
  - `controlplane_url`
  - `env_id`
  - `env_token`

Semantics:

- The Local UI bind and password apply to every future desktop-managed start.
- The bootstrap triple is treated as a one-shot “register to Redeven on next successful start” request.
- After a spawned desktop-managed start succeeds, Desktop clears the pending bootstrap request automatically so an expired environment token is not retried on every future launch.
- Secrets are stored in Desktop’s local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise the files remain local-only user data owned by the current account.

Desktop settings live under the Electron user data directory, not inside the git checkout.

## Env App behavior

- Desktop-managed Local UI exposes `desktop_managed`, `effective_run_mode`, and `remote_enabled` through the local runtime/version endpoints.
- Env App hides `Update agent` in desktop-managed runs.
- Env App keeps `Restart agent`.
- The maintenance card explains that updates must come from a new desktop release.

## Release assets

Each public `vX.Y.Z` release includes:

- `redeven_linux_amd64.tar.gz`
- `redeven_linux_arm64.tar.gz`
- `redeven_darwin_amd64.tar.gz`
- `redeven_darwin_arm64.tar.gz`
- `Redeven-Desktop-X.Y.Z-linux-x64.deb`
- `Redeven-Desktop-X.Y.Z-linux-x64.rpm`
- `Redeven-Desktop-X.Y.Z-linux-arm64.deb`
- `Redeven-Desktop-X.Y.Z-linux-arm64.rpm`
- `Redeven-Desktop-X.Y.Z-mac-x64.dmg`
- `Redeven-Desktop-X.Y.Z-mac-arm64.dmg`

Windows is intentionally out of scope for this repository.

## Local development

Desktop package checks:

```bash
./scripts/check_desktop.sh
```

Node.js `24+` is required for desktop package checks and packaging.

Unpackaged Electron runs can point to a local agent binary with:

```bash
cd desktop
REDEVEN_DESKTOP_AGENT_BINARY=../redeven npm run start
```

If another `redeven` process already holds `~/.redeven/agent.lock`, Desktop now behaves as follows:

- If that process exposes a compatible Local UI, Desktop attaches automatically.
- If that process does not expose Local UI (for example a `remote`-only run), Desktop shows a blocked page with `Retry`, `Settings`, `Copy diagnostics`, and `Quit`.

Desktop shortcuts:

- `CommandOrControl+,` opens the native Settings window.
- `CommandOrControl+Q` asks for confirmation before quitting the desktop app.

## macOS distribution

- Local ad-hoc builds (`REDEVEN_DESKTOP_MAC_IDENTITY=-`) are for development only.
- Public macOS release artifacts must be signed with a `Developer ID Application` certificate and notarized with Apple before they are uploaded to GitHub Release.
- The release workflow now requires the following repository secrets for macOS jobs:
  - `REDEVEN_DESKTOP_MAC_CERT_BASE64`
  - `REDEVEN_DESKTOP_MAC_CERT_PASSWORD`
  - `REDEVEN_DESKTOP_MAC_IDENTITY`
  - `REDEVEN_DESKTOP_MAC_NOTARY_API_KEY`
  - `REDEVEN_DESKTOP_MAC_NOTARY_API_KEY_ID`
  - `REDEVEN_DESKTOP_MAC_NOTARY_API_ISSUER`

## code-server scope

The desktop package does not bundle `code-server`.
It keeps the same external `code-server` dependency model that the CLI/runtime already uses.
