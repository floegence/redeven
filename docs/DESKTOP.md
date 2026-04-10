# Desktop Shell

This document describes the public Electron desktop shell that ships with each `redeven` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for endpoint behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse Redeven Local UI instead of introducing a second app runtime.
- Let Desktop bootstrap a remote Redeven runtime over SSH without requiring a manual preinstall on the target machine.
- Make environment choice explicit on every cold desktop launch.
- Keep launcher, recovery, diagnostics, and Local Environment configuration aligned around a launcher-window plus session-window model.

## Architecture

- Electron is a thin shell around Redeven Local UI.
- `redeven run --mode desktop --desktop-managed` remains the only bundled-runtime entrypoint.
- Desktop keeps one singleton shell-owned utility window:
  - `Connect Environment` launcher
- `Local Environment Settings` renders as a launcher-owned modal dialog instead of a second native window.
- Each opened Environment owns its own top-level session window, plus any detached child windows it spawns.
- Detached child windows are session-scoped tools rather than global shell utilities. File preview and Debug Console are current examples.
- Session deduplication happens in Electron main through a canonical session key:
  - `managed_local` for the desktop-managed Local Environment
  - `url:<normalized-local-ui-origin>` for remote Local UI targets
  - `ssh:<normalized-ssh-identity>` for SSH-bootstrap targets
  - `cp:<encoded-provider-origin>:env:<env_public_id>` for Control Plane environments
- The shell keeps `Top Bar`, `Activity Bar`, and `Bottom Bar` visible before an environment is opened, so startup and active-session flows share the same frame.
- Every cold desktop launch opens the welcome launcher first.
- The launcher always asks the user what to open in this desktop session:
  - `Local Environment`
  - a remembered recent Environment
  - a newly entered Redeven Local UI URL
  - a newly entered SSH target that Desktop bootstraps on demand
  - a saved compatible `Control Plane`
- Reopening the launcher from an active session does not disconnect anything. Existing Environment windows stay live until the user closes those specific session windows.
- Common startup failures return to the launcher with inline context instead of bouncing users to a separate blocked-first flow.
- Electron only allows session-owned navigation to the exact reported Local UI origin for that session and opens all other URLs in the system browser.
- Control Plane providers use one fixed public protocol surface (`RCPP v1`). Desktop does not negotiate capability matrices with providers.

## Runtime Contract

Desktop packages always start the bundled binary through `redeven run --mode desktop --desktop-managed`.

The base launch shape is:

```bash
redeven run \
  --mode desktop \
  --desktop-managed \
  --config-path <absolute-config-path> \
  --local-ui-bind localhost:23998 \
  --startup-report-file <temp-path>
```

Desktop may add user-configured startup flags on top of that base command:

- `--local-ui-bind <host:port>`
- `--config-path <absolute-config-path>`
- `--password-stdin`
- `--controlplane <url>`
- `--env-id <env_public_id>`
- `--env-token-env REDEVEN_DESKTOP_ENV_TOKEN`
- `--bootstrap-ticket-env REDEVEN_DESKTOP_BOOTSTRAP_TICKET`

Behavior:

- Local UI always starts for `Local Environment`.
- `--password-stdin` is the non-interactive desktop-managed password transport.
- Desktop resolves the managed config path before spawn and passes it explicitly to `redeven run`.
- `Local Environment` uses the global managed config at `~/.redeven/config.json`.
- Desktop startup flows that include a bootstrap target use the matching isolated config at `~/.redeven/envs/<env_public_id>/config.json`.
- Desktop attach probing reads `runtime/local-ui.json` from the same resolved state root as the spawned config path.
- The Local UI password stays out of process args and environment variables.
- The one-time bootstrap ticket also stays out of process args and is passed only through a desktop-owned environment variable.
- Desktop startup reports and attachable runtime state include a non-secret `password_required` boolean so launcher and attach flows can describe whether the current runtime is protected.
- Remote control is enabled only when the local config is already bootstrapped and remote-valid.
- `--desktop-managed` disables CLI self-upgrade semantics.
- Desktop-owned managed-runtime restart stays available, but it is owned by Electron main rather than runtime self-`exec`.
- Managed restart reuses Desktop-owned startup preferences, including `--password-stdin`, and preserves the current resolved loopback bind when the saved bind uses the advanced auto-port loopback option such as `127.0.0.1:0`.
- `--startup-report-file` lets Electron wait for a structured desktop launch report instead of scraping terminal output.
- On lock conflicts, the runtime first tries to attach to an existing Local UI from the same state directory before reporting a blocked launch outcome.
- Desktop-managed startup settings do not create a separate runtime state directory; `~/.redeven` remains the runtime source of truth.
- Desktop-managed runtime state never falls back to the Electron process working directory; if no usable home directory exists and no explicit config path is available, startup fails clearly instead of writing inside an arbitrary repository or shell cwd.

When the selected target is `Remote Environment`, Desktop does not start the bundled binary.
Instead it validates and probes the configured Local UI base URL, then opens that exact origin in the shell.

When the selected target is `SSH Environment`, Desktop still keeps Redeven Local UI as the only runtime contract.
It does not introduce a second SSH-native file or terminal protocol. Instead, Electron main:

1. Validates the SSH target fields.
2. Uses the host `ssh` client in non-interactive batch mode.
3. Opens a shared SSH control socket.
4. Probes whether a compatible Desktop-managed copy of the exact Redeven release is already installed remotely.
5. If installation is needed, uses one of three bootstrap strategies:
   - `desktop_upload`
   - `remote_install`
   - `auto`
6. Starts `redeven run --mode local --local-ui-bind 127.0.0.1:0` remotely.
7. Waits for the remote startup report.
8. Creates a local SSH port forward to that remote Local UI port.
9. Opens the forwarded `127.0.0.1:<port>` origin as a normal Desktop session.

### SSH Bootstrap Environment

SSH bootstrap is intentionally transport-light and runtime-heavy:

- Desktop does not introduce a second SSH-native runtime protocol.
- Desktop pins the remote install to the same Redeven release tag as the running desktop build.
- Desktop only reuses a remote runtime when the binary reports that exact release tag and a Desktop-managed runtime stamp in the same version root is valid.
- Each managed version root contains `desktop-runtime.stamp`, which records the stamp schema, the owning shell (`redeven-desktop`), the exact release tag, and the install strategy.
- Desktop intentionally does not adopt arbitrary user-installed `redeven` binaries outside that managed version root, so SSH bootstrap stays side-by-side with direct CLI installs instead of mutating them.
- The remote install path defaults to the remote user's cache and can be overridden with an absolute path.
- Desktop can probe the remote OS/architecture (`linux` / `darwin`, `amd64` / `arm64` / `arm` / `386`) and choose the matching release package for desktop-managed upload.
- `desktop_upload` first resolves `SHA256SUMS`, `SHA256SUMS.sig`, and `SHA256SUMS.pem`, verifies that signed manifest against the pinned Sigstore Fulcio chain plus the Redeven GitHub Actions release-workflow identity policy, and only then trusts the per-asset checksums used for the tarball download.
- `release_base_url` lets operators point the desktop-upload path at a compatible internal release mirror instead of public GitHub Releases.
- Compatible internal mirrors must expose the same signed manifest contract as public releases:
  - `SHA256SUMS`
  - `SHA256SUMS.sig`
  - `SHA256SUMS.pem`
  - the matching `redeven_<goos>_<goarch>.tar.gz` assets
- Desktop caches SSH bootstrap artifacts by normalized `release_base_url`, release tag, and platform so different mirrors cannot poison each other's local cache entries.
- Desktop-side release downloads use explicit timeouts so restricted-network failures stay bounded and diagnosable.
- `auto` prefers desktop upload for restricted networks, then falls back to the remote installer path only when desktop-side asset preparation fails before upload/install begins.
- After Desktop starts uploading or installing the tarball over SSH, later failures stay first-class errors instead of silently degrading into `remote_install`.
- The forwarded localhost URL is session-ephemeral and only used as the live session origin.
- Session identity is derived from SSH destination, SSH port, and remote install directory so reconnecting does not create duplicates just because the forwarded local port changed.
- Closing the Desktop session tears down the local forward and the SSH-owned remote runtime together.
- SSH bootstrap still assumes non-interactive SSH authentication (`BatchMode=yes`), so missing keys or host-key trust issues surface as actionable launcher errors instead of prompting through Desktop UI.

### Launch Outcomes

The launch report distinguishes these outcomes:

- `ready`: the spawned desktop-managed process started Local UI successfully
- `attached`: the desktop shell found an attachable Local UI from the same state directory and reuses it
- `blocked`: another runtime instance owns the same state directory, but Desktop cannot attach to a Local UI from it

The first stable blocked code is:

- `state_dir_locked`

That blocked payload includes lock owner metadata and relevant state paths so Desktop can show actionable diagnostics without guessing from stderr text.

## Welcome Launcher

`Connect Environment` is the primary shell-owned startup surface.

Visual hierarchy:

- shell title: `Redeven Desktop`
- shell surface title: `Connect Environment`
- primary workbench column:
  - `Open Windows`
  - `Local Environment`
- secondary workbench column:
  - `Environment Library`
  - `Control Planes`
  - `Add` (`Add Connection` in tooltip and accessibility copy)
  - `All / Open / Recent / Saved` filters
- activity bar:
  - one item: `Connect Environment`

Interaction rules:

- Cold launch never auto-opens a remembered target.
- Environment choice is always a launcher action, never a side effect of saving settings.
- `Local Environment` is the primary path and behaves like a workbench-style open action.
- `Local Environment Settings` opens or focuses the launcher, then presents a modal dialog inside that same window.
- The `Add` action opens a dialog that can either connect immediately or save a remote Environment into the library.
- `Add Connection` is a two-mode dialog:
  - `Redeven URL`
  - `SSH`
- SSH mode keeps the same compact launcher shell but adds:
  - `Label`
  - `SSH Destination`
  - optional `Port`
  - `Bootstrap Delivery`
  - compact `Advanced` section for:
    - `Remote Install Directory`
    - `Release Base URL`
- The SSH `Advanced` disclosure initializes from the saved connection state once and then stays user-owned while editing, so typing in `Release Base URL` or `Remote Install Directory` does not auto-collapse the section.
- SSH mode explains the actual behavior inline:
  - Desktop reuses only the exact Desktop-managed release, installs it on demand when needed, and tunnels its Local UI over SSH.
  - Automatic reuses only the exact Desktop-managed release, prefers a desktop upload for offline targets, then falls back to the remote installer.
- `Add Control Plane` opens a separate dialog that accepts only a Provider URL and then continues in the system browser.
- Remote library entries distinguish:
  - unsaved remote sessions that are already open
  - auto-remembered recent connections
  - explicitly saved connections
- Open launcher entries switch their primary action from `Open` to `Focus`.
- The launcher shows every currently open Environment window and can focus any of them without opening duplicates.
- Recent remote Environments stay one click away after a successful connection.
- Saved remote Environments render in a compact library table and can be opened, edited, or deleted inline.
- Saved SSH Environments render in that same library table, but the visible target stays the SSH identity (`destination[:port]`) instead of the ephemeral forwarded localhost URL.
- Saved Control Planes render as a separate provider list with refresh, delete, and per-environment open/focus actions.
- Dense repeated controls use compact visible labels such as `Open`, `Focus`, `Add`, and `Save`; hover and accessibility metadata keep the full descriptive meaning.
- Validation errors render inline in the active launcher dialog, while startup failures render inline on the launcher.
- The shell frame remains visible before connection, but the activity bar keeps only the single `Connect Environment` entry.
- The launcher close action means:
  - `Quit` when no environment is open yet
  - `Close Launcher` when one or more Environment windows are already open

## Detached Session Windows

Desktop-managed Env App sessions can promote selected tools into detached native child windows when the interaction should stay independent from page dialogs and floating overlays.

Current detached session windows:

- `File Preview`
- `Debug Console`

Rules:

- Detached tools stay owned by the current Environment session instead of becoming shell-global utility windows.
- Focusing or reopening a detached tool reuses the same session child window identity instead of spawning duplicates.
- Ordinary page dialogs in the main Env App window do not cover detached tools, because Electron manages them as separate native windows.
- Debug Console therefore remains available while the main Env App shows ordinary page-level dialogs or floating-window-local confirmation flows.

## Local Environment Settings

`Local Environment Settings` is a launcher-owned dialog that opens above `Connect Environment` inside the same native window.

It edits only future startup behavior for `Local Environment`:

- `local_ui_bind`
- `local_ui_password`
- one-shot bootstrap request:
  - `controlplane_url`
  - `env_id`
  - `env_token`

Rules:

- Saving options only persists configuration.
- Saving options does not switch Environments.
- Cancel closes the dialog and returns the launcher to `Connect Environment`.
- One-shot bootstrap data is cleared automatically after a fresh successful desktop-managed start consumes it.
- The Local UI password input is write-only. When Desktop already has a stored password, the field stays blank and blank means `keep the stored password`.
- Removing a stored password requires an explicit remove action. Simply seeing an empty write-only field must not clear the stored secret.
- The dialog starts with a compact summary grid for visibility, next-start address, password state, and next start status.
- Summary-card details and field-level help stay available through compact question-mark tooltip affordances instead of always-visible helper paragraphs.
- Those tooltips render through the shared overlay portal so hover/focus help is visible above cards and dialogs instead of relying on browser-native `title` text.
- The first decision is a visibility intent, not a raw bind field:
  - `Local only`
  - `Shared on your local network`
  - `Custom exposure`
- The UI maps that intent back onto the existing runtime contract (`local_ui_bind` + `local_ui_password`) before saving, but it keeps port selection as a separate control instead of hiding it inside the scope preset.
- The settings dialog also shows the current managed runtime URL separately from the next-start configuration when the local environment is already running.
- The main editor uses a wider two-column card layout so visibility changes keep the form aligned instead of reflowing a long stack of helper text.
- The one-shot bootstrap request stays in a compact `Advanced` section so the main settings flow stays focused on common local access decisions.

## Desktop Preferences

Desktop keeps one persisted preference model for stable `Local Environment` configuration and saved remote Environments:

- `local_ui_bind`
- `local_ui_password`
- `local_ui_password_configured`
- `pending_bootstrap`
- `saved_environments`
- `saved_ssh_environments`
- `recent_external_local_ui_urls`
- `control_plane_refresh_tokens`
- `control_planes`

Semantics:

- Desktop does not persist a remembered current target for the next launch.
- Open Environment windows are runtime-only desktop session state.
- `local_ui_bind`, `local_ui_password`, and `local_ui_password_configured` apply only to future `Local Environment` opens.
- Desktop never sends the stored Local UI password plaintext back to the renderer. The shell UI edits only a write-only replacement draft plus explicit keep/replace/remove intent.
- `saved_environments` stores user-visible labels, normalized Local UI URLs, an origin marker (`saved` vs `recent_auto`), and `last_used_at_ms`.
- `saved_ssh_environments` stores user-visible labels, normalized SSH destination data, the remote install directory, the SSH bootstrap delivery mode, the optional release mirror base URL, an origin marker (`saved` vs `recent_auto`), and `last_used_at_ms`.
- `recent_external_local_ui_urls` remains a normalized compatibility bridge derived from `saved_environments`.
- `control_plane_refresh_tokens` stores per-provider opaque refresh tokens in the local secrets file, separate from visible provider/account metadata.
- `control_planes` stores normalized provider discovery data, the desktop account snapshot, the cached environment list, and the last sync time.
- Secrets are stored in Desktop’s local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise the files remain local-only user data owned by the current account.

Desktop maps user-facing local-access decisions back onto the same runtime contract:

- Default `Local only` -> `localhost:23998` with no password
- Default `Shared on your local network` -> `0.0.0.0:23998` with a password baseline
- `Custom exposure` -> raw bind/password editing
- Advanced `Local only` may opt into `127.0.0.1:0`, which the UI presents as `Auto-select an available port` instead of surfacing `:0` directly

Desktop semantics:

- Visibility scope and port selection are separate controls.
- `Local only` and `Shared on your local network` share the same fixed default port baseline.
- The saved configuration applies to the next managed start; the currently running managed URL is displayed separately when available.

Target validation rules:

- External targets must use an absolute `http://` or `https://` URL.
- The host must be `localhost` or an IP literal.
- The shell normalizes the configured target to the Local UI origin root.
- SSH targets accept `[user@]host` or SSH config host aliases.
- SSH ports must be valid TCP ports when present.
- SSH remote install directories must either use the default remote cache behavior or an absolute path.
- SSH bootstrap delivery must be one of `auto`, `desktop_upload`, or `remote_install`.
- SSH release base URLs must be blank or absolute `http://` / `https://` URLs.

Desktop shell preferences live under the Electron user data directory, not inside the git checkout.

## Control Plane Provider Protocol

Desktop supports compatible first-party and third-party control planes through one fixed provider contract:

- discovery: `GET /.well-known/redeven-provider.json`
- browser handoff ticket: `POST /api/rcpp/v1/desktop/handoff-ticket`
- desktop connect exchange: `POST /api/rcpp/v1/desktop/connect/exchange`
- desktop open exchange: `POST /api/rcpp/v1/desktop/open/exchange`
- desktop token refresh: `POST /api/rcpp/v1/desktop/token/refresh`
- desktop token revoke: `POST /api/rcpp/v1/desktop/token/revoke`
- desktop account lookup: `GET /api/rcpp/v1/me`
- provider environment list: `GET /api/rcpp/v1/environments`
- per-environment bootstrap ticket: `POST /api/rcpp/v1/environments/:env_public_id/desktop/bootstrap-ticket`
- runtime bootstrap exchange: `POST /api/rcpp/v1/runtime/bootstrap/exchange`

Desktop assumptions:

- The provider either implements the fixed contract or it does not.
- Desktop does not ask the provider for a capability matrix.
- Runtime features still come from the runtime itself, not from provider feature declarations.

The Control Plane flow is:

1. Desktop discovers the provider from its origin.
2. Desktop opens the provider's browser bridge page at `/desktop/connect`.
3. The browser session mints a one-time `handoff_ticket` and deep-links back to Desktop.
4. Desktop exchanges the `connect` handoff for a short-lived in-memory access token plus a long-lived revocable refresh token.
5. Desktop loads `me` and `environments` with the access token.
6. Desktop refreshes access tokens on demand with the stored refresh token.
7. Desktop requests a one-time `bootstrap_ticket` only when it opens a specific environment.
8. The managed runtime exchanges that ticket for direct connect info.

Browser handoff may also open Desktop through a custom protocol link:

- `redeven://control-plane/connect?...`
- `redeven://control-plane/open?...`

For `connect`, the deep link carries a one-time `handoff_ticket`.

For `open`, the provider origin, target environment ID, and one-time `handoff_ticket` are sufficient. Desktop exchanges that handoff for a one-time `bootstrap_ticket`. `provider_id` is optional because Desktop can resolve it through discovery.

## Shell-Owned Theme State

Desktop theme is shell-owned UI state shared by Electron main, preload, welcome, and desktop Env App.

Authoritative state:

- Electron main persists `theme_source` in Desktop UI state under `desktop:theme-source`.
- `theme_source` is one of:
  - `system`
  - `light`
  - `dark`
- Electron main resolves `resolved_theme` from `theme_source` plus `nativeTheme.shouldUseDarkColors`.
- Electron main materializes one `DesktopThemeSnapshot` payload:
  - `source`
  - `resolvedTheme`
  - `window.backgroundColor`
  - `window.symbolColor`

Native window contract:

- `window.backgroundColor` and `window.symbolColor` are native-window colors, not generic CSS theme strings.
- The desktop shell treats those fields as hex-only values so they remain safe for:
  - `BrowserWindow.backgroundColor`
  - `BrowserWindow.setBackgroundColor()`
  - `titleBarOverlay.color`
- Renderer page tokens still come from the broader desktop palette, but Electron-native APIs must not depend on CSS-only color syntax or DOM sampling.

Behavior:

- Every `BrowserWindow` is created from the latest shell snapshot, so the native window background is correct before the first renderer paint.
- Desktop main resolves one platform-aware window chrome contract per process:
  - `mode` (`hidden-inset` or `overlay`)
  - native controls side (`left` or `right`)
  - titlebar height
  - renderer safe insets for start/end chrome reservations
- Linux and Windows title bar overlay colors still come from the desktop shell, but that overlay behavior is no longer coupled to renderer-side color reporting.
- Preload exposes `window.redevenDesktopTheme` with synchronous `getSnapshot()`, `setSource(...)`, and `subscribe(...)`.
- Preload applies `html.light` / `html.dark` and `color-scheme` as soon as the document is available, then keeps the current document synchronized when theme updates arrive from Electron main.
- Preload also applies an early document-level background and foreground fallback using the shell snapshot so close animations, blocked paints, and live resize reveal the same dark/light base color instead of the Electron default white surface.
- Preload also publishes the desktop chrome contract through CSS custom properties:
  - `--redeven-desktop-titlebar-height`
  - `--redeven-desktop-titlebar-start-inset`
  - `--redeven-desktop-titlebar-end-inset`
- Preload also publishes generic detached-window titlebar hooks so renderer shells can consume the same contract without per-scene platform logic:
  - `[data-redeven-desktop-window-titlebar='true']`
  - `[data-redeven-desktop-window-titlebar-content='true']`
- Floe shell top bars and desktop-owned launcher chrome both receive drag / no-drag semantics from preload so BrowserWindow movement keeps working after the app takes over the title bar area.
- Detached desktop child windows render through a shared chrome-safe frame in Env App, so title, subtitle, banner, footer, and scene body can evolve independently while native control reservations still come only from the shell contract.
- Welcome and desktop Env App route only the Floe `theme` persistence key through the shell bridge; other UI state stays in their normal storage namespaces.
- Welcome and Env App each keep an explicit entry-document background fallback (`html` / `body` / `#root`) so the first renderer frame matches the shell-owned native window background even before business UI mounts.
- Theme toggles from either welcome or Env App update native chrome and all registered renderer windows together, including detached desktop child windows.
- When the stored source is `system`, Electron main rebroadcasts a fresh snapshot whenever the OS theme changes.

Non-goals:

- Native window colors must not depend on DOM color sampling from the current page.
- Native window colors must not use renderer-only CSS syntaxes that are not part of the desktop shell’s native hex-color contract.
- Desktop should not maintain one-off per-surface theme patches for welcome, Env App, or detached child windows.

## User Entry Points

- Cold app launch opens the singleton launcher window.
- The native app menu exposes one primary shell action: `Connect Environment...`
- Shell window aliases such as `connect` route to the same welcome launcher.
- Compatible providers may also enter through the registered `redeven://` deep-link scheme.
- Generic settings aliases such as `advanced_settings` route to the launcher-owned `Local Environment Settings` dialog.
- After Local UI opens inside Redeven Desktop, Env App still exposes shell-owned window actions through the desktop browser bridge.
- `Switch Environment` focuses or opens the singleton launcher instead of replacing the active Environment session window.
- `Runtime Settings` focuses or opens the singleton launcher and presents the `Local Environment Settings` dialog instead of creating a second native window.
- The desktop browser bridge also exposes a dedicated managed-runtime restart action for `Restart runtime`; it is separate from window-navigation actions.
- The desktop browser bridge also exposes an explicit external-URL action for workflows that must leave the Electron shell and continue in the system browser.
- Env App exposes `Switch Environment` and `Runtime Settings` through the desktop browser bridge when the desktop shell bridge is available.
- Env App Codespaces uses that external-URL bridge when the desktop shell is present, so `Open` launches the selected codespace in the system browser instead of an Electron child window.
- When the desktop-managed Local UI is password-protected, the first protected Codespaces request may rely on `redeven_access_resume` instead of an existing browser cookie. Local UI exchanges that resume token into the normal local access cookie on the first protected response so the rest of the codespace page load stays on the same same-origin browser session.
- Env App `Runtime Settings` stays separate from shell-owned Environment selection and desktop-managed startup state.

## Error Recovery

- Remote target unreachable
  - launcher reloads with the failing URL preserved and an inline remote-environment issue
- SSH bootstrap failed
  - launcher reloads with the SSH target preserved in diagnostics and an inline remote-environment issue
- Desktop-managed startup blocked
  - launcher reloads with a `Local Environment` issue and diagnostics copy
- Detached child windows and Ask Flower handoff stay session-scoped during recovery; only the owning Environment window receives those callbacks
- Secondary compatibility surfaces such as the blocked page may still exist, but the normal product flow is launcher-first recovery through the launcher window and its dialogs

## Accessibility Behavior

Desktop-owned startup surfaces target the same WCAG 2.2 AA baseline as Env App and now reuse Floe workbench layout primitives for shell chrome.

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
- When a desktop-managed restart finishes, Env App recovers in place through the same shell-owned reconnect/access-gate flow used by other reconnect scenarios.
- If the restarted runtime requires password verification again, the same page asks for the Local UI password instead of requiring a manual browser refresh.
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
