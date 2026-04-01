# Desktop Shell

This document describes the public Electron desktop shell that ships with each `redeven` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for endpoint behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse Redeven Local UI instead of introducing a second app runtime.
- Make machine choice explicit on every cold desktop launch.
- Keep launcher, recovery, diagnostics, and This Device configuration aligned around one welcome-first model.

## Architecture

- Electron is a thin shell around Redeven Local UI.
- `redeven run --mode desktop --desktop-managed` remains the only bundled-runtime entrypoint.
- The main BrowserWindow has three shell-owned surfaces:
  - `Welcome launcher`
  - `This Device Options`
  - `Active target`
- Every cold desktop launch opens the welcome launcher first.
- The launcher always asks the user what to open in this desktop session:
  - `This Device`
  - a remembered recent device
  - a newly entered Redeven Local UI URL
- Reopening the launcher from an active session does not immediately disconnect the current target. The current session stays available until the user opens a different device.
- Common startup failures return to the launcher with inline context instead of bouncing users to a separate blocked-first flow.
- Electron only allows navigation to the exact reported Local UI origin and opens all other URLs in the system browser.

## Runtime Contract

Desktop packages always start the bundled binary through `redeven run --mode desktop --desktop-managed`.

The base launch shape is:

```bash
redeven run \
  --mode desktop \
  --desktop-managed \
  --local-ui-bind 127.0.0.1:0 \
  --startup-report-file <temp-path>
```

Desktop may add user-configured startup flags on top of that base command:

- `--local-ui-bind <host:port>`
- `--password-stdin`
- `--controlplane <url>`
- `--env-id <env_public_id>`
- `--env-token-env REDEVEN_DESKTOP_ENV_TOKEN`

Behavior:

- Local UI always starts for `This Device`.
- `--password-stdin` is the non-interactive desktop-managed password transport.
- The Local UI password stays out of process args and environment variables.
- Remote control is enabled only when the local config is already bootstrapped and remote-valid.
- `--desktop-managed` disables CLI self-upgrade semantics; restart remains available.
- `--startup-report-file` lets Electron wait for a structured desktop launch report instead of scraping terminal output.
- On lock conflicts, the runtime first tries to attach to an existing Local UI from the same state directory before reporting a blocked launch outcome.
- Desktop-managed startup settings do not create a separate runtime state directory; `~/.redeven` remains the runtime source of truth.

When the selected target is `Another Device`, Desktop does not start the bundled binary.
Instead it validates and probes the configured Local UI base URL, then opens that exact origin in the shell.

### Launch Outcomes

The launch report distinguishes these outcomes:

- `ready`: the spawned desktop-managed process started Local UI successfully
- `attached`: the desktop shell found an attachable Local UI from the same state directory and reuses it
- `blocked`: another runtime instance owns the same state directory, but Desktop cannot attach to a Local UI from it

The first stable blocked code is:

- `state_dir_locked`

That blocked payload includes lock owner metadata and relevant state paths so Desktop can show actionable diagnostics without guessing from stderr text.

## Welcome Launcher

The welcome launcher is the primary shell-owned UX.

Visual hierarchy:

- page title: `Open a machine`
- primary card: `This Device`
- secondary list: `Recent Devices`
- secondary form: `Connect Another Device`
- support path: `This Device Options`

Interaction rules:

- Cold launch never auto-opens a remembered target.
- Machine choice is always a launcher action, never a side effect of saving settings.
- `This Device` is the primary path and behaves like a workbench-style open action.
- `This Device Options` contains low-level bind, password, and one-shot bootstrap fields.
- Recent remote devices stay one click away after a successful connection.
- Validation errors and startup failures render inline on the launcher.
- The launcher close action means:
  - `Quit` when no device is open yet
  - `Back to current device` when a target is already open

## This Device Options

`This Device Options` is a launcher-owned advanced surface, not a second launcher.

It edits only future startup behavior for `This Device`:

- `local_ui_bind`
- `local_ui_password`
- one-shot bootstrap request:
  - `controlplane_url`
  - `env_id`
  - `env_token`

Rules:

- Saving options only persists configuration.
- Saving options does not switch devices.
- Cancel returns to the current device when one is already open; otherwise it returns to the launcher.
- One-shot bootstrap data is cleared automatically after a fresh successful desktop-managed start consumes it.

## Desktop Preferences

Desktop keeps one persisted preference model for stable `This Device` configuration and recent remote URLs:

- `local_ui_bind`
- `local_ui_password`
- `pending_bootstrap`
- `recent_external_local_ui_urls`

Semantics:

- Desktop does not persist a remembered current target for the next launch.
- The active target is runtime-only desktop session state.
- `local_ui_bind` and `local_ui_password` apply only to future `This Device` opens.
- `recent_external_local_ui_urls` is normalized, de-duplicated, and capped.
- Secrets are stored in Desktop’s local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise the files remain local-only user data owned by the current account.

Launcher-oriented sharing presets intentionally map high-level user intent to the same runtime contract:

- `Private to this device` -> `127.0.0.1:0` with no password
- `Shared on your local network` -> `0.0.0.0:24000` with a password baseline
- `Custom exposure` -> raw bind/password editing

Target validation rules:

- External targets must use an absolute `http://` or `https://` URL.
- The host must be `localhost` or an IP literal.
- The shell normalizes the configured target to the Local UI origin root.

Desktop shell preferences live under the Electron user data directory, not inside the git checkout.

## User Entry Points

- Cold app launch opens the welcome launcher in the main window.
- The native app menu exposes one primary shell action: `Switch Device...`
- Legacy shell entrypoints such as `connect`, `device_chooser`, and `switch_device` route to the same welcome launcher.
- Legacy advanced-settings entrypoints route to `This Device Options`.
- After Local UI opens inside Redeven Desktop, Env App still exposes shell-owned window actions through the desktop browser bridge.
- Env App `Runtime Settings` stays separate from shell-owned device selection and desktop-managed startup state.

## Error Recovery

- Remote target unreachable
  - launcher reloads with the failing URL preserved and an inline remote-device issue
- Desktop-managed startup blocked
  - launcher reloads with a `This Device` issue and diagnostics copy
- Secondary compatibility surfaces such as the blocked page may still exist, but the normal product flow is launcher-first recovery in the main window

## Accessibility Behavior

Desktop-owned HTML pages target the same WCAG 2.2 AA baseline as Env App, but they do so with repository-owned markup instead of shared browser components.

The required contract is:

- Include a skip link and a stable `main` target so keyboard users can bypass window chrome and page preamble.
- Keep launcher validation and surfaced startup issues focusable and announced with alert/live-region semantics.
- Use explicit labels and `aria-describedby` relationships for settings inputs instead of placeholder-only guidance.
- Preserve visible `:focus-visible` treatments on links, buttons, cards, and inputs.
- Respect `prefers-reduced-motion` in page-level CSS.
- Maintain contrast-safe theme tokens when updating desktop palette values.
- Interactive launcher and settings controls must expose a pointer cursor while active.

Desktop-specific outcomes from this implementation:

- The launcher focuses the surfaced issue region when a startup or connection problem is rendered.
- Inline launcher validation errors are focusable and announced immediately.
- The blocked page still focuses its summary alert on load for compatibility.

## Env App Behavior

- Desktop-managed Local UI exposes `desktop_managed`, `effective_run_mode`, and `remote_enabled` through local runtime/version endpoints.
- Env App hides `Update Redeven` in desktop-managed runs.
- Env App keeps `Restart runtime`.
- The maintenance card explains that updates must come from a new desktop release.
- Detached desktop child windows keep using the same Env App runtime, access gate, and Flowersec protocol path; only the shell-owned launcher/options surfaces differ.

## Release Assets

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

## Local Development

Desktop package checks:

```bash
./scripts/check_desktop.sh
```

Node.js `24+` is required for desktop package checks and packaging.

Desktop development and packaging always prepare a deterministic local bundle at:

```bash
desktop/.bundle/<goos>-<goarch>/redeven
```

The standard desktop entrypoints build or refresh that bundle from the current repository automatically:

```bash
cd desktop
npm run start
npm run package -- --mac dmg
```

For release automation, the same preparation script can hydrate the bundle from a prebuilt CLI tarball by setting `REDEVEN_DESKTOP_AGENT_TARBALL`.
