# Desktop Shell

This document describes the public Electron desktop shell that is published together with each `redeven` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for endpoint behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse Redeven Local UI instead of adding a second UI runtime.
- Make machine selection explicit on every cold desktop launch.
- Keep chooser, recovery, and diagnostics in one main-window flow.

## Architecture

- Electron is a thin shell around Redeven Local UI.
- `redeven run --mode desktop --desktop-managed` remains the only bundled-runtime entrypoint.
- The main BrowserWindow has two shell-owned routes:
  - `Startup chooser`
  - `Active target`
- Every cold desktop launch opens the startup chooser first.
- The user explicitly chooses one of:
  - `This device`
  - a remembered recent device
  - a newly entered Redeven Local UI URL
- Reopening the chooser from an active session does not immediately disconnect the current target. The current session stays available until the user confirms a different target.
- Common startup failures return to the chooser with inline context instead of bouncing users to a separate blocked surface.
- Electron only allows navigation to the exact reported Local UI origin (`localhost` / loopback / explicit local IP) and opens all other URLs in the system browser.

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

- Local UI always starts for `This device`.
- Remote control channel is enabled only when the local config is already bootstrapped and remote-valid.
- `--desktop-managed` disables CLI self-upgrade semantics; restart remains available.
- `--startup-report-file` lets Electron wait for a structured desktop launch report instead of scraping terminal output.
- On lock conflicts, the runtime first tries to attach to an existing Local UI from the same state directory before reporting a blocked launch outcome.
- Desktop-managed startup settings do not create a separate runtime state directory; `~/.redeven` remains the runtime source of truth.

When the selected target is `Another device`, Desktop does not start the bundled binary.
Instead it validates and probes the configured Local UI base URL, then opens that exact origin in the shell.

### Launch outcomes

The launch report distinguishes these outcomes:

- `ready`: the spawned desktop-managed process started Local UI successfully
- `attached`: the desktop shell found an attachable Local UI from the same state directory and reuses it
- `blocked`: another runtime instance owns the same state directory, but Desktop cannot attach to a Local UI from it

The first stable blocked code is:

- `state_dir_locked`

That blocked payload includes lock owner metadata and the relevant state paths so Desktop can show actionable diagnostics without guessing from stderr text.

## Startup chooser

The startup chooser is the primary shell-owned UX.

Visual hierarchy:

- page title: `Choose a device`
- hero action: `This device`
- recent devices list
- `Open another device` URL entry
- secondary disclosures:
  - `This device options`
  - `Advanced troubleshooting`

Interaction rules:

- Cold launch never auto-opens the remembered target.
- The remembered target is suggested, not auto-run.
- `This device options` holds sharing presets, raw bind/password editing, and the one-shot Redeven link request.
- `Advanced troubleshooting` holds diagnostics and chooser-first recovery details.
- Validation errors and startup failures render inline on the chooser.

## Desktop shell preferences

Desktop keeps one persisted preference model for remembered selection plus `This device` configuration:

- `target`
  - remembered chooser target for the next desktop launch
  - `managed_local` or `external_local_ui`
- `external_local_ui_url`
  - remembered URL when `target.kind=external_local_ui`
- `recent_external_local_ui_urls`
  - normalized, de-duplicated recent successful external targets
- `local_ui_bind`
  - raw Local UI bind for `This device`
- `local_ui_password`
  - raw Local UI password for `This device`
- `pending_bootstrap`
  - one-shot control plane bootstrap request for the next successful `This device` start

Semantics:

- `target` is a remembered chooser selection, not an auto-connect instruction.
- `local_ui_bind` and `local_ui_password` apply to future desktop-managed starts on this machine.
- `pending_bootstrap` is cleared automatically after a fresh successful desktop-managed start consumes it.
- Secrets are stored in Desktop’s local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise the files remain local-only user data owned by the current account.

Chooser presets intentionally map high-level user intent to the same runtime contract:

- `Only this device` -> `127.0.0.1:0` with no password
- `Local network` -> `0.0.0.0:24000` with a required password baseline
- `Custom` -> raw bind/password editing

Target validation rules:

- External targets must use an absolute `http://` or `https://` URL.
- The host must be `localhost` or an IP literal.
- The shell normalizes the configured target to the Local UI origin root.

Desktop shell preferences live under the Electron user data directory, not inside the git checkout.

## User entry points

- Cold app launch opens the startup chooser in the main window.
- The native app menu exposes one primary shell action: `Switch Device...`
- Legacy advanced-settings entrypoints route into the same chooser with `This device options` / troubleshooting disclosures expanded.
- After Local UI opens inside Redeven Desktop, Env App also exposes a shell-owned `Switch Device...` command through the Desktop browser bridge.
- Env App `Runtime Settings` stays separate from shell-owned startup/device-selection state.

## Error recovery

- Remote target unreachable
  - chooser reloads with the failing URL preserved and an inline error callout
- Desktop-managed startup blocked
  - chooser reloads with a `This device` issue and diagnostics in the troubleshooting disclosure
- Secondary fallback surfaces such as the blocked page remain compatibility helpers, but the normal product flow is chooser-first recovery in the main window

## Accessibility behavior

Desktop-owned HTML pages target the same WCAG 2.2 AA baseline as Env App, but they do so with repository-owned markup instead of shared browser components.

The required contract is:

- Include a skip link and a stable `main` target so keyboard users can bypass the window chrome and page preamble.
- Keep chooser validation and startup-failure summaries focusable and announced with alert/live-region semantics.
- Use explicit labels, `fieldset` / `legend`, and `aria-describedby` relationships for settings inputs instead of placeholder-only guidance.
- Preserve visible `:focus-visible` treatments on links, buttons, radio cards, disclosures, and inputs.
- Respect `prefers-reduced-motion` in page-level CSS.
- Maintain contrast-safe theme tokens when updating desktop palette values.

Desktop-specific outcomes from this implementation:

- The chooser focuses the surfaced validation or startup issue region on initial render.
- The fallback blocked page focuses its summary alert on load so the reason and next action are announced immediately.
- Interactive chooser controls expose a pointer cursor while active.

## Env App behavior

- Desktop-managed Local UI exposes `desktop_managed`, `effective_run_mode`, and `remote_enabled` through the local runtime/version endpoints.
- Env App hides `Update Redeven` in desktop-managed runs.
- Env App keeps `Restart runtime`.
- The maintenance card explains that updates must come from a new desktop release.
- Detached desktop child windows keep using the same Env App runtime, access gate, and Flowersec protocol path; only the scene rendered inside the window changes.

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
