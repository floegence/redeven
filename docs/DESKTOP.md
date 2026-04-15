# Desktop Shell

This document describes the public Electron desktop shell that ships with each `redeven` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for endpoint behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse Redeven Local UI instead of introducing a second app runtime.
- Let Desktop bootstrap a remote Redeven runtime over SSH without requiring a manual preinstall on the target machine.
- Make environment choice explicit on every cold desktop launch.
- Keep launcher, recovery, diagnostics, and per-environment startup configuration aligned around a launcher-window plus session-window model.

## Architecture

- Electron is a thin shell around Redeven Local UI.
- `redeven run --mode desktop --desktop-managed` remains the only bundled-runtime entrypoint.
- Desktop keeps one singleton shell-owned utility window:
  - `Connect Environment` launcher
- `Environment Settings` renders as a launcher-owned modal dialog instead of a second native window.
- Each opened Environment owns its own top-level session window, plus any detached child windows it spawns.
- Detached child windows are session-scoped tools rather than global shell utilities. File preview and Debug Console are current examples.
- Session deduplication happens in Electron main through a canonical session key:
  - `env:<environment_id>:local_host` for a locally hosted managed environment window
  - `env:<environment_id>:remote_desktop` for a remote desktop window opened through a Control Plane provider
  - `url:<normalized-local-ui-origin>` for remote Local UI targets
  - `ssh:<normalized-ssh-identity>` for SSH-bootstrap targets
- Desktop-managed environments are the entries that own a real Redeven scope directory on this machine:
  - local environments map to `~/.redeven/scopes/local/<name>`
  - Control Plane environments map to `~/.redeven/scopes/controlplane/<provider_key>/<env_public_id>`
- Each desktop-managed Environment window also receives a Desktop-owned session context snapshot:
  - `managed_environment_id`
  - `environment_storage_scope_id`
- Env App uses `environment_storage_scope_id` only for environment-owned persisted UI state such as File Browser history and active thread context. Intentionally global shell/UI preferences remain global.
- Control Plane identity stays split on purpose:
  - `provider_key` is the local scope/storage key derived from the provider origin and is only used in local paths plus scope metadata
  - `provider_id` is the canonical discovery identity from `/.well-known/redeven-provider.json` and is used for provider protocol payloads, provider catalogs, and managed-environment provider bindings
- Desktop and standalone runtime / CLI mode also share one canonical environment catalog under:
  - `~/.redeven/catalog/environments/*.json`
  - `~/.redeven/catalog/connections/*.json`
  - `~/.redeven/catalog/providers/*.json`
- In the shared catalog, `identity.provider_id` and `provider_binding.provider_id` always mean the canonical discovery `provider_id`; they must not be rewritten to the local `provider_key`.
- Saved Redeven URL and SSH entries are connection records only. They do not own an additional Desktop-private runtime state directory.
- Desktop and standalone runtime / CLI mode resolve the same scope directories. Desktop does not invent a second local-environment state root.
- The provider / control-plane model remains environment-first. Whether an environment is locally hosted on this machine is a local runtime/Desktop fact, not a provider-side device resource.
- The shell keeps `Top Bar`, `Activity Bar`, and `Bottom Bar` visible before an environment is opened, so startup and active-session flows share the same frame.
- Every cold desktop launch opens the welcome launcher first.
- The launcher always asks the user what to open in this desktop session:
  - any known desktop-managed local environment
  - any known desktop-managed Control Plane environment
  - a remembered recent Environment
  - a saved Redeven Local UI URL
  - a saved SSH target that Desktop bootstraps on demand
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

- Local UI always starts for a desktop-managed environment that Desktop owns locally.
- `--password-stdin` is the non-interactive desktop-managed password transport.
- Desktop resolves the managed config path before spawn and passes it explicitly to `redeven run`.
- Desktop-managed local environments use `~/.redeven/scopes/local/<name>/config.json`.
- Desktop startup flows that include a bootstrap target use the matching control-plane scope at `~/.redeven/scopes/controlplane/<provider_key>/<env_public_id>/config.json`.
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
- Desktop-managed startup settings do not create a second preference-owned runtime target; the resolved scope directory remains the runtime source of truth.
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

### Session Lifecycle And Window Visibility

Desktop tracks each launcher-opened Environment session with an explicit lifecycle:

- `opening`
- `open`
- `closing`

Rules:

- Electron main creates a new session window hidden while the session is still `opening`.
- A session becomes `open` only after the first successful main-frame load completes.
- Only `open` sessions contribute to launcher `open_windows`, `is_open`, and `Focus` affordances.
- `opening` sessions surface as route-aware `Opening…` actions and block duplicate open attempts for that same session identity.
- `closing` sessions are removed from launcher `Focus` state immediately, even before native teardown fully completes.
- If the first main-frame load fails, times out, or the window closes before becoming ready, Desktop tears the session down and reports the failure without leaving a blank visible window behind.
- Renderer action state must come from the lifecycle-aware session summary, never from saved entry metadata alone.

## Welcome Launcher

`Connect Environment` is the primary shell-owned startup surface.

Visual hierarchy:

- shell title: `Redeven Desktop`
- shell surface title: `Connect Environment`
- compact launcher header:
  - `Environments / Control Planes` tabs
  - shell-wide open-window and card counts
  - add / close actions
- `Environments` tab:
  - desktop-managed environment cards for every local, provider-backed, and dual-route managed environment
  - compact search + provider filter + `All / Open / Recent / Saved` toolbar
  - the same shared grid also includes saved Redeven URL and SSH entries
  - when pinned entries exist, the launcher keeps explicit `Pinned` and `Environments` sections
  - those sections must still share one measured environment-library column model, so pinning only changes grouping order and never changes card width
  - provider filters and search only change which cards are shown; they must not collapse the underlying card-width system for the current library scope
- `Control Planes` tab:
  - provider action shelves only
  - provider counts, sync state, and provider-to-environment shortcuts
- activity bar:
  - one item: `Connect Environment`

Interaction rules:

- Cold launch never auto-opens a remembered target.
- Environment choice is always a launcher action, never a side effect of saving settings.
- Desktop-managed local environments are ordinary first-class cards instead of a singleton hard-coded entry.
- `Environment Settings` opens or focuses the launcher, then presents a modal dialog inside that same window for the selected managed environment.
- The `Add` action opens a dialog that can either connect immediately or save a new Environment into the library.
- `New Environment` is a three-mode dialog:
  - `Managed`
  - `Redeven URL`
  - `SSH`
- Managed mode keeps the flow lightweight and explicit:
  - `Name`
  - `Local UI Bind`
  - `Local UI Password`
- optional `Connect To A Control Plane Environment`
  - pick one saved Control Plane
  - pick one provider environment from that Control Plane catalog
  - Desktop computes an explicit binding-resolution state before save/connect:
    - create a new binding
    - update the same existing binding
    - reuse an existing managed entry
    - focus an already open session
    - wait for an already opening session
    - block when another local host process already owns that environment on this device
- When the user leaves Control Plane binding off, Desktop derives the internal local scope from `Name` automatically.
- Editing a local-only managed environment changes only the visible `Name`; the existing local scope stays stable unless Desktop later grows an explicit scope-migration action.
- Creating a managed environment can either:
  - save the managed environment card without opening it yet
  - connect immediately and start or attach to that managed scope
- Creating or editing a managed environment may explicitly upgrade one local-only entry into a dual-route local-plus-Control-Plane environment.
- Provider sync still reconciles runtime-discovered local hosting into the shared managed-environment catalog, but the create/edit flow no longer forces users to wait for that background reconciliation before binding local and remote access together.
- SSH mode keeps the same compact launcher shell but adds:
  - `Name`
  - `SSH Destination`
  - optional `Port`
  - `Bootstrap Delivery`
  - compact `Advanced` section for:
    - `Remote Install Directory`
    - `Release Base URL`
- The SSH `Advanced` disclosure initializes from the saved connection state once and then stays user-owned while editing, so typing in `Release Base URL` or `Remote Install Directory` does not auto-collapse the section.
- SSH mode explains the actual behavior inline:
  - Desktop reuses only the exact Desktop-managed release, installs it on demand when needed, and tunnels its Local UI over SSH.
- `Add Control Plane` opens a separate dialog that accepts:
  - a user-owned local `Name`
  - a `Provider URL`
  - the default `Name` is derived from the provider hostname until the user edits it explicitly
- The launcher defaults to the `Environments` tab and treats environment switching as the primary task.
- `Control Planes` moves into its own tab so provider management does not compete with the main environment-switching path.
- Environment cards own the primary actions, so open sessions are reflected through `Open` / `Focus` state directly on the relevant card instead of a separate session rail.
- Local managed environments, remote-only provider environments, and dual-route environments all render in the `Environments` tab.
- Connecting or refreshing a Control Plane materializes every accessible provider environment into the shared managed-environment catalog immediately.
- `Control Planes` stays provider-management-only. Each shelf offers `View Environments`, `Reconnect`, `Refresh`, and `Delete`.
- Environment Library cards use one fixed-height layout:
  - header with label, relative timestamp, pin/unpin icon, and status badge
  - compact facts rows such as `RUNS ON`, `ACCESS`, and `CONTROL PLANE`
  - an `Endpoint` block with readonly inputs plus `Copy`
  - pinned and regular sections align to the same card columns whenever both are visible
  - footer actions aligned vertically across card types
- Environment Library pinning is first-class:
  - pinned cards render once inside a dedicated `Pinned` section
  - unpinned cards remain in the regular `Environments` section
  - pinning an open unsaved Redeven URL or SSH target implicitly promotes it into the saved Environment Library
- Managed environment cards show the label, status, and the next bind or provider/environment identity that will be reused on the next open.
- Managed environment cards normalize provider runtime into one user-facing state model:
  - `Open`
  - `Ready`
  - `Local Ready`
  - `Checking`
  - `Offline`
  - `Status stale`
  - `Reconnect required`
  - `Sync needed`
  - `Unavailable`
- Control Plane shelves still keep the raw provider runtime details (`status`, `lifecycle_status`, `last_seen_at`) visible in the detail rows, but the primary badge stays consistent with the Environment Library.
- Provider-backed state is freshness-aware instead of being treated as timeless cache:
  - Desktop marks provider catalogs as `fresh`, `stale`, or `unknown`
  - opening the launcher, refocusing it, and waking the machine all trigger best-effort provider refresh
  - while the launcher stays visible, Desktop also polls stale providers in the background
- Card CTA and badge now come from the same normalized route model:
  - Desktop never shows a normal clickable `Open` for a remote route that is already known `Offline`
  - stale remote state prefers `Refresh Status`
  - expired provider authorization prefers `Reconnect`
  - provider refresh failures prefer `Retry Sync`
- Managed session action state is lifecycle-aware:
  - `Focus` only appears for a route whose session lifecycle is truly `open`
  - `Opening…` is disabled and does not imply the window is ready yet
  - closing or failed sessions stop contributing `Focus` immediately
  - `Attach` appears for a local route when Desktop can tell that a compatible local runtime is already running and the next action will reuse it instead of starting a fresh one
- Environment cards stay concise:
  - card bodies avoid explanatory helper prose under the actions
  - only concrete identifiers, runtime details, badges, and notices stay visible inside the card
- Dual-route managed environments stay route-aware:
  - the footer uses a split primary action instead of persistent side-by-side `Open Local` and `Open Remote` buttons
  - the primary segment executes the resolved default route immediately
  - the route menu keeps both the local route and the remote route or remote recovery action visible on the same card
  - the local route may surface `Open`, `Attach`, or `Focus` depending on whether the runtime needs to be started, can be reused, or already has an open Desktop window
  - if this device can still host the environment locally, local open stays one click away even when the remote route is degraded
  - managed cards surface a compact `LOCAL RUNTIME` fact so users can distinguish `Starts on open`, `Running in Desktop`, and `Running externally`
  - when a local runtime is already running, cards also surface whether the Desktop window `Stops on close` or `Detaches on close`
- Deleting a managed environment is a first-class action:
  - Desktop blocks deletion while a window for that managed environment is still open
  - the default local environment `local:default` is a protected Desktop entry and is not deletable from the launcher
  - deleting a local-only managed environment removes the managed entry and its Desktop-owned local scope state
  - deleting a dual-route managed environment removes only Desktop-owned local hosting and keeps the remote-only Control Plane entry in the catalog
- Remote library entries distinguish:
  - unsaved remote sessions that are already open
  - auto-remembered recent connections
  - explicitly saved connections
- Open launcher entries switch their primary action from `Open` to `Focus`.
- Recent remote Environments stay one click away after a successful connection.
- Saved remote Environments render in a card grid and can be opened, edited, saved, or deleted inline.
- Saved SSH Environments render in that same card grid, with the SSH identity (`destination[:port]`) and forwarded Local UI both exposed through the Endpoint copy rows.
- Saved Control Planes render in a separate tab with compact provider-level reconnect/refresh/delete shelves and no nested per-environment card grid.
- Control Plane shelves show the Desktop display label as the primary title while still surfacing the provider product name, origin, published environment count, unified-catalog count, and local-host count.
- Dense repeated controls use compact visible labels such as `Open`, `Focus`, `Add`, and `Save`; hover and accessibility metadata keep the full descriptive meaning.
- Field-validation errors stay inline inside the active launcher dialog, while transient launcher/open failures render as toasts instead of entering page flow.
- Expected launcher failures no longer rely on raw IPC exception text:
  - stale session focus returns a structured `session_stale` result
  - environment/control-plane missing states return structured launcher failures
  - remote provider failures return structured reconnect / refresh / retry states
  - the renderer refreshes its snapshot and maps transient environment-scoped failures to toast feedback
- Environment-scoped recovery copy stays action-oriented instead of surfacing Electron IPC internals:
  - `That window was already closed. Desktop refreshed the environment list.`
  - `Remote status is stale. Refresh the provider to confirm the latest state.`
  - `This environment is currently offline in the provider.`
- Transient operation confirmations stay out of page flow:
  - success and info feedback such as `Refreshed this Control Plane.` render as toast notifications
  - launcher/opening failures such as `Unable to open that Environment` also render as toasts
  - Desktop does not insert transient success/info/error banners or card-inline notices into the launcher content area
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

## Environment Settings

`Environment Settings` is a launcher-owned dialog that opens above `Connect Environment` inside the same native window.

It edits only future startup behavior for the selected desktop-managed environment:

- `local_ui_bind`
- `local_ui_password`

Rules:

- Saving options only persists configuration.
- Saving options does not switch Environments.
- Cancel closes the dialog and returns the launcher to `Connect Environment`.
- The Local UI password input is write-only. When Desktop already has a stored password, the field stays blank and blank means `keep the stored password`.
- Removing a stored password requires an explicit remove action. Simply seeing an empty write-only field must not clear the stored secret.
- The dialog starts with a workbench-style overview that shows:
  - the current managed runtime address
  - the next-start address and protection state
  - a compact summary grid for visibility, next-start address, and password state
- Summary-card details and field-level help stay available through compact question-mark tooltip affordances instead of always-visible helper paragraphs.
- Those tooltips render through the shared overlay portal so hover/focus help is visible above cards and dialogs instead of relying on browser-native `title` text.
- The first decision is a visibility intent, not a raw bind field:
  - `Local only`
  - `Shared on your local network`
  - `Custom exposure`
- The UI maps that intent back onto the existing runtime contract (`local_ui_bind` + `local_ui_password`) before saving, but it keeps port selection as a separate control instead of hiding it inside the scope preset.
- `Access & Security` presents those visibility options as selectable preset cards rather than a dense field-only form.
- The settings dialog always shows the current managed runtime URL separately from the next-start configuration when the selected managed environment is already running.
- The main editor uses a wider two-column card layout so visibility changes keep the form aligned instead of reflowing a long stack of helper text.
- Password handling becomes explicitly stateful:
  - current password state is visible through summary chips
  - replacing a password is expressed as a queued replacement
  - removing a stored password remains an explicit action
- Control Plane managed environments reuse the same settings surface, but the environment identity itself stays fixed. The editable part is only the local Local UI exposure that Desktop will request the next time it opens that environment.

## Desktop Preferences

Desktop keeps one persisted preference model for desktop-managed environments and saved remote connections:

- `managed_environments`
- `saved_environments`
- `saved_ssh_environments`
- `recent_external_local_ui_urls`
- `control_plane_refresh_tokens`
- `control_planes`

Semantics:

- Desktop does not persist a remembered current target for the next launch.
- Open Environment windows are runtime-only desktop session state.
- `managed_environments` stores desktop-managed local and Control Plane environments with:
  - stable environment identity
  - optional local-hosting route
  - optional provider-binding route
  - user-visible name/title (persisted internally as `label`)
  - per-environment Local UI bind/password configuration
  - pin and timestamp metadata
  - provider-binding upsert semantics that prefer editing/reusing the existing managed entry for the same Control Plane environment instead of silently creating duplicates
- Desktop never sends the stored Local UI password plaintext back to the renderer. The shell UI edits only a write-only replacement draft plus explicit keep/replace/remove intent.
- `saved_environments` stores user-visible labels, normalized Local UI URLs, an origin marker (`saved` vs `recent_auto`), pin state, and `last_used_at_ms`.
- `saved_ssh_environments` stores user-visible labels, normalized SSH destination data, the remote install directory, the SSH bootstrap delivery mode, the optional release mirror base URL, an origin marker (`saved` vs `recent_auto`), pin state, and `last_used_at_ms`.
- `recent_external_local_ui_urls` remains a normalized compatibility bridge derived from `saved_environments`.
- `control_plane_refresh_tokens` stores per-provider opaque refresh tokens in the local secrets file, separate from visible provider/account metadata.
- `control_planes` stores normalized provider discovery data, the desktop-owned display label, the desktop account snapshot, the cached environment list, and the last sync time.
- Provider refresh reconciles `control_planes[*].environments` back into `managed_environments`:
  - provider-backed environments are materialized as remote-only entries when no local route exists yet
  - existing dual-route entries preserve their local-hosting metadata, pins, and preferred route
  - remote-only entries are removed when the provider catalog no longer exposes them
  - dual-route entries stay visible even when the provider route disappears, but their remote route degrades to `removed`
- Secrets are stored in Desktop’s local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise the files remain local-only user data owned by the current account.
- Legacy single-local-environment settings migrate into the managed local environment with identity `local:default`.
- `local:default` remains the always-available default local environment in Desktop; UI may rename its visible title, but ordinary editing does not remove the entry or migrate its scope.

Desktop maps user-facing local-access decisions back onto the same runtime contract:

- Default `Local only` -> `localhost:23998` with no password
- Default `Shared on your local network` -> `0.0.0.0:23998` with a password baseline
- `Custom exposure` -> raw bind/password editing
- Advanced `Local only` may opt into `127.0.0.1:0`, which the UI presents as `Auto-select an available port` instead of surfacing `:0` directly

Desktop semantics:

- Visibility scope and port selection are separate controls.
- `Local only` and `Shared on your local network` share the same fixed default port baseline.
- The saved configuration applies to the next managed start; the currently running managed URL is displayed separately when available.
- Multiple local environments may coexist on one device. Their runtime ownership stays separate because each one resolves to a different `local/<name>` scope directory.
- A single managed environment may be used both locally and remotely. Desktop owns the local Local UI exposure for that scope, while the provider-backed route may come from either explicit create/edit binding or provider-sync reconciliation into the same shared managed-environment identity.
- If Desktop attaches to a runtime that was started by standalone runtime / CLI mode, that attached runtime stays externally owned: closing the Desktop session only detaches, and restart/update stay delegated to the host process that owns that runtime.
- Launcher runtime ownership is explicit on the environment card: externally owned runtimes surface as attachable local runtimes, while Desktop-owned runtimes surface as Desktop-managed local runtimes.
- Standalone runtime / CLI and Desktop sessions stay interoperable because both read and write the same scope-first runtime layout.

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
- browser authorization code: `POST /api/rcpp/v1/desktop/authorize`
- desktop connect exchange: `POST /api/rcpp/v1/desktop/connect/exchange`
- desktop token refresh: `POST /api/rcpp/v1/desktop/token/refresh`
- desktop token revoke: `POST /api/rcpp/v1/desktop/token/revoke`
- desktop account lookup: `GET /api/rcpp/v1/me`
- provider environment list: `GET /api/rcpp/v1/environments`
- per-environment open session: `POST /api/rcpp/v1/environments/:env_public_id/desktop/open-session`
- runtime bootstrap exchange: `POST /api/rcpp/v1/runtime/bootstrap/exchange`

Canonical provider references in `redeven-portal`:

- end-user guide: Portal console docs (`/docs/control-plane-providers`)
- formal RCPP v1 specification: [https://github.com/floegence/redeven-portal/blob/main/docs/protocol/rcpp-v1.md](https://github.com/floegence/redeven-portal/blob/main/docs/protocol/rcpp-v1.md)
- machine-readable OpenAPI: [https://github.com/floegence/redeven-portal/blob/main/docs/openapi/rcpp-v1.yaml](https://github.com/floegence/redeven-portal/blob/main/docs/openapi/rcpp-v1.yaml)

Desktop assumptions:

- The provider either implements the fixed contract or it does not.
- Desktop does not ask the provider for a capability matrix.
- Runtime features still come from the runtime itself, not from provider feature declarations.
- Desktop sends provider HTTP requests from Electron main through Chromium's network stack so certificate trust, proxies, and DNS behavior stay aligned with the local browser session.
- For local development over HTTPS, the machine running Desktop must trust the development CA that issued the provider certificate.

The Control Plane flow is:

1. Desktop discovers the provider from its origin.
2. Desktop opens the provider's browser bridge page at `/desktop/connect`.
3. Desktop generates a local PKCE `state + code_verifier + code_challenge`.
4. The browser session requests a short-lived `authorization_code` and deep-links back to Desktop.
5. Desktop exchanges `authorization_code + code_verifier` for a short-lived in-memory access token plus a long-lived revocable refresh token.
6. Desktop loads `me` and `environments` with the access token.
7. Desktop reconciles those provider environments into the shared managed-environment catalog as remote-only or dual-route entries.
7. Desktop refreshes access tokens on demand with the stored refresh token.
8. Desktop requests a unified per-environment open session only when it opens a specific environment.
9. Desktop resolves the actual open route from the saved environment record:
   - explicit or default `preferred_open_route`
   - the last explicit local-vs-remote route the user chose from the launcher split-button menu
   - whether that environment is declared as locally hosted on this device
   - whether the provider returned `bootstrap_ticket`, `remote_session_url`, or both
10. For a locally hosted route, Desktop uses the returned `bootstrap_ticket` and the managed runtime exchanges it for direct connect info.
11. For a remote desktop route, Desktop opens the returned `remote_session_url` directly without starting a local bundled runtime.
12. Desktop never silently local-starts a Control Plane environment that is not declared as hosted on this device.

Browser pages may also open Desktop through a custom protocol link:

- `redeven://control-plane/connect?...`
- `redeven://control-plane/open?...`
- `redeven://control-plane/authorized?...`

For `connect`, the launch deep link carries only `provider_origin`. Desktop then opens the browser bridge again with PKCE query parameters.

For `authorized`, the browser returns `provider_origin`, `state`, and `authorization_code`. Desktop matches that state locally, validates the provider origin, and completes the connect exchange with its local `code_verifier`.

For `open`, the provider origin and target environment ID are sufficient. If Desktop already has provider authorization, it directly requests a unified open-session response. Otherwise it first completes the same PKCE browser authorization flow and then requests open-session. `provider_id` remains optional because Desktop can resolve it through discovery.

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
- Generic settings aliases such as `advanced_settings` route to the launcher-owned `Environment Settings` dialog.
- After Local UI opens inside Redeven Desktop, Env App still exposes shell-owned window actions through the desktop browser bridge.
- `Switch Environment` focuses or opens the singleton launcher instead of replacing the active Environment session window.
- `Runtime Settings` focuses or opens the singleton launcher and presents the `Environment Settings` dialog instead of creating a second native window.
- The desktop browser bridge also exposes a dedicated managed-runtime restart action for `Restart runtime`; it is separate from window-navigation actions.
- The desktop browser bridge also exposes an explicit external-URL action for workflows that must leave the Electron shell and continue in the system browser.
- Env App exposes `Switch Environment` and `Runtime Settings` through the desktop browser bridge when the desktop shell bridge is available.
- Env App Codespaces uses that external-URL bridge when the desktop shell is present, so `Open` launches the selected codespace in the system browser instead of an Electron child window.
- When the desktop-managed Local UI is password-protected, the first protected Codespaces request may rely on `redeven_access_resume` instead of an existing browser cookie. Local UI exchanges that resume token into the normal local access cookie on the first protected response so the rest of the codespace page load stays on the same same-origin browser session.
- Env App `Runtime Settings` stays separate from shell-owned Environment selection and desktop-managed startup state.

## Error Recovery

- Remote target unreachable
  - Desktop tears down the failed opening session, keeps the launcher stable, and shows a toast with the preserved target context
- SSH bootstrap failed
  - Desktop tears down the failed opening session, preserves the SSH target in diagnostics, and reports the failure through toast feedback
- Desktop-managed startup blocked
  - Desktop returns to the launcher with structured recovery state and toast feedback instead of opening a blank Environment window
- Detached child windows and Ask Flower handoff stay session-scoped during recovery; only the owning Environment window receives those callbacks
- The normal product flow is launcher-first recovery through the launcher window, its dialogs, and toast feedback rather than page-inserted recovery banners

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

- Inline launcher validation errors are focusable and announced immediately.
- Toast notifications use live-region semantics without shifting focus away from the active launcher workflow.

## Env App Behavior

- Desktop-managed Local UI exposes `desktop_managed`, `effective_run_mode`, and `remote_enabled` through local runtime/version endpoints.
- When the runtime reports a desktop-owned release policy, Env App turns `Update Redeven` into `Manage in Desktop`.
- Env App keeps `Restart runtime` only for Desktop-owned managed runtimes.
- When Desktop is attached to an externally owned local runtime, restart and update hand off to the owning host process instead of trying to stop that runtime from Electron.
- When a desktop-managed restart finishes, Env App recovers in place through the same shell-owned reconnect/access-gate flow used by other reconnect scenarios.
- If the restarted runtime requires password verification again, the same page asks for the Local UI password instead of requiring a manual browser refresh.
- Desktop resolves update impact before continuing:
  - Desktop-managed local and Control Plane environments may require a Desktop restart and reopen flow
  - SSH-managed environments only affect that one SSH target
  - external Redeven URL targets stay externally managed and do not offer a Desktop-side runtime update action
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

For release automation, the same preparation script can hydrate the bundle from a prebuilt CLI tarball by setting `REDEVEN_DESKTOP_RUNTIME_TARBALL`.
