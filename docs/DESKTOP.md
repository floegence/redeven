# Desktop Shell

This document describes the public Electron desktop shell that is published together with each `redeven-agent` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for agent behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse the existing Local UI over the configured local HTTP bind instead of adding a second UI runtime.
- Treat `Redeven Local UI endpoint` as the single host/connect contract for both `redeven agent` and `Redeven Desktop`.

## Architecture

- Electron is a thin shell.
- `redeven run --mode desktop --desktop-managed` remains the only runtime entrypoint.
- Desktop-owned startup settings are stored separately from agent runtime state, so the shell can control launch arguments without introducing a second runtime.
- Desktop can either:
  - target `This device` and use the bundled runtime flow
  - target `External Redeven` and open another machine's Local UI directly
- The desktop shell waits for a machine-readable desktop launch report file from `redeven`.
- If a compatible Local UI instance is already running from the same default state directory, the desktop shell reuses that reported Local UI URL instead of failing on the agent lock.
- If the default state directory is locked by another agent without an attachable Local UI, the desktop shell stays open and renders a blocked page instead of crashing with raw stderr.
- Electron only allows navigation to the exact reported Local UI origin (`localhost` / loopback / explicit local IP) and opens all other URLs in the system browser.
- Desktop exposes:
  - a native `Connect to Redeven...` menu entry for target selection
  - a native `Desktop Settings...` window for shell-owned startup configuration
  - explicit quit accelerators (`CommandOrControl+,`, `CommandOrControl+Q`)

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
- Desktop-managed inline bootstrap keeps the default logging baseline at `info` instead of inheriting a stale `debug` level implicitly.
- On lock conflicts, the runtime first tries to attach to an existing Local UI from the same state directory before reporting a blocked launch outcome.
- Desktop-managed startup settings do not create a separate agent state directory; `~/.redeven` remains the runtime source of truth.

When the desktop target is `External Redeven`, Desktop does not start the bundled binary.
Instead it validates and probes the configured Local UI base URL, then opens that exact origin in the shell.

The ready/attached startup payload also carries:

- `state_dir`: the runtime state directory used by the current agent instance
- `diagnostics_enabled`: whether the agent debug-console runtime collector is active for this launch

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

- Persistent target settings:
  - `desktop_target_kind`
  - `external_local_ui_url`
- Persistent settings:
  - `local_ui_bind`
  - `local_ui_password`
- One-shot bootstrap settings:
  - `controlplane_url`
  - `env_id`
  - `env_token`

Semantics:

- `desktop_target_kind` chooses whether Desktop opens this machine or another Redeven Local UI endpoint.
- `external_local_ui_url` stores the last explicit external target URL and is only active when `desktop_target_kind=external_local_ui`.
- The Local UI bind and password apply to every future desktop-managed start.
- The bootstrap triple is treated as a one-shot “register to Redeven on next successful start” request.
- After a spawned desktop-managed start succeeds, Desktop clears the pending bootstrap request automatically so an expired environment token is not retried on every future launch.
- Secrets are stored in Desktop’s local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise the files remain local-only user data owned by the current account.

Target validation rules:

- External targets must use an absolute `http://` or `https://` URL.
- The host must be `localhost` or an IP literal.
- The shell normalizes the configured target to the Local UI origin root.
- Desktop does not implement a separate desktop-to-desktop protocol; it reuses the same Local UI contract that Env App already uses.

Desktop settings live under the Electron user data directory, not inside the git checkout.

## User entry points

- `Connect to Redeven...` from the native app menu opens the target selection flow.
- `Desktop Settings...` opens the desktop startup/settings window.
- Desktop intentionally keeps connection targeting separate from `Desktop Settings...` so shell-owned startup state does not collide with Env App `Agent Settings`.
- The blocked page routes to either `Connect to Redeven` or `Desktop Settings` depending on whether the failure is about the selected target or the local desktop-managed startup state.

## Accessibility behavior

Desktop-owned HTML pages target the same WCAG 2.2 AA baseline as Env App, but they do so with repository-owned markup instead of shared browser components.

The required contract for `settingsPage.ts` and `blockedPage.ts` is:

- Include a skip link and a stable `main` target so keyboard users can bypass the window chrome and page preamble.
- Keep validation and blocked-state summaries focusable and announced with appropriate alert/live-region semantics.
- Use explicit labels, `fieldset` / `legend`, and `aria-describedby` relationships for settings forms instead of placeholder-only guidance.
- Preserve visible `:focus-visible` treatments on links, buttons, radio cards, and inputs.
- Respect `prefers-reduced-motion` in page-level CSS.
- Maintain contrast-safe theme tokens when updating desktop palette values.

Desktop-specific outcomes from this implementation:

- The Desktop Settings / Connect page focuses the surfaced error region on validation failure or initial error rendering.
- The blocked page focuses its summary alert on load so the reason and next action are announced immediately.
- The blocked action row is exposed as a labeled navigation landmark.

## Env App behavior

- Desktop-managed Local UI exposes `desktop_managed`, `effective_run_mode`, and `remote_enabled` through the local runtime/version endpoints.
- Env App hides `Update agent` in desktop-managed runs.
- Env App keeps `Restart agent`.
- The maintenance card explains that updates must come from a new desktop release.
- Desktop-managed Env App windows can reopen selected serialized surfaces as dedicated BrowserWindow instances instead of in-page overlays. The first detached surfaces are `File Preview` and the AI page `File Browser`, both reconstructed from query-driven scene state while keeping the same Local UI + Flowersec session contract.
- Desktop records Chromium-side request diagnostics into `<state_dir>/diagnostics/desktop-events.jsonl` while attached to a Local UI runtime that exposes diagnostics.
- Desktop follows the runtime diagnostics state from the `X-Redeven-Debug-Console-Enabled` response header.
- Desktop skips self-observation for the diagnostics API itself so the floating debug console reflects application traffic rather than its own refresh/export requests.

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

If another `redeven` process already holds `~/.redeven/agent.lock`, Desktop now behaves as follows:

- If that process exposes a compatible Local UI, Desktop attaches automatically.
- If that process does not expose Local UI (for example a `remote`-only run), Desktop shows a blocked page with `Retry`, `Desktop Settings`, `Copy diagnostics`, and `Quit`.

Desktop can also open another machine directly:

- Open `Connect to Redeven...` from the app menu.
- Select `External Redeven`.
- Enter the target Local UI base URL, for example `http://192.168.1.11:24000/`.
- If that target uses a Local UI password, Env App will ask for it after the page loads.
- To expose this machine for another Desktop instance, switch the local host bind to an explicit reachable address such as `0.0.0.0:24000` and set a Local UI password.

Desktop shortcuts:

- `Connect to Redeven...` is available from the native app menu.
- `CommandOrControl+,` opens `Desktop Settings...`.
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
It keeps the same managed-runtime model that the CLI/runtime uses:

- the base Desktop installer does not ship `code-server`,
- Codespaces can explicitly install a managed `code-server` runtime later from Env App,
- Redeven never auto-installs it on behalf of the user.
