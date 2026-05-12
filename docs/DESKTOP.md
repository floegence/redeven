# Desktop Shell

This document describes the public Electron desktop shell that ships with each `redeven` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for endpoint behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse Redeven Local UI instead of introducing a second app runtime.
- Let Desktop bootstrap a remote Redeven environment instance on a reachable host over SSH without requiring a manual preinstall on the target host.
- Make environment choice explicit on every cold desktop launch.
- Keep launcher, recovery, diagnostics, and Local Environment startup configuration aligned around a launcher-window plus session-window model.

## Architecture

- Electron is a thin shell around Redeven Local UI.
- `redeven run --mode desktop --desktop-managed` remains the only bundled-runtime entrypoint.
- Desktop keeps one singleton shell-owned utility window:
  - `Connect Environment` launcher
- `Environment Settings` renders as a launcher-owned modal dialog instead of a second native window.
- Each opened Environment owns its own top-level session window, plus any session child windows opened by allowed in-app navigation.
- Session deduplication happens in Electron main through a canonical session key:
  - `env:<environment_id>:local_host` for a locally hosted Local Environment or linked-local window
  - `env:<environment_id>:remote_desktop` for a remote desktop window opened through a Control Plane provider
  - `url:<normalized-local-ui-origin>` for remote Local UI targets
  - `ssh:<normalized-ssh-environment-id>` for SSH-hosted environment instances
- Desktop owns one Local Environment for the current OS user / Redeven profile state root:
  - the runtime config is stored at `~/.redeven/local-environment/config.json`
  - provider environments may be listed in the catalog, but only one provider Environment can be linked to the Local Environment at a time
- Each Desktop session window also receives a Desktop-owned session context snapshot:
  - `local_environment_id`
  - `renderer_storage_scope_id`
  - `target_kind` (`local_environment`, `external_local_ui`, or `ssh_environment`)
  - `target_route` (`local_host` or `remote_desktop`) when the target is a managed Local Environment
- Env App uses `renderer_storage_scope_id` only for renderer-scoped persisted UI state such as File Browser history and active thread context. Intentionally global shell/UI preferences remain global.
- Env App uses `target_kind` / `target_route` to choose Web Services open routes. Managed same-device local sessions can open loopback services directly, saved Redeven URL and SSH Host sessions use the Local UI `/pf/<forward_id>/` proxy, and remote Provider sessions keep using the Flowersec E2EE tunnel.
- `provider_id` is the canonical discovery identity from `/.well-known/redeven-provider.json` and is used for provider protocol payloads, provider catalogs, and provider bindings.
- Desktop and standalone runtime / CLI mode also share one profile-scoped catalog:
  - `~/.redeven/catalog/local-environment.json`
  - `~/.redeven/catalog/provider-environments/*.json`
  - `~/.redeven/catalog/connections/*.json`
  - `~/.redeven/catalog/providers/*.json`
- In the shared catalog, `provider_id` and `current_provider_binding.provider_id` always mean the canonical discovery `provider_id`.
- Saved Redeven URL and SSH Host entries are connection records only. SSH Host entries persist host-access details and do not own an additional Desktop-private local runtime state directory.
- Desktop and standalone runtime / CLI mode resolve the same Local Environment state directory. Desktop does not invent a second local runtime state root.
- The provider / control-plane model remains environment-first. Whether a provider Environment is linked to the Local Environment for this OS user / Redeven profile state root is a local runtime/Desktop fact, not a provider-side device resource.
- The shell keeps `Top Bar`, `Activity Bar`, and `Bottom Bar` visible before an environment is opened, so startup and active-session flows share the same frame.
- Every cold desktop launch opens the welcome launcher first.
- The launcher always asks the user what to open in this desktop session:
  - the Local Environment
  - compatible provider environments from the catalog
  - a remembered recent Environment
  - a saved Redeven Local UI URL
  - a saved SSH Host entry that Desktop bootstraps on demand
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
  --state-root <absolute-state-root> \
  --local-ui-bind localhost:23998 \
  --startup-report-file <temp-path>
```

Desktop may add user-configured startup flags on top of that base command:

- `--local-ui-bind <host:port>`
- `--state-root <absolute-state-root>`
- `--password-stdin`
- `--controlplane <url>`
- `--env-id <env_public_id>`
- `--bootstrap-ticket-env REDEVEN_DESKTOP_BOOTSTRAP_TICKET`

Behavior:

- Local UI always starts for the Desktop-owned Local Environment runtime that Desktop owns locally.
- `--password-stdin` is the non-interactive desktop-managed password transport.
- Desktop resolves the managed state root before spawn and passes it explicitly to `redeven run`.
- The Desktop-owned local runtime uses `~/.redeven/local-environment/config.json`.
- Desktop startup flows that include a bootstrap target write the same Local Environment config and replace the previous provider binding for that Local Environment profile.
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
- Desktop startup settings do not create a second preference-owned runtime target; the resolved Local Environment state directory remains the runtime source of truth.
- Desktop-managed runtime state never falls back to the Electron process working directory; if no usable home directory exists and no explicit config path is available, startup fails clearly instead of writing inside an arbitrary repository or shell cwd.

When the selected target is `Remote Environment`, Desktop does not start the bundled binary.
Instead it validates and probes the configured Local UI base URL, then opens that exact origin in the shell.

When the selected target is `SSH Host Environment`, Desktop still keeps Redeven Local UI as the only runtime contract.
It does not introduce a second SSH-native file or terminal protocol. Instead, Electron main:

1. Validates the SSH host-access fields.
2. Uses the host `ssh` client in non-interactive batch mode.
3. Opens a shared SSH control socket.
4. Probes whether a compatible Desktop-managed copy of the exact Redeven release is already installed remotely under `releases/<release_tag>/`.
5. If installation is needed, uses one of three bootstrap strategies:
   - `desktop_upload`
   - `remote_install`
   - `auto`
6. Starts `redeven run --mode desktop --desktop-managed --local-ui-bind 127.0.0.1:0` as a detached background process on the SSH host with its mutable runtime state rooted at `local-environment/state/`.
7. Waits for the remote startup report under `local-environment/sessions/<session_token>/startup-report.json`.
8. Creates a local SSH port forward to that remote Local UI port.
9. Opens the forwarded `127.0.0.1:<port>` origin as a normal Desktop session.
10. Marks the Env App session as `ssh_environment` so Web Services treat `localhost` targets as remote-host loopback and open through `/pf/<forward_id>/` instead of the user's browser loopback.

### SSH Host Environment

SSH bootstrap is intentionally transport-light and runtime-heavy:

- Desktop does not introduce a second SSH-native runtime protocol.
- Desktop pins the remote install to the same Redeven release tag as the running desktop build.
- The remote install layout intentionally separates shared release artifacts from mutable environment state:
  - `<install_root>/releases/<release_tag>/bin/redeven`
  - `<install_root>/releases/<release_tag>/desktop-runtime.stamp`
  - `<install_root>/local-environment/state/`
  - `<install_root>/local-environment/sessions/<session_token>/startup-report.json`
- Desktop only reuses a remote runtime when the binary reports that exact release tag and a Desktop-managed runtime stamp in the same release root is valid.
- Each managed version root contains `desktop-runtime.stamp`, which records the stamp schema, the owning shell (`redeven-desktop`), the exact release tag, and the install strategy.
- Desktop intentionally does not adopt arbitrary user-installed `redeven` binaries outside that managed version root, so SSH bootstrap stays side-by-side with direct CLI installs instead of mutating them.
- Mutable runtime state is host-scoped: one SSH host access entry maps to one remote Local Environment profile under the selected install root.
- Desktop does not expose user-editable instance IDs for SSH hosts; using a different host or install root is the intentional way to target a different remote Local Environment profile.
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
- Development builds may set `REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG` to choose the remote runtime release tag used for SSH Host bootstrap. `scripts/dev_desktop.sh` fills this from the latest local `v*` tag when the variable is unset.
- The remote runtime process is intentionally independent from the SSH control command that launched it. Desktop owns the SSH control socket and local port forward, not the remote runtime lifecycle.
- The forwarded localhost URL is session-ephemeral and only used as the live session origin.
- SSH Host data traffic goes through the local SSH tunnel: Desktop opens `127.0.0.1:<local_forward>` and SSH forwards it to the remote runtime's loopback-only Local UI port. No public or LAN-facing host port is required for the Local UI.
- Session identity is derived from SSH destination, SSH port, authentication mode, and remote install directory so reconnecting does not create duplicates just because the forwarded local port changed.
- Closing the Desktop session window, losing the local forward, or quitting Desktop disconnects only the SSH transport. The SSH-hosted runtime keeps running until the user explicitly stops it or the remote host/process exits.
- SSH runtime stop is an explicit launcher/runtime-menu action. If startup is still pending, `Stop runtime` cancels that startup operation instead of reporting that no runtime exists yet. Desktop may reuse an existing live forward or recreate the forward on the next `Open`.
- Long-running SSH bootstrap is represented as a launcher operation with a stable operation key, subject generation, cancel state, and progress snapshot. The renderer receives both the legacy `action_progress` projection and the richer `operations` list.
- Canceling an SSH bootstrap passes an `AbortSignal` through local probes, SSH child processes, remote install/upload commands, startup-report polling, and tunnel verification. Local SSH transport cleanup is bounded; remote upload temp paths are removed best-effort.
- `SSH Destination` accepts either a direct `user@host` target or a Host alias from the user's local SSH config. When a selected Host has a configured `Port`, Desktop fills the Port field while still allowing the user to edit or clear that override.
- SSH bootstrap supports key/agent authentication and a Desktop-owned password prompt mode. Key/agent mode keeps `BatchMode=yes` so missing keys or host-key trust issues surface as actionable launcher errors. Password prompt mode disables batch auth, asks through the OS askpass flow only while starting the runtime, and does not store the SSH password.

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
  - `Environments / Providers` tabs
  - shell-wide open-window and card counts
  - add / close actions
- `Environments` tab:
  - one shared card grid for:
    - the canonical Local Environment
    - provider environment cards stored in `provider_environments` and refreshed from connected providers
    - saved Redeven URL connections
    - saved SSH Host connections
  - compact search + source filter toolbar for `All`, `Local`, `Provider`, `Redeven URL`, `SSH Host`, plus connected-provider filters
  - when pinned entries exist, the launcher keeps explicit `Pinned` and `Environments` sections
  - those sections must still share one measured environment-library column model, so pinning only changes grouping order and never changes card width
  - provider filters and search only change which cards are shown; they must not collapse the underlying card-width system for the current library scope
- `Providers` tab:
  - provider action shelves only
  - provider counts, sync state, and provider-to-environment shortcuts
- activity bar:
  - one item: `Connect Environment`

Interaction rules:

- Cold launch never auto-opens a remembered target.
- Environment choice is always a launcher action, never a side effect of saving settings.
- The Local Environment is one protected first-class card for the current OS user / Redeven profile state root.
- `Environment Settings` opens or focuses the launcher, then presents a modal dialog inside that same window for the selected Local Environment or provider Environment card.
- The `Add` action opens a dialog that can either connect immediately or save a new Environment into the library.
- `New Environment` is a two-mode dialog:
  - `Redeven URL`
  - `SSH Host`
- Local Environment runtime settings are edited from the protected Local Environment card and do not create additional local runtime identities.
- Provider environments stay one card:
  - the route menu may expose `Open remotely`
  - the route menu may expose `Use locally` when the provider Environment can be linked to the Local Environment
  - local access configuration remains owned by the Local Environment settings surface
  - after linking, the same provider card can `Open Local`, `Start runtime`, `Stop runtime`, or `Open remotely`
- Desktop never creates a second visible card or provider-specific local runtime just because a provider Environment is used locally
- SSH Host mode keeps the same compact launcher shell but adds:
  - `Name`
  - `SSH Destination`, as a free-entry combobox backed by concrete Host aliases from the user's local SSH config
  - optional `Port`, displayed beside `SSH Destination` and auto-filled when the selected Host alias defines one
  - `Bootstrap Delivery`
  - compact `Advanced` section for:
    - `Remote Install Directory`
    - `Release Base URL`
- The SSH Host `Advanced` disclosure initializes from the saved connection state once and then stays user-owned while editing, so typing in `Release Base URL` or `Remote Install Directory` does not auto-collapse the section.
- SSH Host mode explains the actual behavior inline:
  - Desktop reuses shared release artifacts for the exact Desktop-managed version and lets the remote host own its own runtime state.
- `Add Provider` opens a separate dialog that accepts:
  - a user-owned local `Name`
  - a `Provider URL`
  - the default `Name` is derived from the provider hostname until the user edits it explicitly
- The launcher defaults to the `Environments` tab and treats opening or rebinding a workspace as the primary task.
- `Providers` moves into its own tab so provider management does not compete with the main workspace open/rebind path.
- Environment cards own the primary actions, so open sessions are reflected through `Open` / `Focus` state directly on the relevant card instead of a separate session rail.
- The Local Environment, provider environments, Redeven URLs, and SSH Host entries all render in the `Environments` tab.
- Connecting or refreshing a Provider updates the provider catalog immediately while the profile keeps its single Local Environment state record.
- `Providers` stays provider-management-only. Each shelf offers `View Environments`, `Reconnect`, `Refresh`, and `Delete`.
- Environment Library cards use one fixed-height layout:
  - header with label, relative timestamp, pin/unpin icon, and status badge
  - compact facts rows tailored to the card family
  - an `Endpoint` block with readonly inputs plus `Copy`
  - pinned and regular sections align to the same card columns whenever both are visible
  - footer actions aligned vertically across card types
- Environment Library pinning is first-class:
  - pinned cards render once inside a dedicated `Pinned` section
  - unpinned cards remain in the regular `Environments` section
- pinning an open unsaved Redeven URL or SSH Host entry implicitly promotes it into the saved Environment Library
- The Local Environment card surfaces:
  - `RUNS ON`
  - `RUNTIME SERVICE`
  - `VERSION`
  - `ACTIVE WORK`
  - `CONTROL PLANE`
- Provider environment cards surface:
  - `RUNS ON`
  - `RUNTIME SERVICE`
  - `VERSION`
  - `ACTIVE WORK`
  - `CONTROL PLANE`
  - `SOURCE ENV`
- Redeven URL cards surface:
  - `RUNS ON`
  - `RUNTIME SERVICE`
  - `VERSION`
  - `ACTIVE WORK`
- SSH Host cards surface:
  - `RUNS ON`
  - `RUNTIME SERVICE`
  - `VERSION`
  - `ACTIVE WORK`
  - `BOOTSTRAP`
Runtime Service rows render only after Desktop has a runtime snapshot for that
card. They use the same stable fact slots across local, provider, Redeven URL,
and SSH Host runtimes; window state stays in action/status chrome instead of
duplicating as a low-value fact row.
- Provider shelves still keep the raw provider runtime details (`status`, `lifecycle_status`, `last_seen_at`) visible in the detail rows, but the primary badge stays consistent with the Environment Library.
- Provider-backed state is freshness-aware instead of being treated as timeless cache:
  - Desktop marks provider catalogs as `fresh`, `stale`, or `unknown`
  - opening the launcher, refocusing it, and waking the device all trigger best-effort provider refresh
  - while the launcher stays visible, Desktop also polls stale providers in the background
- Launcher state is split explicitly between runtime health and window state:
  - every Environment card shows `RUNTIME ONLINE` or `RUNTIME OFFLINE`
  - the primary button is window-only and uses `Open`, `Opening…`, or `Focus`
  - the primary button never starts or stops a runtime implicitly
  - blocked `Open` states can surface either:
    - a click-driven guidance action panel with recovery actions such as `Start Local Environment`, `Start runtime`, or `Use locally`
    - the guidance panel keeps transient inline feedback for `Refresh status` and recovery actions instead of closing through hover/focus loss
    - opening the guidance panel moves keyboard focus into the first recovery action so the panel works as a real interactive surface instead of a hover-only overlay
    - the launcher keeps a dedicated guidance-session state per active blocked environment, so a refresh can stay in context and either show `Runtime is still offline`, render an inline failure, or dismiss itself once `Open` becomes available
    - the launcher also scopes busy state to the affected environment or control plane, so unrelated cards do not inherit disabled/loading affordances during another card's action
    - or a simple unavailable tooltip when Desktop cannot offer a direct local recovery path
  - the Local Environment, the provider Environment currently linked to that profile, and SSH Host entries expose `Start runtime` / `Stop runtime` plus `Refresh runtime status` from the adjacent runtime menu
- provider environments keep route selection explicit in the same menu, including `Open remotely`
  - remote-only provider and Redeven URL entries treat runtime control as observe-only and expose `Refresh runtime status` from the runtime menu
- Runtime health probing uses dedicated contracts instead of route/access inference:
  - the Local Environment, linked-local sessions, SSH forwards, and direct Redeven URLs probe `GET /api/local/runtime/health`
  - Control Plane provider environments use the RCPP batch runtime-health query endpoint
  - per-card refresh and the launcher-wide refresh button re-probe runtime health without mutating window state
- Managed session action state is lifecycle-aware:
  - `Focus` only appears for a session whose lifecycle is truly `open`
  - `Opening…` is disabled and does not imply the window is ready yet
  - closing or failed sessions stop contributing `Focus` immediately
- Environment cards stay concise:
  - card bodies avoid explanatory helper prose under the actions
  - only concrete identifiers, runtime details, badges, explicit `None` placeholders, and notices stay visible inside the card
- Provider Environment cards keep the current Local Environment link target visible even when the source provider environment is offline or later removed.
- Direct Redeven URL cards surface whether the target is a saved record, a recent record, or an open window, and whether it points at this device, a LAN host, or a remote host.
- Direct SSH Host cards keep their type-specific bootstrap facts and forwarded endpoints visible.
- Deleting an Environment Library entry is a first-class action:
  - Desktop blocks deletion while a window for that entry is still open
  - the Local Environment entry is protected and is not deletable from the launcher
  - unlinking a provider Environment clears only that provider binding; the provider card remains if the provider still publishes that Environment
  - deleting a saved Redeven URL or SSH Host entry persists the removal immediately; runtime shutdown, SSH startup cancelation, tunnel disconnect, or remote cleanup never blocks the deletion result
  - if a saved SSH Host is deleted while its bootstrap is running, the card disappears immediately, the operation is marked as belonging to a deleted subject, and Desktop cancels or cleans the startup in the background
  - stale operations must not resurrect deleted connections through recent-entry writes, catalog writes, or old preference snapshots
- Remote library entries distinguish:
  - unsaved remote sessions that are already open
  - auto-remembered recent connections
  - explicitly saved connections
- Open launcher entries switch their primary action from `Open` to `Focus`.
- Recent remote Environments stay one click away after a successful connection.
- Saved remote Environments render in a card grid and can be opened, edited, saved, or deleted inline.
- Saved SSH Host environments render in that same card grid, with the SSH host (`destination[:port]`) and forwarded Local UI both exposed through the Endpoint copy rows.
- Saved Providers render in a separate tab with compact provider-level reconnect/refresh/delete shelves and no nested environment card grid.
- Deleting a Provider persists the local removal immediately, clears local provider transient state, and then revokes the remote authorization and closes provider sessions best-effort in the background. In-flight provider sync checks the provider subject generation before writing preferences or sync errors, so a deleted Provider cannot be restored by an older sync response.
- Provider shelves show the Desktop display label as the primary title while still surfacing the provider product name, origin, published environment count, unified-catalog count, and local-host count.
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
  - success and info feedback such as `Refreshed this provider.` render as toast notifications
  - launcher/opening failures such as `Unable to open that Environment` also render as toasts
  - Desktop does not insert transient success/info/error banners or card-inline notices into the launcher content area
- The shell frame remains visible before connection, but the activity bar keeps only the single `Connect Environment` entry.
- The launcher close action means:
  - `Quit` when no environment is open yet
  - `Close Launcher` when one or more Environment windows are already open
- Quit and last-window-close confirmation models include pending background operations. On quit, Desktop cancels pending SSH startup operations and waits only for bounded best-effort cleanup before exiting.

## Session Child Windows

Desktop session child windows are reserved for legitimate browser-window navigation flows that still belong to the same Environment session.

Current rules:

- Preview, File Browser, and Debug Console stay inside the main Env App window as floating surfaces.
- Session child windows stay owned by the current Environment session instead of becoming shell-global utility windows.
- Focusing or reopening a child window reuses the same session child window identity instead of spawning duplicates.
- Desktop captures a stable window ownership record when each session child window is created, so close/restart cleanup can remove session routing state without touching destroyed Electron objects.

Implication:

- Product-owned Env App tools no longer depend on a second native window contract just to stay above page-level dialogs or floating-window-local confirmation flows.

## Environment Settings

`Environment Settings` is a launcher-owned dialog that opens above `Connect Environment` inside the same native window.

It edits only future startup behavior for the profile's Local Environment:

- `local_ui_bind`
- `local_ui_password`

Rules:

- Saving options only persists configuration.
- Saving options does not switch Environments.
- Cancel closes the dialog and returns the launcher to `Connect Environment`.
- The Local UI password input is write-only. When Desktop already has a stored password, the field stays blank and blank means `keep the stored password`.
- Removing a stored password requires an explicit remove action. Simply seeing an empty write-only field must not clear the stored secret.
- The dialog starts with a workbench-style overview that shows:
  - the current Local Environment runtime address
  - the next-start address and protection state
  - a compact summary grid for visibility, next-start address, and password state
- Summary-card details and field-level help stay available through compact question-mark tooltip affordances instead of always-visible helper paragraphs.
- Those tooltips render through the shared overlay portal so hover/focus help is visible above cards and dialogs instead of relying on browser-native `title` text.
- The first decision is a visibility intent, not a raw bind field:
  - `Local only`
  - `Shared on your local network`
  - `Custom exposure`
- The UI maps that intent back onto the existing runtime contract (`local_ui_bind` + `local_ui_password`) before saving, but it keeps port selection as a separate control.
- `Access & Security` presents those visibility options as selectable preset cards rather than a dense field-only form.
- The settings dialog always shows the current Local Environment runtime URL separately from the next-start configuration when the Local Environment is already running.
- The main editor uses a wider two-column card layout so visibility changes keep the form aligned instead of reflowing a long stack of helper text.
- Password handling becomes explicitly stateful:
  - current password state is visible through summary chips
  - replacing a password is expressed as a queued replacement
  - removing a stored password remains an explicit action
- Provider environments reuse the same settings surface for local access, but the provider identity itself stays fixed. The editable part is only the Local Environment's Local UI exposure that Desktop will request the next time it links or opens that provider Environment locally.

## Desktop Preferences

Desktop keeps one current persisted preference model for the profile's Local Environment, provider catalog cards, and saved remote connections. The Electron user-data `desktop-preferences.json` file is only a lightweight version marker; the durable current schema lives in the shared catalog and secrets files:

- `local_environment`
- `provider_environments`
- `saved_environments`
- `saved_ssh_environments`
- `control_plane_refresh_tokens`
- `control_planes`

Semantics:

- Loading preferences reads only the current catalog schema.
- Saving preferences writes only the canonical `catalog/local-environment.json`, `catalog/provider-environments/*.json`, connection/provider catalog files, and `desktop-secrets.json.local_environment`.
- Desktop does not persist a remembered current target for the next launch.
- Open Environment windows are runtime-only desktop session state.
- Runtime health is a separate launcher snapshot concern. Window closure alone must not be used as a proxy for stopping a runtime.
- `local_environment` stores the protected Local Environment entry for this OS user / Redeven profile state root:
  - Local Environment local-hosting access configuration
  - user-visible title (persisted internally as `label`)
  - pin and timestamp metadata
- `provider_environments` stores one first-class record per provider-backed environment:
  - `{ provider_origin, provider_id, env_public_id }`
  - provider-published metadata and cached remote catalog state
  - `preferred_open_route`
  - `pinned`
  - `last_used_at_ms`
- Desktop never sends the stored Local UI password plaintext back to the renderer. The shell UI edits only a write-only replacement draft plus explicit keep/replace/remove intent.
- `saved_environments` stores user-visible labels, normalized Local UI URLs, pin state, and `last_used_at_ms`.
- `saved_ssh_environments` stores user-visible labels, normalized SSH destination data, the remote install directory, the SSH bootstrap delivery mode, the optional release mirror base URL, pin state, and `last_used_at_ms`.
- `last_used_at_ms` is the only recency signal for saved connections; Desktop sorts and refreshes the saved catalog from that timestamp instead of maintaining a separate derived catalog.
- `control_plane_refresh_tokens` stores per-provider opaque refresh tokens in the local secrets file, separate from visible provider/account metadata.
- `control_planes` stores normalized provider discovery data, the desktop-owned display label, the desktop account snapshot, the cached environment list, and the last sync time.
- Provider refresh reconciles canonical provider identity across `provider_environments`, but does not materialize remote-only provider environments into Local Environment state.
- Secrets are stored in Desktop’s local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise the files remain local-only user data owned by the current account.
- The Local Environment entry remains always available in Desktop; ordinary editing changes only local access settings and never creates another local runtime identity.

Desktop maps user-facing local-access decisions back onto the same runtime contract:

- Default `Local only` -> `localhost:23998` with no password
- Default `Shared on your local network` -> `0.0.0.0:23998` with a password baseline
- `Custom exposure` -> raw bind/password editing
- Advanced `Local only` may opt into `127.0.0.1:0`, which the UI presents as `Auto-select an available port` instead of surfacing `:0` directly

Desktop semantics:

- Visibility and port selection are separate controls.
- `Local only` and `Shared on your local network` share the same fixed default port baseline.
- The saved configuration applies to the next managed start; the currently running managed URL is displayed separately when available.
- One Local Environment runtime may be active for the signed-in user / profile state root. Linking another provider Environment replaces the prior local provider binding.
- Provider environments never persist provider-specific local runtime configuration; Desktop derives linked-local readiness from the single Local Environment runtime and its current provider binding.
- If Desktop attaches to a runtime that was started by standalone runtime / CLI mode, that attached runtime stays externally owned: closing the Desktop session only detaches, and restart/update stay delegated to the host process that owns that runtime.
- Launcher runtime ownership is explicit on the environment card: externally owned runtimes surface as attachable local runtimes, while the Local Environment surfaces as the Desktop-owned local runtime.
- Launcher Runtime Service details are stable card facts, not banners. When a runtime snapshot is available, all runtime types can show service state, runtime version, and active work counts in the existing fact grid.
- Standalone runtime / CLI and Desktop sessions stay interoperable because both read and write the same Local Environment runtime layout.

Runtime Service snapshots are carried through the same attach and startup paths that already describe Local UI:

- `runtime/local-ui.json`
- `--startup-report-file`
- `/api/local/runtime/health`
- `/api/local/runtime`
- `sys.ping` after Env App connects

The snapshot is intentionally non-secret and uses snake_case fields such as `runtime_version`, `protocol_version`, `service_owner`, `desktop_managed`, `effective_run_mode`, `remote_enabled`, `compatibility`, and `active_workload`. Desktop treats it as service identity and maintenance context, not as a second runtime protocol.

Target validation rules:

- External targets must use an absolute `http://` or `https://` URL.
- The host must be `localhost` or an IP literal.
- The shell normalizes the configured target to the Local UI origin root.
- SSH Host destinations accept `[user@]host` or SSH config host aliases.
- SSH ports must be valid TCP ports when present.
- SSH environment instance IDs must use 6-64 lowercase letters, numbers, `_`, or `-`.
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
- provider Environment open session: `POST /api/rcpp/v1/environments/:env_public_id/desktop/open-session`
- runtime bootstrap exchange: `POST /api/rcpp/v1/runtime/bootstrap/exchange`

Public provider protocol references:

- formal RCPP v1 specification: [`docs/protocol/rcpp-v1.md`](protocol/rcpp-v1.md)
- machine-readable OpenAPI: [`docs/openapi/rcpp-v1.yaml`](openapi/rcpp-v1.yaml)

Desktop assumptions:

- The provider either implements the fixed contract or it does not.
- Desktop does not ask the provider for a capability matrix.
- Runtime features still come from the runtime itself, not from provider feature declarations.
- Desktop sends provider HTTP requests from Electron main through Chromium's network stack so certificate trust, proxies, and DNS behavior stay aligned with the local browser session.
- For local development over HTTPS, the device running Desktop must trust the development CA that issued the provider certificate.

The Control Plane flow is:

1. Desktop discovers the provider from its origin.
2. Desktop opens the provider's browser bridge page at `/desktop/connect`.
3. Desktop generates a local PKCE `state + code_verifier + code_challenge`.
4. The browser session requests a short-lived `authorization_code` and deep-links back to Desktop.
5. Desktop exchanges `authorization_code + code_verifier` for a short-lived in-memory access token plus a long-lived revocable refresh token.
6. Desktop loads `me` and `environments` with the access token.
7. Desktop stores the provider catalog in `control_planes[*].environments` and reconciles it into first-class `provider_environments` records.
8. Desktop refreshes access tokens on demand with the stored refresh token.
9. Desktop requests a provider Environment open session only when it opens a specific provider environment or needs bootstrap data to link that provider Environment to the Local Environment.
10. For a remote provider card, Desktop opens the returned `remote_session_url` directly without persisting a remote-only Local Environment state first.
    - The top-level remote session page may in turn host the Env App inside a same-origin boot iframe.
    - Embedded same-origin Env App documents must still inherit the desktop shell bridges and window-chrome contract from the owning session window, so titlebar safe areas, theme state, and environment-scoped renderer storage stay identical to direct desktop-hosted sessions.
11. For a provider environment used locally, Desktop uses the returned one-time `bootstrap_ticket` to link the bundled Local Environment runtime for the current profile state root.
12. Rebinding replaces the previous local provider binding; Desktop never materializes a second local runtime state directory for another provider environment.

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
- Preload exposes `window.redevenDesktopWindowChrome` with a synchronous snapshot of the platform-aware titlebar contract so same-origin embedded renderer documents can consume the same safe-area data as the top-level session page.
- Preload also publishes the desktop chrome contract through CSS custom properties:
  - `--redeven-desktop-titlebar-height`
  - `--redeven-desktop-titlebar-start-inset`
  - `--redeven-desktop-titlebar-end-inset`
- Preload also publishes generic desktop-window titlebar hooks so renderer shells can consume the same contract without per-scene platform logic:
  - `[data-redeven-desktop-window-titlebar='true']`
  - `[data-redeven-desktop-window-titlebar-content='true']`
- Floe shell top bars and desktop-owned launcher chrome both receive drag / no-drag semantics from preload so BrowserWindow movement keeps working after the app takes over the title bar area.
- When a desktop-managed remote session renders Env App through a same-origin iframe, the embedded document resolves desktop theme, session context, state storage, and window chrome from its host session window instead of falling back to plain browser semantics.
- In that same-origin iframe case, safe-area styling and native drag ownership are intentionally split:
  - the embedded Env App computes the final draggable rectangles from the shared desktop titlebar drag/no-drag hooks;
  - app-owned floating surfaces mark their geometry root and visible panel with `[data-redeven-desktop-titlebar-no-drag='true']`, so the drag-region bridge subtracts them from any overlapping titlebar drag rectangle even when the surface is rendered through a body portal rather than inside the top bar subtree;
  - app-owned floating surfaces also consume the desktop titlebar height as a shared `FloatingWindow` viewport inset, so default placement, restored persisted geometry, drag, resize, maximize, and restore all avoid the native titlebar safe area through one geometry contract;
  - the session preload running in the top-level Desktop document turns those rectangles into transparent top-level `app-region: drag` overlays;
  - Electron window movement always stays owned by the top-level session document, never by iframe DOM alone.
- The drag-overlay bridge is exposed only from the top-level session document. Electron loads the same preload into same-window iframes too, so subframes must publish drag intent upward instead of trying to own native drag hit-testing themselves.
- Session child windows still render through the same shell-owned chrome and theme bridge contract as their owning Environment window.
- Welcome and desktop Env App route only the Floe `theme` persistence key through the shell bridge; other UI state stays in their normal storage namespaces.
- Welcome and Env App each keep an explicit entry-document background fallback (`html` / `body` / `#root`) so the first renderer frame matches the shell-owned native window background even before business UI mounts.
- Theme toggles from either welcome or Env App update native chrome and all registered renderer windows together, including session child windows.
- When the stored source is `system`, Electron main rebroadcasts a fresh snapshot whenever the OS theme changes.

Non-goals:

- Native window colors must not depend on DOM color sampling from the current page.
- Native window colors must not use renderer-only CSS syntaxes that are not part of the desktop shell’s native hex-color contract.
- Desktop should not maintain one-off per-surface theme patches for welcome, Env App, or session child windows.

## User Entry Points

- Cold app launch opens the singleton launcher window.
- The native app menu exposes one primary shell action: `Connect Environment...`
- The native app menu also preserves OS-owned window-command roles for close, full screen, and window management, so custom desktop headers do not replace native shortcut inheritance.
- `Quit Redeven Desktop` resolves the current quit impact before shutdown instead of relying on a generic fixed warning.
- If Desktop still owns one or more managed runtimes, the quit confirmation states the concrete shutdown impact in one concise sentence and only keeps a short secondary note when externally managed runtimes remain unaffected.
- On macOS, closing the final Desktop window keeps the app running, but Desktop now warns before the last window disappears when that close would hide the active environment surface or leave Desktop-managed runtimes running in the background.
- Desktop-owned quit and final-window-close confirmations now use the platform-native system dialog surface, so macOS, Windows, and Linux each keep their expected shutdown affordances.
- On non-macOS platforms, closing the final Desktop window uses that same quit-impact protection before the app is allowed to exit and stop Desktop-owned runtimes.
- Shell window aliases such as `connect` route to the same welcome launcher.
- Compatible providers may also enter through the registered `redeven://` deep-link scheme.
- Generic settings aliases such as `advanced_settings` route to the launcher-owned `Environment Settings` dialog.
- After Local UI opens inside Redeven Desktop, Env App still exposes shell-owned window actions through the desktop browser bridge.
- `Switch Environment` focuses or opens the singleton launcher instead of replacing the active Environment session window.
- `Runtime Settings` focuses or opens the singleton launcher and presents the `Environment Settings` dialog instead of creating a second native window.
- The desktop browser bridge also exposes a dedicated managed-runtime restart action for `Restart runtime`; it is separate from window-navigation actions.
- The desktop browser bridge also exposes shell-owned native window commands for explicit renderer actions, including `close`, while keyboard shortcut inheritance remains owned by the Electron app menu roles.
- The desktop browser bridge also exposes an explicit external-URL action for workflows that must leave the Electron shell and continue in the system browser.
- Env App exposes `Switch Environment` and `Runtime Settings` through the desktop browser bridge when the desktop shell bridge is available.
- Env App Codespaces uses that external-URL bridge when the desktop shell is present, so `Open` launches the selected codespace in the system browser instead of an Electron child window.
- When the desktop-managed Local UI is password-protected, the first protected Codespaces request may rely on `redeven_access_resume` instead of an existing browser cookie. Local UI exchanges that resume token into the normal local access cookie on the first protected response so the rest of the codespace page load stays on the same same-origin browser session.
- Env App `Runtime Settings` stays separate from shell-owned Environment selection and desktop-managed startup state.

## Error Recovery

- Remote target unreachable
  - Desktop tears down the failed opening session, keeps the launcher stable, and shows a toast with the preserved target context
- SSH bootstrap failed
  - Desktop tears down the failed opening session, preserves the SSH Host entry and instance context in diagnostics, and reports the failure through toast feedback
- Desktop-managed startup blocked
  - Desktop returns to the launcher with structured recovery state and toast feedback instead of opening a blank Environment window
- Session child windows stay session-scoped during recovery, while Ask Flower and other floating-tool actions stay in the owning Environment window
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

- Desktop-managed Local UI exposes `desktop_managed`, `effective_run_mode`, `remote_enabled`, and the normalized Runtime Service snapshot through local runtime/version endpoints.
- When the runtime reports a desktop-owned release policy, Env App turns `Update Redeven` into `Manage in Desktop`.
- Env App keeps `Restart runtime` only for Desktop-owned managed runtimes.
- When Desktop is attached to an externally owned local runtime, restart and update hand off to the owning host process instead of trying to stop that runtime from Electron, and Desktop quit warnings do not claim that external runtime as a Desktop-owned shutdown.
- When a desktop-managed restart finishes, Env App recovers in place through the same shell-owned reconnect/access-gate flow used by other reconnect scenarios.
- If the restarted runtime requires password verification again, the same page asks for the Local UI password instead of requiring a manual browser refresh.
- Desktop resolves update impact before continuing:
  - Desktop-owned local and provider sessions may require a Desktop restart and reopen flow
  - SSH-hosted Local Environment profiles only affect that one SSH Host entry and remote install root
  - external Redeven URL targets stay externally managed and do not offer a Desktop-side runtime update action
- Session child windows keep using the same Env App runtime, access gate, and Flowersec protocol path; only the shell-owned launcher/options surfaces differ.
- Shell-owned utility windows and session-owned child windows both clear their routing ownership from the same stable window record, so normal close actions stay silent instead of surfacing Electron lifecycle errors.

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
