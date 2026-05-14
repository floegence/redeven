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

- Electron is a thin shell around Redeven Local UI. The bundled-runtime entrypoint is `redeven run --mode desktop --desktop-managed`.
- Desktop owns one Local Environment for the current OS user / Redeven profile state root. Desktop and standalone CLI/runtime mode share the same state directory and profile catalog under `~/.redeven/`.
- The launcher is a singleton shell-owned window. Each opened Environment owns its own session window, and reopening the launcher never disconnects existing sessions.
- Session identity is keyed by target type: managed Local Environment/provider route, saved Local UI URL, or SSH Host entry.
- Provider integrations use the fixed public RCPP v1 contract. `provider_id` comes from discovery and is reused in protocol payloads, catalog records, and bindings.
- Saved Redeven URL and SSH Host entries are connection records. SSH Host entries persist host-access details but do not create a separate Desktop-private runtime state root.
- Env App receives a Desktop-owned session context so it can scope renderer UI state and choose the correct Web Services route for local, remote, or SSH-hosted sessions.
- Common startup failures return to the launcher with contextual recovery actions; Electron allows session-owned navigation only to the reported Local UI origin and opens unrelated URLs in the system browser.

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
- `REDEVEN_DESKTOP_OWNER_ID` in the child process environment

Behavior:

- Local UI always starts for the Desktop-owned Local Environment runtime that Desktop owns locally.
- `--password-stdin` is the non-interactive desktop-managed password transport.
- Desktop creates one stable, non-secret runtime owner id in Electron `userData` and passes it only to Desktop-managed runtimes through `REDEVEN_DESKTOP_OWNER_ID`.
- Desktop resolves the managed state root before spawn and passes it explicitly to `redeven run`.
- The Desktop-owned local runtime uses `~/.redeven/local-environment/config.json`.
- The Welcome `Start Runtime` action always starts this runtime local-only. It does not add provider bootstrap flags, request provider open-session material, or connect the runtime to a provider control plane.
- `--controlplane`, `--env-id`, and `--bootstrap-ticket-env` remain explicit CLI/manual bootstrap inputs. They are not part of the Welcome Local Environment `Start Runtime` path.
- Desktop attach probing reads `runtime/local-ui.json` from the same resolved state root as the spawned config path.
- Provider `Open` is a window/navigation action. It can open a remote route or, only after an explicit provider link already exists, open the provider Environment locally. It never silently starts the Local Runtime and never silently connects the Local Runtime to a provider.
- A Desktop-managed runtime is lifecycle-owned by this Desktop only when `desktop_owner_id` matches the current Desktop owner id. Runtimes owned by another Desktop instance or an external CLI process are not silently adopted.
- Desktop may restart an older Desktop-owned runtime for lifecycle maintenance only when Runtime Service reports no active workload. Provider binding changes are not implemented by restarting the runtime.
- If active workload is present, Desktop keeps `Open` blocked and shows interruption-safe guidance instead of closing terminals, sessions, tasks, or port forwards implicitly.
- The Local UI password stays out of process args and environment variables.
- Provider one-time bootstrap tickets stay out of process args and renderer state. Welcome provider linking passes them from Electron main to the running runtime through the desktop-only runtime-control endpoint.
- Desktop startup reports and attachable runtime state include a non-secret `password_required` boolean so launcher and attach flows can describe whether the current runtime is protected.
- Remote provider control is enabled only after a successful explicit provider-link operation or an explicit non-Welcome bootstrap launch.
- `--desktop-managed` disables CLI self-upgrade semantics.
- Desktop-owned managed-runtime restart stays available, but it is owned by Electron main rather than runtime self-`exec`.
- Managed restart reuses Desktop-owned startup preferences, including `--password-stdin`, and preserves the current resolved loopback bind when the saved bind uses the advanced auto-port loopback option such as `127.0.0.1:0`.
- `--startup-report-file` lets Electron wait for a structured desktop launch report instead of scraping terminal output.
- On lock conflicts, the runtime first tries to attach to an existing Local UI from the same state directory before reporting a blocked launch outcome.
- Desktop startup settings do not create a second preference-owned runtime target; the resolved Local Environment state directory remains the runtime source of truth.
- Desktop-managed runtime state never falls back to the Electron process working directory; if no usable home directory exists and no explicit config path is available, startup fails clearly instead of writing inside an arbitrary repository or shell cwd.

Desktop-managed Local Runtime also exposes a separate runtime-control endpoint when it is started by Desktop:

- It listens on a random loopback-only address (`127.0.0.1:0`).
- It uses a random bearer token plus the Desktop owner id.
- The endpoint appears in the startup report and `runtime/local-ui.json` for Electron main to consume.
- The bearer token is not exposed to the renderer, Env App JavaScript, provider pages, Local UI HTTP responses, or process arguments.
- Provider link operations use `GET /v1/provider-link`, `POST /v1/provider-link/connect`, and `POST /v1/provider-link/disconnect` on this endpoint.
- Successful `connect` updates the Local Runtime config and starts or replaces the provider control-channel goroutine without restarting Local UI, local direct sessions, terminals, tasks, or port forwards.
- `disconnect` stops only the provider control channel and clears the persisted provider binding. It does not stop the Local Runtime.

When the selected target is `Remote Environment`, Desktop does not start the bundled binary.
Instead it validates and probes the configured Local UI base URL, then opens that exact origin in the shell.

When the selected target is `SSH Host Environment`, Desktop still keeps Redeven Local UI as the only runtime contract.
It does not introduce a second SSH-native file or terminal protocol. Electron main validates the SSH entry, opens an SSH control connection, installs or reuses the pinned Desktop-managed Redeven release on the host, starts `redeven run --mode desktop --desktop-managed --local-ui-bind 127.0.0.1:0` remotely, verifies the reported Runtime Service snapshot, and forwards the remote Local UI back to the user's machine.

The SSH Host open flow stays two-step: startup prepares or attaches the runtime, and the user still chooses `Open` before Desktop opens the forwarded Local UI origin. Env App receives an `ssh_environment` session context so Web Services treat remote-host `localhost` targets as remote loopback and open through `/pf/<forward_id>/`.

If the Desktop Local Environment has usable Flower provider settings, Desktop also starts a short-lived loopback-only AI broker on the user's machine before launching or attaching the SSH runtime. The broker reads the Desktop Local Environment's `config.json` and `secrets.json`, exposes only model-list and model-stream endpoints, and never exposes files, terminals, ports, or Desktop IPC to the remote host. Desktop attaches that broker to the same SSH control connection with a reverse-forwarded loopback endpoint, then binds the forwarded broker URL plus a short-lived token to the running runtime over the trusted Local UI runtime-control route. The broker token is never passed as a remote `redeven run` command argument and is not written to remote config, secrets, or logs.

This Desktop AI Broker is a session capability, not a persisted remote configuration:

- Provider API keys stay in the Desktop Local Environment's local `secrets.json`.
- The SSH host's `local-environment/state/config.json` does not receive an `ai` block, an `enabled` flag, or any provider secret.
- Remote tools still run inside the SSH-hosted runtime and remain governed by the remote session's `session_meta` plus local `permission_policy`.
- If the Desktop source is unavailable or binding fails, the SSH runtime still starts; Flower uses the remote runtime's own AI config only when that config exists.
- Env App surfaces the split explicitly as model sources `Remote runtime` and `Desktop`, tools location `SSH Host`, and Runtime Service binding state `bound` / `unbound` / `unsupported` / `error` / `expired`.
- The SSH connection progress UI treats Desktop model preparation as optional. Stopping the progress overlay means stopping the opening attempt, not disabling a model source permanently.

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
- The remote install path defaults to the remote user's cache and can be overridden with an absolute path.
- Desktop can probe the remote OS/architecture (`linux` / `darwin`, `amd64` / `arm64` / `arm` / `386`) and choose the matching release package for desktop-managed upload.
- `desktop_upload` verifies the signed `SHA256SUMS` manifest before trusting release-asset checksums.
- `release_base_url` lets operators point the desktop-upload path at a compatible internal release mirror instead of public GitHub Releases.
- Compatible internal mirrors must expose the same signed manifest and `redeven_<goos>_<goarch>.tar.gz` assets as public releases.
- Desktop-side release downloads use explicit timeouts so restricted-network failures stay bounded and diagnosable.
- `auto` prefers desktop upload for restricted networks, then falls back to the remote installer path only when desktop-side asset preparation fails before upload/install begins.
- After Desktop starts uploading or installing the tarball over SSH, later failures stay first-class errors instead of silently degrading into `remote_install`.
- Development builds may set `REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG`; otherwise `scripts/dev_desktop.sh` falls back to the local Desktop bundle version or `v0.0.0-dev`.
- The remote runtime process is intentionally independent from the SSH control command that launched it. Desktop owns the SSH control socket and local port forward, not the remote runtime lifecycle.
- The forwarded localhost URL is session-ephemeral and only used as the live session origin.
- SSH Host data traffic goes through the local SSH tunnel: Desktop opens `127.0.0.1:<local_forward>` and SSH forwards it to the remote runtime's loopback-only Local UI port. No public or LAN-facing host port is required for the Local UI.
- Session identity is derived from SSH destination, SSH port, authentication mode, and remote install directory so reconnecting does not create duplicates just because the forwarded local port changed.
- Closing the Desktop session window, losing the local forward, or quitting Desktop disconnects only the SSH transport. The SSH-hosted runtime keeps running until the user explicitly stops it or the remote host/process exits.
- SSH runtime stop is an explicit launcher/runtime-menu action. Pending startup can be canceled, and cleanup failures remain visible instead of being collapsed into a generic failure.
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

Launcher model:

- Cold launch never auto-opens a remembered target. Environment choice is always a user action.
- The `Environments` view contains the protected Local Environment, provider environments, saved Redeven URL entries, and saved SSH Host entries. Provider management stays separate from the main open/rebind path.
- `Environment Settings` is launcher-owned and edits startup behavior for the profile Local Environment; saving settings never switches Environments or creates another local runtime identity.
- Provider cards keep route choice explicit. A provider Environment may open remotely or link/use the singleton Local Environment locally, but Desktop never creates a second provider-specific local runtime.
- Local and Provider cards have independent action semantics. The primary card action slot is always `Open`; it may open a route or show a prerequisite popup, but it does not change into `Start Runtime`, `Connect`, or `Restart`.
- `Start Runtime` appears only in the Local Environment card's `Open` prerequisite popup and its dropdown menu. Provider cards do not expose `Start Runtime`.
- `Connect Local Runtime` appears only on provider Environment controls and is the only Welcome action that connects the running Local Runtime to that provider Environment.
- If a provider card is configured for local use but the Local Runtime is not linked to that provider Environment, `Open` shows route guidance and an explicit `Connect Local Runtime` action. It does not auto-link and does not auto-start the runtime.
- SSH Host entries store the destination, optional port, bootstrap delivery mode, remote install directory, and optional release mirror base URL. Desktop reuses release artifacts for the exact Desktop-managed version and lets the remote host own its runtime state.
- Runtime health and window state are separate. Cards may show runtime status/version/workload from runtime snapshots, while primary actions stay window-scoped (`Open`, `Opening...`, `Focus`).
- Runtime health is probed through explicit contracts: Local UI health for local/URL/SSH targets and RCPP runtime-health queries for provider environments.
- Deleting library entries is immediate and subject-owned: Local Environment is protected, open entries cannot be deleted, provider unlink clears only the local binding, and deleting saved URL/SSH entries cannot be blocked by background runtime cleanup.
- Transient success/failure feedback uses toasts. Blocking recovery uses explicit actions instead of raw IPC errors or hover-only UI.
- Quit and last-window-close confirmation models include pending background operations; SSH startup cancellation is bounded and cleanup failures remain visible.

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
- The first decision is a visibility intent, not a raw bind field:
  - `Local only`
  - `Shared on your local network`
  - `Custom exposure`
- The UI maps that intent back onto the existing runtime contract (`local_ui_bind` + `local_ui_password`) before saving, but it keeps port selection as a separate control.
- The settings dialog always shows the current Local Environment runtime URL separately from the next-start configuration when the Local Environment is already running.
- Password handling is stateful: the current state is visible, replacement is explicit, and removal is a separate action.
- Provider environments reuse the same settings surface for local access, but the provider identity itself stays fixed. The editable part is only the Local Environment's Local UI exposure that Desktop will request the next time it links or opens that provider Environment locally.

## Desktop Preferences

Desktop keeps one current persisted preference model for the profile's Local Environment, provider catalog cards, and saved remote connections. The Electron user-data `desktop-preferences.json` file is only a lightweight version marker; the durable current schema lives in the shared catalog and secrets files:

Durable preference categories:

- `local_environment`: the protected Local Environment entry and its local-hosting access configuration.
- `provider_environments`: first-class provider-backed environment records keyed by provider origin/id and environment id.
- `saved_environments`: saved Local UI URL connections.
- `saved_ssh_environments`: saved SSH Host connections and their bootstrap settings.
- `control_planes`: provider discovery/account/catalog metadata.
- `control_plane_refresh_tokens`: opaque provider refresh tokens in the local secrets file.

Semantics:

- Loading preferences reads the current catalog schema; Desktop does not persist a remembered current target for the next launch.
- Open Environment windows are runtime-only session state. Runtime health is a separate launcher snapshot and window closure alone never means the runtime stopped.
- Desktop never sends the stored Local UI password plaintext back to the renderer. The shell UI edits only a write-only replacement draft plus explicit keep/replace/remove intent.
- Secrets live in Desktop local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise they remain local-only user data owned by the current account.
- Provider refresh reconciles canonical provider identity across provider environment records, but does not materialize remote-only provider environments into Local Environment state.
- The Local Environment entry remains always available; ordinary editing changes only local access settings and never creates another local runtime identity.

Desktop maps user-facing local-access decisions back onto the same runtime contract:

- Default `Local only` -> `localhost:23998` with no password
- Default `Shared on your local network` -> `0.0.0.0:23998` with a password baseline
- `Custom exposure` -> raw bind/password editing
- Advanced `Local only` may opt into `127.0.0.1:0`, which the UI presents as `Auto-select an available port` instead of surfacing `:0` directly

Desktop semantics:

- Visibility and port selection are separate controls.
- The saved configuration applies to the next managed start; the currently running managed URL is displayed separately when available.
- One Local Environment runtime may be active for the signed-in user / profile state root. Connecting a provider Environment is an explicit runtime-control operation against that singleton runtime.
- Provider environments never persist provider-specific local runtime configuration; Desktop derives linked-local readiness from the single Local Environment runtime and its current provider binding.
- Standalone runtime / CLI and Desktop sessions stay interoperable because both read and write the same Local Environment runtime layout.
- Externally owned runtimes stay externally owned: Desktop can attach, but restart/update remain delegated to the owner.

Runtime Service snapshots are carried through the same attach and startup paths that already describe Local UI:

- `runtime/local-ui.json`
- `--startup-report-file`
- `/api/local/runtime/health`
- `/api/local/runtime`
- `sys.ping` after Env App connects

The snapshot is intentionally non-secret and uses snake_case fields such as `runtime_version`, `runtime_commit`, `runtime_build_time`, `protocol_version`, `service_owner`, `desktop_managed`, `desktop_owner_id`, `effective_run_mode`, `remote_enabled`, `compatibility`, `active_workload`, `capabilities`, and `bindings`. Desktop treats it as service identity, maintenance context, and live attach capability state, not as a second runtime protocol.

For SSH Host sessions, Desktop validates the final running snapshot before reuse. If an attached runtime lacks required capabilities, Desktop replaces it only when the reported workload is idle and the process can be stopped; otherwise it blocks open with explicit restart/update guidance.

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
9. Desktop requests a provider Environment open session only when it opens a specific provider environment remotely or when the user explicitly connects that provider Environment to the Local Runtime.
10. For a remote provider card, Desktop opens the returned `remote_session_url` directly without persisting a remote-only Local Environment state first.
    - The top-level remote session page may in turn host the Env App inside a same-origin boot iframe.
    - Embedded same-origin Env App documents must still inherit the desktop shell bridges and window-chrome contract from the owning session window, so titlebar safe areas, theme state, and environment-scoped renderer storage stay identical to direct desktop-hosted sessions.
11. For an explicit provider-local connection, Desktop sends the returned one-time `bootstrap_ticket` to the running Local Runtime through the desktop-only runtime-control endpoint.
12. The runtime exchanges that ticket, persists the provider binding only after the exchange succeeds, and starts the provider control channel without restarting the runtime.
13. Rebinding is blocked while provider-originated work is active. Desktop never materializes a second local runtime state directory for another provider environment.

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
- `theme_source` is one of `system`, `light`, or `dark`.
- Electron main resolves `resolved_theme` from `theme_source` plus `nativeTheme.shouldUseDarkColors`.
- Electron main materializes one `DesktopThemeSnapshot` payload:
  - `source`
  - `resolvedTheme`
  - `window.backgroundColor`
  - `window.symbolColor`

Native window contract:

- `window.backgroundColor` and `window.symbolColor` are native-window colors, not generic CSS theme strings.
- The desktop shell treats those fields as hex-only values so they remain safe for Electron native-window APIs.
- Renderer page tokens still come from the broader desktop palette, but Electron-native APIs must not depend on CSS-only color syntax or DOM sampling.

Behavior:

- Every `BrowserWindow` is created from the latest shell snapshot, so the native window background is correct before the first renderer paint.
- Desktop main resolves one platform-aware window chrome contract per process, including titlebar mode, controls side, titlebar height, and renderer safe insets.
- Preload exposes `window.redevenDesktopTheme` and `window.redevenDesktopWindowChrome`, applies early document theme classes/backgrounds, and publishes titlebar safe-area CSS variables for renderer shells.
- Floe shell top bars and desktop-owned launcher chrome both receive drag / no-drag semantics from preload so BrowserWindow movement keeps working after the app takes over the title bar area.
- When a desktop-managed remote session renders Env App through a same-origin iframe, the embedded document resolves desktop theme, session context, state storage, and window chrome from its host session window instead of falling back to plain browser semantics.
- Same-origin embedded Env App documents publish drag-region intent upward; the top-level session document owns native drag hit-testing and subtracts app-owned floating surfaces from draggable titlebar regions.
- Session child windows render through the same shell-owned chrome and theme bridge contract as their owning Environment window.
- Welcome and desktop Env App route only the Floe `theme` persistence key through the shell bridge; other UI state stays in their normal storage namespaces.
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

- Desktop-managed Local UI exposes `desktop_managed`, `desktop_owner_id`, `effective_run_mode`, `remote_enabled`, and the normalized Runtime Service snapshot through local runtime/version endpoints.
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

Desktop packages are part of the public GitHub Release artifact set; see [`RELEASE.md`](RELEASE.md) for the authoritative asset list and verification contract.

Windows Desktop packaging is intentionally out of scope for this repository.

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
