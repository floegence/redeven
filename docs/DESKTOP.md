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

- Electron is a thin shell around Redeven Local UI. The bundled-runtime entrypoint is `redeven run --mode desktop --desktop-managed --presentation machine`.
- Desktop owns one Local Environment for the current OS user / Redeven profile state root. Desktop and standalone CLI/runtime mode share the same state directory and profile catalog under `~/.redeven/`.
- The launcher is a singleton shell-owned window. Each opened Environment owns its own session window, and reopening the launcher never disconnects existing sessions.
- Session identity is keyed by target type: managed Local Environment/provider route, saved Local UI URL, or SSH Host entry.
- Provider integrations use the fixed public RCPP v1 contract. `provider_id` comes from discovery and is reused in protocol payloads, catalog records, and bindings.
- Saved Redeven URL and SSH Host entries are connection records. SSH Host entries persist host-access details but do not create a separate Desktop-private runtime state root.
- Env App receives a Desktop-owned session context so it can scope renderer-local UI state and choose the correct Web Services route for local, remote, or SSH-hosted sessions.
- Common startup failures return to the launcher with contextual recovery actions; Electron allows session-owned navigation only to the reported Local UI origin and opens unrelated URLs in the system browser.

## Runtime Contract

Desktop packages always start the bundled binary through `redeven run --mode desktop --desktop-managed --presentation machine`.

The base launch shape is:

```bash
redeven run \
  --mode desktop \
  --desktop-managed \
  --presentation machine \
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

- Desktop is a view and control panel for runtimes the user can manage from this device. It does not act as a background supervisor for automatic start, stop, restart, or update work.
- Local UI starts for the Local Environment runtime selected by the user through an explicit runtime action.
- `--password-stdin` is the non-interactive desktop-managed password transport.
- `--presentation machine` disables rich terminal rendering, colors, and cursor-control output for Desktop-managed startup. Desktop readiness remains `--startup-report-file`; Electron must not parse human terminal output.
- Desktop creates one stable, non-secret runtime owner id in Electron `userData` and passes it only to Desktop-managed runtimes through `REDEVEN_DESKTOP_OWNER_ID`.
- Desktop resolves the managed state root before spawn and passes it explicitly to `redeven run`.
- The Desktop-owned local runtime uses `~/.redeven/local-environment/config.json`.
- The Welcome `Start Runtime` action does not add provider bootstrap flags or request provider open-session material. If the runtime already has a valid persisted provider binding, startup restores that provider control channel from the saved config; otherwise it starts local-only.
- `--controlplane`, `--env-id`, and `--bootstrap-ticket-env` remain explicit CLI/manual bootstrap inputs. They are not part of the Welcome Local Environment `Start Runtime` path.
- Desktop attach probing executes the target runtime's `desktop-runtime-status` command against the same resolved state root as the spawned config path.
- Provider `Open` is a window/navigation action that always opens the provider Environment through the provider tunnel. It never opens a Local/SSH forwarded UI, never starts a managed runtime, and never connects a runtime to a provider.
- Runtime-card actions are derived from an explicit operation plan, not from process provenance. Local, SSH, Local Container, and SSH Container cards can expose `Start runtime`, `Stop runtime`, `Restart runtime`, and `Update runtime` when Desktop has the matching host/container management channel. The operation plan is also the source of truth for menu visibility, disabled reasons, active-work impact copy, and execution method.
- Welcome card primary action availability is also derived from the runtime operation plan. If `runtime_operations.open` is available, the primary `Open` button and card status must stay openable even when runtime-control forwarding or runtime service metadata is not present yet; those details may explain provider-link blocking, but they must not create a second readiness source that turns an openable card into `RUNTIME PREPARING`.
- `Open` is a window/navigation action. It never starts, stops, restarts, updates, installs, or replaces a runtime.
- `Start runtime` always probes the target first. If Desktop finds an already-running, openable SSH Host or container Runtime Service, the action succeeds by adopting that status in memory; it must not start a new process, stop the old process, replace the runtime package, or interrupt active work.
- `Start runtime` may perform the first runtime installation on a host or inside a running container only after the probe proves that no compatible runtime package/daemon is already running. It must not silently update or replace an existing runtime package.
- `Restart runtime` is a first-class launcher action. For a stopped or stale-lock runtime it behaves as a start-from-stopped recovery. For a live runtime, the explicit user action authorizes Desktop to run one uninterrupted lifecycle workflow: stop the current process, verify that it has stopped, then start the runtime again.
- Provider Environment cards do not expose a local detection switch. Their runtime status is refreshed automatically through the provider runtime-health API.
- Local Environment and Local Container entries do not expose `Auto status detection`. Desktop owns those local management channels, so their background Welcome probes are always enabled.
- Saved Redeven URL, saved SSH Host, and SSH Container entries expose `Auto status detection`. The switch defaults off and controls only background Welcome probes on startup, polling, resume, and save-triggered refreshes.
- `Refresh status` always runs the read-only probe for the selected non-provider entry regardless of `Auto status detection`. If the same target already has a probe in flight, Desktop reuses that probe instead of starting a second one.
- `NOT CHECKED` means the current Desktop process has no fresh probe result; it is not an offline conclusion. The primary `Open` action stays available for non-provider runtime cards and owns a read-only preflight probe before any Local Host attach, SSH tunnel, container bridge, model-source, or window work starts.
- Read-only detection does not create tunnels, bridges, windows, provider bindings, runtime-control forwards, starts, stops, restarts, updates, installs, or replacements.
- An `Open` preflight is also read-only. It may adopt an already-running openable Local Host, SSH Host, Local Container, or SSH Container runtime into Desktop memory, but it must not start, install, update, restart, stop, replace, or provider-link a runtime. If the preflight proves the runtime is unavailable or needs maintenance, the same Open popup turns into the real recovery guidance.
- Password-based SSH automatic detection may use a locally stored SSH password only when `Auto status detection` is enabled. Manual `Refresh status`, `Start runtime`, and `Open` can still request explicit user authentication without changing the saved switch.
- Saved Redeven URL detection is advisory. A failed health probe shows `Unverified` / `Could not verify runtime health`, but `Open` remains available because the user may still know that the URL is reachable from the session window.
- A runtime target can be running but still require an Open connection. In that state Desktop has verified that the Local Host, SSH Host, Local Container, or SSH Container daemon is online, but the current Desktop process has not yet started the per-open `desktop-bridge`, loopback proxy, runtime-control forward, Desktop model source, or window. The card should present this as ready to open, not as runtime preparation.
- `Open`, `Reconnect`, provider connect, and Desktop model-source initialization never install a runtime package and never start a runtime daemon. If the daemon is not running, those paths must fail with Start Runtime guidance.
- `Update runtime` is always explicit and user-visible. Existing outdated, incompatible, or maintenance-required runtimes keep `Open` blocked until the user chooses the update/restart action.
- `Update runtime` is allowed on stopped SSH Host, Local Container, and SSH Container targets because there is no active runtime work to interrupt. On live runtimes, the explicit user action authorizes Desktop to run one uninterrupted lifecycle workflow: stop the current process, verify that it has stopped, replace the runtime package when needed, then start and check the runtime again.
- Local Host update is a Desktop release handoff, not a runtime-only replacement path. The Welcome menu labels that action `Update Redeven Desktop` and executes the `desktop_local_update_handoff` method through Desktop update management. Welcome badges and disabled-Open guidance for this method use Desktop update wording, because the user action is to update the Desktop bundle that carries the local runtime. SSH Host, Local Container, and SSH Container update actions continue to execute explicit runtime package updates for the target runtime placement.
- Runtime-control ownership and runtime-control forward availability only gate runtime-control RPC features such as provider linking. They do not decide whether the host/container runtime process can be stopped or restarted from the runtime card, and a missing per-open forward must not block `Open` from creating that forward.
- If active workload is present, Desktop keeps `Open` blocked and shows interruption-safe guidance instead of closing terminals, sessions, tasks, or port forwards implicitly.
- The Local UI password stays out of process args and environment variables.
- Provider one-time bootstrap tickets stay out of process args and renderer state. Welcome provider linking is initiated from Local/SSH runtime cards and passes tickets from Electron main to the selected running runtime through the desktop-only runtime-control endpoint.
- Desktop startup reports and runtime management status include a non-secret `password_required` boolean so launcher and attach flows can describe whether the current runtime is protected.
- Remote provider control is enabled after a successful explicit provider-link operation, an explicit non-Welcome bootstrap launch, or a later Desktop-managed startup that restores a valid saved provider binding.
- `--desktop-managed` disables CLI self-upgrade semantics.
- Managed restart is an explicit user action owned by Electron main rather than runtime self-`exec`.
- Managed restart reuses saved startup preferences, including `--password-stdin`, and preserves the current resolved loopback bind when the saved bind uses the advanced auto-port loopback option such as `127.0.0.1:0`.
- `--startup-report-file` lets Electron wait for a structured desktop launch report instead of scraping terminal output.
- On lock conflicts, the runtime first queries the existing runtime management socket from the same state directory before reporting a blocked launch outcome.
- Desktop runtime maintenance uses placement-agnostic kinds: `runtime_update_required`, `runtime_restart_required`, `runtime_stale_lock`, and `desktop_model_source_requires_runtime_update`. SSH Host, Local Host, Local Container, and SSH Container cards derive user copy from the environment kind and runtime placement instead of embedding SSH assumptions in the maintenance kind.
- `runtime_stale_lock` is an internal attach diagnostic for an active lease whose recorded process is no longer alive. It is not active work, not a restart-required state, and not a user-facing badge. Welcome presents this lifecycle as `RUNTIME OFFLINE`, keeps `Open` blocked, uses `Start runtime` as the primary recovery, and keeps `Restart runtime`, `Update runtime`, and `Refresh status` available for Local/SSH/container targets that Desktop can manage. A normal `Stop runtime` retires the active lease and must settle as `not_running`, not `runtime_stale_lock`.
- Desktop startup settings do not create a second preference-owned runtime target; the resolved Local Environment state directory remains the runtime source of truth.
- Desktop-managed runtime state never falls back to the Electron process working directory; if no usable home directory exists and no explicit config path is available, startup fails clearly instead of writing inside an arbitrary repository or shell cwd.
- Runtime lifecycle and Open connection progress are separate launcher operation contracts. Local Host, Local Container, SSH Host, and SSH Container start/stop/restart/update actions publish canonical `lifecycle_progress` metadata with operation-specific step snapshots and labels such as `Starting...`, `Stopping...`, `Restarting...`, and `Updating...`. Stop, restart, and update workflows must not advance past the stop step until the runtime process is verified as stopped; Open actions publish `open_progress` metadata for SSH tunnels, container bridges, runtime-control forwarding, Desktop model source preparation, and Env App window creation.
- `lifecycle_progress.steps` is the authoritative UI model for runtime workflow progress. The launcher may keep `stage_index` and `stage_count` for meter compatibility, but the renderer must not infer failed or canceled steps from those numeric fields. Failure belongs to `failed_step_id` plus the matching step snapshot, while canceled remains an operation status and never becomes a lifecycle step.
- `Runtime ready` is a terminal lifecycle step written when the launcher operation succeeds. Helper readiness observations remain part of `Checking runtime service`; linked-provider health refresh runs in the background after success and must not keep the progress popup parked on `Runtime ready`.
- `./scripts/check_docker_runtime_e2e.sh` is the real container lifecycle regression gate. It starts an `ubuntu:24.04` Docker container, runs the current Linux `redeven` binary as a desktop-managed daemon inside that container, verifies `desktop-runtime-status`, attaches through `desktop-bridge`, requests Local UI and runtime-control over bridge streams, calls direct `sys.ping`, exercises `sys.restart`, verifies a clean `Stop runtime` settles as `not_running`, verifies stopped-runtime Desktop-owned restart and update paths, verifies runtime-owned `sys.upgrade` is unavailable for desktop-managed runtimes, then performs a Desktop-owned package update and reconnects.

### Desktop Operation Failure Presentation

Launcher runtime and Open operations carry user-facing failures with
`DesktopOperationFailurePresentation` instead of raw exception text.
The contract separates:

- `title` and `summary`: short user-visible copy for toasts, card badges,
  progress notices, and shell runtime maintenance responses.
- `detail` and `recovery_hint`: optional user-facing context and the next
  practical action.
- `target_label`: the host, container, URL, or environment label involved in
  the failed operation.
- `diagnostics`: raw stdout/stderr streams, SSH channels, exit reasons, report
  paths, and other debugging material.

Runtime startup, SSH bootstrap, container host commands, and shell maintenance
must never promote diagnostic channel names such as `stderr`,
`control_stderr`, `master_stderr`, or `runtime_control_forward_stderr` into the
visible failure summary. Those streams remain available under `Details` and in
the copy-to-clipboard diagnostic payload. If a host named `dify` is unreachable,
the visible copy should be a workflow-level message such as
`SSH connection to "dify" failed.`, while the OpenSSH output stays in
diagnostics.

Launcher operation snapshots, action progress events, and action failures all
carry the same `failure` presentation object. The operation registry only
transports this object; domain code is responsible for choosing the failure code
and user copy from the operation phase and typed error, not by parsing stderr.

Desktop-managed Local Runtime also exposes a separate runtime-control endpoint when it is started by Desktop:

- It listens on a random loopback-only address (`127.0.0.1:0`).
- It uses a random bearer token plus the Desktop owner id.
- The endpoint appears in the startup report and runtime management status for Electron main to consume.
- The bearer token is not exposed to the renderer, Env App JavaScript, provider pages, Local UI HTTP responses, or process arguments.
- Provider link operations use `GET /v1/provider-link`, `POST /v1/provider-link/connect`, and `POST /v1/provider-link/disconnect` on this endpoint.
- Successful `connect` updates the Local Runtime config and starts or replaces the provider control-channel goroutine without restarting Local UI, local direct sessions, terminals, tasks, or port forwards.
- Successful `disconnect` revokes the local persisted provider authorization and stops the provider control-channel state without stopping the Local Runtime. When an active provider control channel exists, the runtime first sends `runtime_disconnect` so the provider can clear the current binding; when that channel is already gone, local unlink still completes so a removed or unreachable provider Environment cannot trap the user in a linked state.

When the selected target is `Remote Environment`, Desktop does not start the bundled binary.
Instead it validates and probes the configured Local UI base URL, then opens that exact origin in the shell.

When the selected target is `SSH Host Environment`, Desktop still keeps Redeven Local UI as the only runtime contract.
It does not introduce a second SSH-native file or terminal protocol. Electron main validates the SSH entry, opens an SSH control connection, installs or reuses the pinned Desktop-managed Redeven release on the host, starts `redeven run --mode desktop --desktop-managed --presentation machine --local-ui-bind 127.0.0.1:0` remotely with Desktop ownership, verifies the reported Runtime Service snapshot, and forwards both the remote Local UI and runtime-control endpoint back to the user's machine.

The SSH Host runtime flow stays two-step: `Start runtime` prepares or attaches the runtime, and the user still chooses `Open` before Desktop opens the forwarded Local UI origin. Env App receives an `ssh_environment` session context so Web Services treat remote-host `localhost` targets as remote loopback and open through `/pf/<forward_id>/`.

For Desktop-managed SSH and container runtimes, Desktop also starts a short-lived Desktop Model Source RPC connector on the user's machine. The connector reads the Desktop Local Environment's `config.json` and `secrets.json`, exposes only Redeven AI RPC methods over runtime-control, and never exposes files, terminals, ports, or Desktop IPC to the remote host or container. Desktop initiates the WebSocket RPC connection through the runtime-control endpoint that is already forwarded for the selected runtime; SSH reverse forwarding and host-network assumptions are not part of the model path. The runtime-control token is passed only to the local connector process through an environment variable and is not written to remote config, secrets, or logs.

This Desktop model source is a session capability, not a persisted remote configuration:

- Provider API keys stay in the Desktop Local Environment's local `secrets.json`.
- The SSH host's `local-environment/state/config.json` does not receive an `ai` block, an `enabled` flag, or any provider secret.
- Local Desktop-managed runtimes continue to use their local runtime config directly because they already run on the Desktop host and do not need a model-source bridge.
- Remote tools still run inside the SSH-hosted runtime and remain governed by the remote session's `session_meta` plus local `permission_policy`.
- If the Desktop source is unavailable, the SSH runtime still starts; Flower uses the remote runtime's own AI config only when that config exists.
- Env App keeps this split quiet in the chat header: normal environment-runtime AI config has no extra tag, while Desktop-backed model calls show a small `REMOTE` tag with a tooltip explaining that AI requests are handled by Desktop and workspace actions still run in the selected runtime. Runtime Settings still surfaces the Runtime Service binding state as `connecting` / `bound` / `unbound` / `unsupported` / `error` / `expired`.
- The SSH connection progress UI treats Desktop model preparation as an independently observable model-source state. Stopping startup from the Open-button progress panel means stopping the opening attempt, not disabling a model source permanently.

### SSH Host Environment

SSH bootstrap is intentionally transport-light and runtime-heavy:

- Desktop does not introduce a second SSH-native runtime protocol.
- Desktop pins the remote install to the same Redeven release tag as the running desktop build.
- The remote runtime layout keeps release artifacts, mutable Local Environment state, sessions, and logs under one selected runtime root:
  - `<runtime_root>/runtime/releases/<release_tag>/bin/redeven`
  - `<runtime_root>/runtime/releases/<release_tag>/managed-runtime.stamp`
  - `<runtime_root>/local-environment/`
  - `<runtime_root>/runtime/sessions/<session_token>/startup-report.json`
  - `<runtime_root>/runtime/logs/runtime-<session_token>.log`
- Desktop only reuses a remote runtime when the binary reports that exact release tag and a Desktop-managed runtime stamp in the same release root is valid.
- Each managed version root contains `managed-runtime.stamp`, which records the stamp schema, the owning shell (`redeven-desktop`), the exact release tag, and the install strategy.
- Desktop intentionally does not adopt arbitrary user-installed `redeven` binaries outside that managed version root, so SSH bootstrap stays side-by-side with direct CLI installs instead of mutating them.
- Mutable runtime state is host-scoped: one SSH host access entry maps to one remote Local Environment profile under the selected runtime root.
- The remote runtime root defaults to the remote user's `$HOME/.redeven` and can be overridden with an absolute path.
- Desktop can probe the remote OS/architecture (`linux` / `darwin`, `amd64` / `arm64` / `arm` / `386`) and choose the matching release package for desktop-managed upload.
- Desktop stores verified runtime packages in one local package cache shared by SSH Host, Local Container, and SSH Container targets. For many SSH hosts on the same platform, Desktop downloads the package once, then reuses the local archive for each SSH upload.
- Development Desktop sessions that start from `scripts/dev_desktop.sh` build target runtime packages from the current checkout. Each source package build runs in an isolated temporary source copy so Vite can rebuild embedded UI assets without deleting or racing against `go:embed` files in the developer checkout. Each Desktop process builds a source package once per target platform, then reuses that in-memory archive for later SSH Host, Local Container, or SSH Container starts. Because `REDEVEN_DESKTOP_SSH_RUNTIME_SOURCE_ROOT` forces the source-package path, dev `v0.0.0-dev` starts and updates do not trust the remote stamp solely by tag. Restart `scripts/dev_desktop.sh` after source changes when a target runtime should use newly compiled code.
- `desktop_upload` verifies the signed `SHA256SUMS` manifest before trusting release-asset checksums.
- `release_base_url` lets operators point the desktop-upload path at a compatible internal release mirror instead of public GitHub Releases.
- Compatible internal mirrors must expose the same signed manifest and `redeven_<goos>_<goarch>.tar.gz` assets as public releases.
- Desktop-side release downloads use explicit timeouts so restricted-network failures stay bounded and diagnosable.
- `auto` prefers Desktop upload through the verified local package cache, then falls back to the remote installer path only when desktop-side package preparation fails before upload/install begins.
- `remote_install` is a fallback delivery mode for environments where Desktop upload is unavailable; it is not the recommended path for large SSH host fleets because each remote host owns its own download.
- After Desktop starts uploading or installing the tarball over SSH, later failures stay first-class errors instead of silently degrading into `remote_install`.
- Development builds may set `REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG`; otherwise `scripts/dev_desktop.sh` falls back to the local Desktop bundle version or `v0.0.0-dev`.
- The remote runtime process is intentionally independent from the SSH control command that launched it. Desktop owns the SSH control socket and local port forward, not the remote runtime lifecycle.
- The forwarded localhost URL is session-ephemeral and only used as the live session origin.
- SSH Host data traffic goes through the local SSH tunnel: Desktop opens `127.0.0.1:<local_forward>` and SSH forwards it to the remote runtime's loopback-only Local UI port. No public or LAN-facing host port is required for the Local UI.
- Session identity is derived from SSH destination, SSH port, authentication mode, and runtime root so reconnecting does not create duplicates just because the forwarded local port changed.
- Closing the Desktop session window, losing the local forward, or quitting Desktop disconnects only the SSH transport. The SSH-hosted runtime keeps running until the user explicitly stops it or the remote host/process exits.
- SSH runtime stop is an explicit launcher/runtime-menu action. Pending startup can be canceled, and cleanup failures remain visible instead of being collapsed into a generic failure.
- `SSH Destination` accepts either a direct `user@host` target or a Host alias from the user's local SSH config. When a selected Host has a configured `Port`, Desktop fills the Port field while still allowing the user to edit or clear that override.
- SSH bootstrap supports key/agent authentication, a Desktop-owned password prompt mode, and an optional per-saved-entry local SSH password. Key/agent mode keeps `BatchMode=yes` so missing keys or host-key trust issues surface as actionable launcher errors. Password prompt mode disables batch auth. A password typed into an interactive prompt is not stored automatically; only the Welcome connection form can save or clear the local SSH password.
- Stored SSH passwords are write-only from the renderer's perspective. Desktop main stores them in the local secret file and returns only `ssh_password_configured` to the renderer. Editing the SSH destination, SSH port, or authentication mode clears the saved password on Save unless the user changes the identity back to the original baseline or enters a replacement password.

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
- The Environment Library is ordered for spatial stability: pinned entries render first, regular entries render after them, and each group keeps creation-time order. Opening, editing, saving, refreshing, or probing an Environment updates metadata in place and must not move the card; only changing the pinned state moves it between the two groups.
- `Environment Settings` is launcher-owned and edits startup behavior for the profile Local Environment; saving settings never switches Environments or creates another local runtime identity.
- Provider cards represent provider-tunnel access only. Their `Open` action always uses the provider tunnel, and their dropdown does not expose runtime lifecycle or provider-link controls.
- Provider cards expose a `LOCAL LINK` fact only as a locator for the Local/SSH/container runtime card that owns the provider binding. Clicking it applies a precise linked-runtime filter in the Environment Library; it does not open the provider through the local runtime or mutate the binding.
- Local, SSH, Local Container, and SSH Container cards represent runtime management. Their primary card action slot is always `Open`; runtime actions and provider-link actions live in the split-button dropdown or the disabled-Open guidance popover.
- `Stop runtime`, `Restart runtime`, and the relevant update action are stable dropdown items for runtime-owning cards whenever Desktop has a management channel. If the action is currently blocked or unavailable, the item remains visible as disabled and displays the operation-plan message as its reason.
- `Start runtime` is contextual: it appears only when startup is the appropriate recovery action for the current runtime state.
- The Local Host update menu item is `Update Redeven Desktop` and opens the Desktop update handoff so the shell app and bundled local runtime move together. Its card badge and disabled-Open popover say that Redeven Desktop needs an update instead of presenting a standalone runtime update. SSH Host and container cards use `Update runtime` for explicit target runtime package updates.
- `Start runtime` appears only in Local/SSH/container runtime card popups and dropdown menus. Provider cards do not expose `Start runtime`.
- `Connect to provider...` appears only on Local/SSH runtime cards and always requires the user to choose a provider Environment. Desktop does not preselect a provider and does not auto-link from a provider card. A saved provider binding is explicit authorization for later managed runtime startup to restore the provider control channel without showing `Connect to provider...` again.
- `Disconnect from provider` belongs to the runtime card, not to the provider Environment card. If a provider later removes the linked environment from its catalog, the provider card disappears but the Local/SSH/container runtime card still exposes `Disconnect from provider` as long as the runtime reports a linked provider binding.
- SSH Host entries store the destination, optional port, bootstrap delivery mode, runtime root, and optional release mirror base URL. Desktop reuses release artifacts for the exact Desktop-managed version and lets the remote host own its runtime state.
- Runtime health and window state are separate. Cards always show runtime version, using `UNKNOWN` when runtime metadata is unavailable; runtime status and active-work impact stay in badges, action recovery, and maintenance guidance while primary actions remain window-scoped (`Open`, `Opening...`, `Focus`).
- Runtime health is probed through explicit contracts: Local UI health for local/URL/SSH targets and RCPP runtime-health queries for provider environments.
- Runtime lifecycle progress and Open connection progress are shown inside the owning card's `Open` button popup. Running, failed, canceled, and cleanup-failed operations remain visible there until the user cancels, retries through a new action, copies diagnostics, or dismisses the item. There is no global or bottom-right SSH-only activity overlay.
- While runtime lifecycle or Open connection work is running, the `Open` trigger remains clickable and opens the progress popup; it is not a native disabled button. The trigger keeps the existing flowing shimmer feedback during the operation. Once the runtime snapshot is openable and the Open connection is ready, the popup yields and `Open` returns to direct click behavior.
- If lifecycle work is launched from the popup's `Start runtime`, `Stop runtime`, `Restart runtime`, or `Update runtime` action, or from the split-button dropdown, the same `Open` popup stays available for lifecycle progress until the user closes it or clicks elsewhere. Closing the popup does not cancel the lifecycle operation; clicking `Open` reopens the current progress panel. The progress trigger label must match the active lifecycle operation (`Starting...`, `Stopping...`, `Restarting...`, or `Updating...`). If `Open` needs to rebuild a Desktop-session tunnel or bridge after Desktop restart, that work is represented as Open connection progress, not as runtime startup.
- Disabled-Open recovery guidance and lifecycle progress are separate renderer states. Guidance describes why an action is currently unavailable and which recovery action is possible; lifecycle progress describes an operation the user already launched. A lifecycle action click opens a stable progress disclosure immediately with pending progress, then binds to the main-process launcher operation when the real progress snapshot arrives. Success remains visible while the popup is open; failed, canceled, and cleanup-failed progress remains visible until the user dismisses it.
- Main-process lifecycle progress is monotonic for a single operation because the main process owns the fixed workflow plan. Restart and update plans include the stop and stop-verification steps before package preparation and startup, and lower-level probes cannot move the visible operation back to an earlier step after Desktop has advanced past it.
- The visible failed step is the workflow step that was running when the operation failed. Package build/download failures fail `Preparing runtime package`; stop verification failures fail `Verifying runtime stopped`; readiness timeouts fail `Checking runtime service`; `Runtime ready` is reserved for successful completion.
- During restart or update readiness checks, `live_process_without_management_socket` / `management_socket_unreachable` is transient while Desktop is already waiting for the new runtime daemon to become ready. Desktop continues polling until the runtime is openable or the readiness timeout expires. If it times out, the failed step is `Checking runtime service`; it must not appear as a failure at `Runtime ready`.
- Provider catalog freshness is separate from provider route availability. A stale catalog still asks Desktop to sync in the background, but last-known online provider environments continue to show `Open` instead of collapsing into a generic refresh-required state. Refreshing a provider environment card force-syncs the provider catalog first, then refreshes that environment's runtime-health overlay.
- A successful provider catalog sync is the source of truth for provider Environment cards. Environments absent from the latest successful catalog are removed from the Environment Library immediately; Desktop does not keep a `REMOVED` provider card because it was pinned, last used, or previously linked.
- Deleting library entries is immediate and subject-owned: Local Environment is protected, open entries cannot be deleted, provider unlink clears only the local binding, and deleting saved URL/SSH entries cannot be blocked by background runtime cleanup.
- Transient success/failure feedback uses toasts. Runtime lifecycle and Open connection progress belong in the `Open` popup, not in toasts. Blocking recovery uses explicit actions instead of raw IPC errors or hover-only UI.
- Quit and last-window-close confirmation models include pending background operations, including runtime lifecycle and Open connection work. Runtime lifecycle and Open connection cancellation are bounded, while failed and cleanup-failed launcher operations remain visible after the dialog closes until the user handles them.

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
- Provider environments use the settings surface only for provider identity and catalog metadata. Local UI exposure belongs to the Local Environment or SSH Host runtime card that manages that runtime.

## Desktop Preferences

Desktop keeps one current persisted preference model for the profile's Local Environment, provider catalog cards, and saved remote connections. The Electron user-data `desktop-preferences.json` file is only a lightweight version marker; the durable current schema lives in the shared catalog and secrets files:

Durable preference categories:

- `local_environment`: the protected Local Environment entry and its local-hosting access configuration.
- `provider_environments`: first-class provider-backed environment records keyed by provider origin/id and environment id. The collection is reconciled from the latest successful provider catalog; user card preferences are preserved only while the provider still publishes that environment.
- `saved_environments`: saved Local UI URL connections.
- `saved_ssh_environments`: saved SSH Host connections and their bootstrap settings.
- `saved_runtime_targets`: saved container runtime targets. A target keeps host access (`local_host` or `ssh_host`) separate from placement (`container_process`) so Local Container and SSH Container entries share the same managed-runtime card semantics as Local and SSH host-process runtimes. Container placements persist a stable `container_ref` separately from the last resolved concrete `container_id`.
- `control_planes`: provider discovery/account/catalog metadata.
- `control_plane_refresh_tokens`: opaque provider refresh tokens in the local secrets file.

Semantics:

- Loading preferences reads the current catalog schema; Desktop does not persist a remembered current target for the next launch.
- Open Environment windows are runtime-only session state. Runtime health is a separate launcher snapshot and window closure alone never means the runtime stopped.
- Desktop never sends the stored Local UI password plaintext back to the renderer. The shell UI edits only a write-only replacement draft plus explicit keep/replace/remove intent.
- Secrets live in Desktop local settings files and use Electron `safeStorage` encryption when the host platform provides it; otherwise they remain local-only user data owned by the current account.
- Provider refresh reconciles canonical provider identity across provider environment records, but does not materialize remote-only provider environments into Local Environment state.
- Provider unlink state is stored with the runtime binding. Clearing a provider binding must not require a matching `provider_environments` record because provider catalogs can legitimately remove an environment before the local runtime disconnects.
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
- Desktop renderer storage is only for renderer-local Env App state such as theme, Workbench filters, shell mode, active tool, and per-widget instance helpers. It does not own Workbench widget identity, geometry, ordering, z-index, or canvas objects; those are read from and written to the runtime layout service.
- Process provenance stays diagnostic: Desktop can attach to externally started local runtimes, but explicit stop/restart/update availability is decided by the host or container management channel, not by an ownership label.

### Container Runtime Targets

Local Container and SSH Container entries are managed runtime cards. Their primary action slot remains `Open`, runtime actions stay in the split-button dropdown or guidance popover, and provider-link actions remain explicit runtime-card actions. Provider Environment cards do not start, stop, open locally, or connect these runtimes.

Container targets use the Runtime Placement Bridge instead of published container ports:

```text
Desktop renderer
  -> Desktop main loopback proxy on 127.0.0.1
  -> Start runtime inspects the running container, detects platform, installs a missing Desktop-managed Redeven runtime, starts the runtime daemon, and verifies daemon health
  -> Open connection starts the per-Desktop bridge:
  -> docker/podman exec -i [--env REDEVEN_DESKTOP_OWNER_ID] <container> <container_binary_path> desktop-bridge --state-root <runtime_root>
  -> Local UI and runtime-control inside the container
```

The bridge is a versioned byte-stream transport for Local UI, SSE, WebSocket, and runtime-control traffic. Desktop may execute that container command locally or through SSH host access, but the placement remains `container_process`; it must not fall back to a host-process runtime, provider tunnel, host networking, or a published container port. `desktop-bridge` attaches to an already-running runtime daemon and must fail when the daemon is not running.

Container placements use one container-internal `runtime_root`. The default is `/root/.redeven`; users can choose another writable, persistent `.redeven` path such as a mounted workspace directory. Desktop installs the correct Linux runtime package into `<runtime_root>/runtime/releases/<release_tag>/bin/redeven` during `Start runtime` when the package is missing, then starts the long-running daemon from the resolved container-local binary path. `desktop-bridge` uses the same `runtime_root` as its state root only to find and attach that daemon. A generic container does not need to provide `redeven` on `PATH`, and Desktop must not copy the host-bundled macOS/Windows binary into the container namespace. Container bootstrap reuses the same Desktop local package cache as SSH Host bootstrap, so Local Container and SSH Container targets do not redownload a runtime package already prepared for the same Desktop release and platform.

Container lifecycle is outside Redeven. The creation dialog lists only currently running Docker/Podman containers for the selected local or SSH host access path, saves a stable `container_ref` (normally the container name), and keeps `container_id` as the last resolved execution id. Before status projection, bootstrap, daemon startup, or bridge startup, Desktop resolves the placement again through Docker/Podman on the local host or through the selected SSH host. If a container was recreated with the same stable reference, Desktop heals the concrete id and keeps `Start runtime` available. If `Start runtime` has already verified or installed the runtime package and started the daemon but no bridge is active, the card stays openable and `Open` starts only the bridge. If the container is stopped, missing, ambiguous, or inaccessible, the card shows precise refresh/edit guidance; the user must start or repair the container with the owning container tool before Redeven can start the runtime process inside it.

Packaged macOS apps launched through Finder, Dock, or LaunchServices can receive a minimal `PATH` such as `/usr/bin:/bin:/usr/sbin:/sbin`, even when Docker or Podman works from the user's interactive shell. Local Container targets therefore resolve Docker/Podman as structured host commands before spawning them. Desktop searches the process `PATH` first, then standard macOS Desktop CLI locations such as `/opt/homebrew/bin`, `/usr/local/bin`, `/Applications/Docker.app/Contents/Resources/bin`, and `/Applications/Podman Desktop.app/Contents/Resources/bin`. Business commands are still executed directly with argv, not through `bash -l` or another shell wrapper. A missing CLI is reported as `Docker CLI was not found` or `Podman CLI was not found`; it must not be collapsed into container-missing guidance.

The runtime-control token stays in Electron main. Renderer snapshots expose only runtime-control status and provider-link capability.

The Docker runtime E2E test covers this placement model without using published
container ports or host networking. It copies a Linux test build into a running
Ubuntu container, starts the daemon with `--state-root`, uses
`desktop-runtime-status` as the attach authority, and accesses Local UI plus
runtime-control only through `desktop-bridge` streams.

Runtime Service snapshots are carried through the same attach and startup paths that already describe Local UI:

- `desktop-runtime-status`
- `runtime/control.sock`
- `--startup-report-file`
- `/api/local/runtime/health`
- `/api/local/runtime`
- `sys.ping` after Env App connects

The snapshot is intentionally non-secret and uses snake_case fields such as `runtime_version`, `runtime_commit`, `runtime_build_time`, `protocol_version`, `service_owner`, `desktop_managed`, `desktop_owner_id`, `effective_run_mode`, `remote_enabled`, `compatibility`, `active_workload`, `capabilities`, and `bindings`. Desktop treats it as service identity, maintenance context, and live attach capability state, not as a second runtime protocol.

For SSH Host sessions, Desktop validates the final running snapshot before reuse. If an attached runtime lacks required capabilities, Desktop blocks `Open` with restart/update guidance until the user explicitly chooses the matching runtime-card operation. Replacement then proceeds only when the process can be stopped and the user accepts the active-work impact.

Target validation rules:

- External targets must use an absolute `http://` or `https://` URL.
- The host must be `localhost` or an IP literal.
- The shell normalizes the configured target to the Local UI origin root.
- SSH Host destinations accept `[user@]host` or SSH config host aliases.
- SSH ports must be valid TCP ports when present.
- SSH environment instance IDs must use 6-64 lowercase letters, numbers, `_`, or `-`.
- SSH runtime roots must either use the default remote `$HOME/.redeven` behavior or an absolute path.
- SSH bootstrap delivery must be one of `auto`, `desktop_upload`, or `remote_install`; `remote_install` is a fallback mode, not the recommended default.
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
9. Desktop requests a provider Environment open session only when it opens a specific provider environment through the provider tunnel or when the user explicitly connects that provider Environment to a selected Local/SSH runtime card.
10. For a remote provider card, Desktop opens the returned `remote_session_url` directly without persisting a remote-only Local Environment state first.
    - The top-level remote session page may in turn host the Env App inside a same-origin boot iframe.
    - Embedded same-origin Env App documents must still inherit the desktop shell bridges and window-chrome contract from the owning session window, so titlebar safe areas, theme state, and environment-scoped renderer storage stay identical to direct desktop-hosted sessions.
11. For an explicit provider-link connection, Desktop sends the returned one-time `bootstrap_ticket` to the selected running Local/SSH runtime through the desktop-only runtime-control endpoint.
12. The runtime exchanges that ticket, persists the provider binding only after the exchange succeeds, and starts the provider control channel without restarting the runtime.
13. Later Desktop-managed startup loads that persisted binding and starts Local UI plus the provider control channel as one runtime lifecycle operation.
14. Rebinding is blocked while provider-originated work is active. Desktop never materializes a second local runtime state directory for another provider environment.

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
- Welcome and desktop Env App route only the Floe `theme` persistence key through the shell bridge; other renderer-local UI state stays in normal storage namespaces.
- Workbench widget layout is not renderer-local UI state. Desktop Env App must get widget identity, geometry, ordering, z-index, and durable canvas objects from the runtime layout snapshot and must ignore old renderer layout payloads.
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
- Quit confirmations describe only Desktop-owned UI impact: environment windows close, pending launcher tasks may be canceled, and runtime processes keep running.
- On macOS, closing the final Desktop window keeps the app running, but Desktop warns before the last window disappears when that close would hide the active environment surface or pending work.
- Quit and final-window-close confirmations use the platform-native system dialog surface, so macOS, Windows, and Linux each keep their expected shutdown affordances.
- On non-macOS platforms, closing the final Desktop window uses that same quit-impact protection before the app is allowed to exit. Exiting Desktop does not stop runtime processes.
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
- Env App downloads use the Desktop download bridge instead of renderer filesystem access. The preload surface exposes `window.redevenDesktopDownloads.prepare/write/complete/abort/reveal/open`, and Electron main owns the save dialog, temp file, final rename, and destination actions.
- Desktop download writes always target `<selected-path>.download.tmp` first. `complete` closes the handle and renames to the final path; `abort` closes the handle and removes the temp file. Renderer code receives only a destination presentation plus an opaque token for subsequent write/action calls.
- Env App receives Desktop's explicit maintenance context and must not infer restart/update availability from `desktop_managed` or process provenance.
- When Desktop is attached to a local runtime through a host management channel, explicit restart/stop actions use that channel. Desktop quit and window close still detach without stopping the runtime.
- When a desktop-managed restart finishes, Env App recovers in place through the same shell-owned reconnect/access-gate flow used by other reconnect scenarios.
- If the restarted runtime requires password verification again, the same page asks for the Local UI password instead of requiring a manual browser refresh.
- Desktop resolves update impact before continuing:
  - Desktop-owned local and provider sessions may require a Desktop restart and reopen flow
  - SSH-hosted Local Environment profiles only affect that one SSH Host entry and runtime root
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
