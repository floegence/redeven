# Runtime Service Maintenance

Redeven Runtime is a persistent service, not a disposable helper process. Desktop
must expose that service model clearly while keeping version compatibility and
maintenance decisions product-owned instead of pushing component mechanics onto
users.

This document is the stable product and data contract for Runtime Service
maintenance. Implementation tasks, rollout checklists, and historical execution
notes should stay out of this document once the behavior has landed.

## Goals

- Present Runtime as a long-lived service that owns terminal, task, web service registration,
  and environment session continuity.
- Keep Desktop and Runtime version coordination safe, observable, and easy to
  recover from.
- Reuse the existing Desktop launcher and Env App settings visual language:
  compact cards, badges, table rows, action buttons, toast notifications, and
  progress popovers.
- Avoid layout-shifting notices. Transient maintenance prompts must use toast
  surfaces or existing floating-layer components, never injected inline banners
  above page content.
- Prefer explicit data contracts over UI-only inference.

## Non-Goals

- Do not silently kill or replace a running Runtime service just because a newer
  bundled binary exists.
- Do not downgrade a newer Runtime to match an older Desktop shell.
- Do not add a second Desktop-specific runtime protocol. Local UI plus existing
  sys RPC remain the runtime authority.
- Do not introduce provider capability negotiation for this work.

## Product Model

The user-facing model has two first-class objects:

- `Redeven Desktop`: the app shell, connection center, windows, and provider
  management surface.
- `Runtime Service`: the persistent endpoint process that owns terminal
  sessions, workbench state, environment capability RPCs, and local/remote
  hosting.

The UI should say `Runtime Service` when describing lifecycle or maintenance,
and `Redeven Desktop` when describing the shell app release. Version decisions
are classified automatically, but existing-runtime update and replacement work
starts only from an explicit user action.

## UX Principles

- Stable state belongs in stable UI slots: status badges, card facts, settings
  rows, and action menus.
- Ephemeral events use toast notifications. Toasts must not push page content
  down.
- Risky or disruptive runtime operations surface impact before execution, then
  run as explicit, cancelable workflows after the user chooses the action.
- Existing work keeps priority. A compatibility problem can block creating new
  sessions or using newer functionality, but should not close live terminals
  unless the user explicitly starts maintenance.
- Recovery actions must be verbs users understand: `Restart when idle`,
  `Restart now`, `Update Desktop`, `Open release page`, `Try again`, and
  `Copy diagnostics`.

## Welcome Detection And Safe Start

Desktop treats saved runtimes as long-lived services that can outlive the
Desktop process. Provider Environment cards refresh runtime status
automatically through the provider runtime-health API and do not expose a local
detection switch. Local Environment and Local Container entries also do not
expose that switch because Desktop owns their local management channel and
always probes them automatically. Saved SSH Host, SSH Container, and saved
Redeven URL entries expose `Auto status detection`, which defaults off and
controls only background Welcome probes on startup, polling, resume, and
save-triggered refreshes.

Detection rules:

- Detection never starts, stops, restarts, updates, installs, or replaces a
  runtime.
- Detection never creates a session window, Local UI tunnel, container bridge,
  runtime-control forward, desktop model-source connection, or provider binding.
- `Refresh status` always runs the read-only probe for the selected
  non-provider entry, even when `Auto status detection` is off.
- `NOT CHECKED` means status freshness is unknown, not that the runtime is
  offline. `Open` remains clickable for Local/SSH/container runtime cards and
  starts with the same read-only preflight before attaching a Local Host runtime,
  opening any bridge or tunnel, or creating an Env App window.
- If a target already has a probe in flight, Desktop reuses that in-flight probe
  instead of starting a duplicate probe.
- A target with a running and openable Runtime Service becomes `Open`-ready
  even after Desktop has restarted, because runtime readiness is not tied to
  Electron process memory.
- A saved Redeven URL probe failure is `Unverified`, not `Not started`, and
  `Open` remains available.
- Password-based SSH automatic detection is non-interactive and may use a
  locally stored SSH password only when the saved entry has opted into automatic
  status detection. Manual refresh/start/open paths can still request
  authentication explicitly.

Container detection has an additional host-command discovery state. When a
Local Container target cannot find the local Docker/Podman CLI, Desktop reports
`runtime_control_status.state = "missing"` with
`reason_code = "container_engine_unavailable"` and a message that names the
missing CLI. This is distinct from `container_not_running`, which means the
container reference was inspected or listed successfully but is stopped, missing,
or ambiguous. `container_engine_unavailable` blocks Open, Start, and Update while
leaving Refresh available; fixing the host CLI installation or PATH and then
refreshing is the recovery path.

Manual `Start runtime` uses the same probe-first policy. If the runtime is
already running and openable, Start succeeds without launching a replacement
process. For SSH Host and container targets, Start uses the canonical
`<runtime_root>/runtime/managed/bin/redeven` slot when that slot is present and
self-consistent; it does not compare the installed slot release with the
current Desktop target release and does not replace the binary. If the
canonical slot is missing, Start may perform the first install. If the runtime
is running but incompatible, blocked, or missing a management socket, Desktop
surfaces a maintenance requirement and leaves the existing process alone.
Explicit stop/restart/update actions are main-process
launcher workflows. Restart and update are already explicit user intent, so
Desktop does not insert an intermediate confirmation step. The lifecycle
operation keeps reporting each step, including stop and stop-verification, and
remains cancelable while cancellation is still safe.

Once Desktop is already inside an explicit restart/update/start readiness wait,
`live_process_without_management_socket` and
`management_socket_unreachable` are treated as transient readiness observations,
not as new maintenance decisions. Desktop keeps polling until the runtime
reports ready or the workflow timeout expires. A timeout fails the
`Checking runtime service` step so the progress sequence matches the operation
that actually stalled.

Runtime lifecycle progress must not move backward within one launcher
operation. The main process owns the user-visible lifecycle plan, while lower
level host, SSH, package, and container helpers report observations into that
plan. Restart and update plans include stop and stop-verification before
package preparation and startup; helper observations for earlier probe phases
are ignored once the visible plan has advanced beyond them.
If a later probe changes the top-level decision after the operation has already
run a step, Electron main must merge that new decision with the observed
workflow history before committing the next plan. Steps that reached `running`,
`succeeded`, or `failed` remain visible in order, while omitted-step diagnostics
may only describe steps that are absent from the visible plan.

Blocked runtime reports and operation failures have separate responsibilities.
Runtime reports describe machine-readable attach or maintenance state, such as
`state_dir_locked`, owner metadata, active workload, and compatibility fields.
Desktop operation failures describe the user-visible outcome of an attempted
launcher action through `DesktopOperationFailurePresentation`.

When a start/open/stop/restart/update action fails, the launcher card, progress popover,
toast, and shell maintenance response must render the operation failure
`summary` first. Raw report fields and process streams remain diagnostics. For
example, an unreachable SSH host should surface `SSH connection to "dify"
failed.` while preserving `control_stderr` and the OpenSSH output only under
`Details` / copied diagnostics. Maintenance requirements may include diagnostic
details for support, but those details must not be concatenated into
`Error.message` and must not replace the operation-level summary. Failed
launcher operations remain visible with their completed steps, failed step,
diagnostics, and next actions until the user handles or dismisses them.

## Data Structures

### Runtime Lifecycle Progress

Desktop launcher operations expose runtime lifecycle progress as an execution
plan snapshot owned by Electron main:

```ts
type DesktopRuntimeLifecycleStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed';

type DesktopRuntimeLifecycleStepSnapshot = Readonly<{
  id: DesktopRuntimeLifecycleStepID;
  key: string;
  label: string;
  status: DesktopRuntimeLifecycleStepStatus;
  detail?: string;
  attempt_count?: number;
}>;

type DesktopRuntimeLifecycleProgress = Readonly<{
  kind: 'runtime_lifecycle';
  location: 'local_host' | 'local_container' | 'ssh_host' | 'ssh_container';
  operation: 'start' | 'restart' | 'update' | 'stop';
  plan_state: 'planning' | 'executing' | 'terminal';
  plan_revision: number;
  phase: DesktopRuntimeLifecycleStepID;
  active_step_id: DesktopRuntimeLifecycleStepID;
  failed_step_id?: DesktopRuntimeLifecycleStepID;
  stage_index: number;
  stage_count: number;
  steps: readonly DesktopRuntimeLifecycleStepSnapshot[];
  target_id: string;
  target_label: string;
  target_detail?: string;
  diagnostics?: {
    omitted_steps?: readonly RuntimeLifecycleOmittedStep[];
  };
}>;
```

`steps` is the renderer's source of truth and contains only the visible
execution plan for this operation. During `planning`, Desktop shows the
decision-gate checks that are actually being run. After those checks identify
the real path, Electron main increments `plan_revision`, switches to
`executing`, and appends or replaces the remaining visible steps. Steps known
not to execute are omitted from the main list instead of being left as pending;
they may be recorded in `diagnostics.omitted_steps` for tests and support.
`stage_index` and `stage_count` exist only for meter compatibility and must not
be used to infer which step failed. Failed and canceled are launcher operation
statuses, not lifecycle steps. When an operation fails, the main process
preserves the active workflow step in `failed_step_id` and marks that step
snapshot as `failed`.

Electron main maintains that snapshot through a per-operation lifecycle
workflow controller. The controller is the only component allowed to mark
workflow steps as running, succeeded, or failed, and it enforces that no later
step can start or complete across a pending visible step. Helper progress from
SSH, local process, package, and container modules is an observation stream: it
may update the current step detail or move to the next step after the main
process has committed that step into the plan, but it cannot select the
top-level branch, invent missing steps, or rewind the user-visible workflow
after the controller has advanced.

`Runtime ready` is emitted only as the successful terminal step. Helper
observations that say a daemon is becoming reachable stay inside
`Checking runtime service` until the launcher operation commits success.
Provider runtime-health sync runs after success in the background so it cannot
delay the lifecycle completion UI.

### Runtime Service Snapshot

Runtime exposes a normalized service snapshot through all attach and health
paths that Desktop can read before adopting a process:

```json
{
  "runtime_version": "v1.4.2",
  "runtime_commit": "abc123",
  "runtime_build_time": "2026-05-02T00:00:00Z",
  "protocol_version": "redeven-runtime-v1",
  "compatibility_epoch": 2,
  "service_owner": "desktop",
  "desktop_managed": true,
  "effective_run_mode": "hybrid",
  "remote_enabled": true,
  "compatibility": "compatible",
  "compatibility_message": "",
  "minimum_desktop_version": "v0.5.8",
  "minimum_runtime_version": "v0.5.8",
  "compatibility_review_id": "runtime-service-maintenance-v1",
  "capabilities": {
    "desktop_model_source": {
      "supported": true,
      "bind_method": "runtime_control_v1"
    },
    "provider_link": {
      "supported": true,
      "bind_method": "runtime_control_v1"
    }
  },
  "bindings": {
    "desktop_model_source": {
      "state": "bound",
      "session_id": "dms_xxx",
      "model_source": "desktop_local_environment",
      "connected_at_unix_ms": 1778750000000
    },
    "provider_link": {
      "state": "linked",
      "provider_origin": "https://redeven.test",
      "provider_id": "dev_redeven",
      "env_public_id": "env_xxx",
      "access_point_origin": "https://dev.redeven.test",
      "local_environment_public_id": "le_xxx",
      "binding_generation": 7,
      "remote_enabled": true,
      "last_connected_at_unix_ms": 1778750000000
    }
  },
  "active_workload": {
    "terminal_count": 3,
    "session_count": 2,
    "task_count": 0,
    "port_forward_count": 1
  }
}
```

Canonical TypeScript shape:

```ts
type RuntimeServiceOwner = 'desktop' | 'external' | 'unknown';
type RuntimeServiceCompatibility =
  | 'compatible'
  | 'update_available'
  | 'restart_recommended'
  | 'update_required'
  | 'desktop_update_required'
  | 'managed_elsewhere'
  | 'unknown';

type RuntimeServiceOpenReadinessState = 'starting' | 'openable' | 'blocked';

type RuntimeServiceOpenReadiness = Readonly<{
  state: RuntimeServiceOpenReadinessState;
  reason_code?: string;
  message?: string;
}>;

type RuntimeServiceWorkload = Readonly<{
  terminal_count: number;
  session_count: number;
  task_count: number;
  port_forward_count: number;
}>;

type RuntimeServiceCapability = Readonly<{
  supported: boolean;
  bind_method?: string;
  reason_code?: string;
  message?: string;
}>;

type RuntimeServiceCapabilities = Readonly<{
  desktop_model_source: RuntimeServiceCapability;
  provider_link: RuntimeServiceCapability;
}>;

type RuntimeServiceBindingState = 'unbound' | 'connecting' | 'bound' | 'unsupported' | 'error' | 'expired';

type RuntimeServiceBinding = Readonly<{
  state: RuntimeServiceBindingState;
  session_id?: string;
  expires_at_unix_ms?: number;
  connected_at_unix_ms?: number;
  model_source?: string;
  model_count?: number;
  missing_key_provider_ids?: string[];
  last_error?: string;
}>;

type RuntimeServiceBindings = Readonly<{
  desktop_model_source: RuntimeServiceBinding;
  provider_link: RuntimeServiceProviderLinkBinding;
}>;

type RuntimeServiceProviderLinkState =
  | 'unbound'
  | 'linking'
  | 'linked'
  | 'disconnecting'
  | 'unsupported'
  | 'error';

type RuntimeServiceProviderLinkBinding = Readonly<{
  state: RuntimeServiceProviderLinkState;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  access_point_origin?: string;
  local_environment_public_id?: string;
  binding_generation?: number;
  remote_enabled: boolean;
  last_connected_at_unix_ms?: number;
  last_disconnected_at_unix_ms?: number;
  last_error_code?: string;
  last_error_message?: string;
}>;

type RuntimeServiceSnapshot = Readonly<{
  runtime_version?: string;
  runtime_commit?: string;
  runtime_build_time?: string;
  protocol_version?: string;
  compatibility_epoch?: number;
  service_owner: RuntimeServiceOwner;
  desktop_managed: boolean;
  effective_run_mode?: string;
  remote_enabled: boolean;
  compatibility: RuntimeServiceCompatibility;
  compatibility_message?: string;
  minimum_desktop_version?: string;
  minimum_runtime_version?: string;
  compatibility_review_id?: string;
  open_readiness?: RuntimeServiceOpenReadiness;
  active_workload: RuntimeServiceWorkload;
  capabilities?: RuntimeServiceCapabilities;
  bindings?: RuntimeServiceBindings;
}>;

type RuntimeServiceIdentity = Readonly<{
  runtime_version?: string;
  runtime_commit?: string;
  runtime_build_time?: string;
}>;
```

Compatibility is product-owned by the Runtime Service compatibility contract in
`internal/runtimeservice/compatibility_contract.json`. Runtime stamps the
contract's protocol version, compatibility epoch, minimum Desktop version,
minimum Runtime version, and review id into every Runtime Service snapshot.
Desktop and Env App render those fields as maintenance context; they should not
invent a second compatibility policy in UI-only code.

The same snapshot also carries explicit runtime-control surfaces:

- `capabilities.desktop_model_source` and `bindings.desktop_model_source` let Desktop decide whether an attached SSH or container runtime can accept Desktop Model Source RPC without falling back to string-based heuristics. A binding error should be shown as model-source availability state, not as a Runtime Service startup failure.
- `capabilities.provider_link` and `bindings.provider_link` describe whether a Desktop-managed Local or SSH runtime can accept an explicit provider-link command and which provider Environment, if any, is currently connected.
- Container runtime targets resolve a stable `container_ref` to the current concrete `container_id` before bridge startup or maintenance actions. Runtime-control UI should reflect the resolver result: running containers without an active bridge remain startable, while stopped, missing, ambiguous, or inaccessible containers stay observe-only with the resolver message.

### Desktop Runtime Maintenance Requirement

Desktop normalizes Runtime Service readiness, blocked launch reports, package
stamps, and model-source capability gaps into one placement-agnostic maintenance
shape before the Welcome UI or Env App shell renders recovery actions:

```ts
type DesktopRuntimeMaintenanceKind =
  | 'runtime_update_required'
  | 'runtime_restart_required'
  | 'runtime_stale_lock'
  | 'desktop_model_source_requires_runtime_update';

type DesktopRuntimeMaintenanceRecoveryAction =
  | 'update_runtime'
  | 'restart_runtime'
  | 'start_runtime'
  | 'refresh_status';

type DesktopRuntimeMaintenanceRequirement = Readonly<{
  kind: DesktopRuntimeMaintenanceKind;
  required_for: 'open' | 'desktop_model_source';
  recovery_action: DesktopRuntimeMaintenanceRecoveryAction;
  can_desktop_start: boolean;
  can_desktop_restart: boolean;
  has_active_work: boolean;
  active_work_label: string;
  current_runtime_version?: string;
  target_runtime_version?: string;
  attach_state?: string;
  failure_code?: string;
  lock_pid?: number;
  message: string;
}>;
```

The kind names describe runtime facts, not transport. SSH Host, Local Host, Local
Container, and SSH Container cards derive user-facing copy from the environment
kind and runtime placement. A Local Container must never inherit copy such as
`This SSH host is reachable` simply because the same lower-level recovery model
is used for SSH runtimes.

Blocked launch reports are classified before they become maintenance:

| Blocked fact | Desktop classification | Maintenance |
| --- | --- | --- |
| `not_running` / `runtime_not_running` / attach state `not_running` | stopped runtime lifecycle | none |
| `stale_lock` / `lock_pid_not_alive` | stopped-like recovery lifecycle | none |
| live process with unreachable management socket | restart required | `runtime_restart_required` |
| damaged package slot, protocol incompatibility observed during Open, or Desktop model-source compatibility gap | update required | `runtime_update_required` or `desktop_model_source_requires_runtime_update` |
| incomplete or ambiguous diagnostics | unverified | none |

This table replaces the older behavior where nearly every blocked report was
treated as restart maintenance. `not_running` is a normal stopped state and must
not create `runtime_restart_required`.

`runtime_stale_lock` is the internal attach diagnostic for blocked reports whose
launch code, attach state, or failure code is `stale_lock` or
`lock_pid_not_alive`. It means active runtime lease metadata names a process
that is no longer alive. An empty lock file is not an active lease and must
normalize to `not_running`. Desktop treats stale lease diagnostics as a stopped
runtime lifecycle, not as a user-facing maintenance badge:

- Welcome presents `RUNTIME OFFLINE`, not `RUNTIME STALE LOCK`.
- `Open` stays blocked with stopped-runtime guidance.
- `Start runtime` is the primary recovery action when the target can be managed.
- `Restart runtime` remains available as start-from-stopped recovery when the target can be managed.
- `Update runtime` remains available when the target can be managed and uses the Desktop-owned package update path.
- Active-work impact is not shown because stale metadata is not active
  workload.
- `Refresh status` remains available for users who repaired the runtime outside
  Desktop.

Normal `Stop runtime` retires the active lease while the runtime still holds the
lock, then releases the lock. The next `desktop-runtime-status` after a clean
stop must report `not_running`. A stale lease is reserved for an unclean exit or
older runtime that left active metadata behind.

`runtime_restart_required` remains reserved for a live runtime that cannot be
reused without a process restart, for example a Desktop-managed process whose
management socket or runtime-control surface cannot be reached. That state may
carry `has_active_work`; the card surfaces that impact in guidance, and the
explicit `Restart runtime` action authorizes Desktop to run the restart
workflow without a second prompt. It does not authorize replacing an installed
runtime package; package replacement belongs to `Update runtime`.

### Runtime-Owned Maintenance Snapshot

Runtime-owned restart and self-upgrade use a small local marker under the
runtime state directory to bridge the `syscall.Exec` boundary. The marker is not
a second lifecycle authority. It records one in-flight maintenance attempt so
the next process image can reconcile what is actually running before Env App
declares success.

The marker is written before the installer or restart exec begins, updated on
installer or exec failure while the old process is still alive, and reconciled
during Agent startup before `sys.ping` is served. `syscall.Exec` may keep the
same OS process id, so upgrade success never depends on PID changes. The
observable identity is the requested target version plus the current
`sys.ping.version`, Runtime Service `runtime_version`, process start marker,
and runtime instance id.

The `sys.ping.maintenance` snapshot keeps the existing `kind`, `state`,
`target_version`, `message`, `started_at_ms`, and `updated_at_ms` fields, and
may include these additional diagnostics:

```ts
type SysMaintenanceSnapshot = {
  kind?: 'upgrade' | 'restart';
  state?: 'running' | 'succeeded' | 'failed';
  target_version?: string;
  previous_version?: string;
  observed_version?: string;
  previous_process_started_at_ms?: number;
  observed_process_started_at_ms?: number;
  previous_runtime_instance_id?: string;
  observed_runtime_instance_id?: string;
  install_dir?: string;
  exe_path?: string;
  message?: string;
  error_code?: string;
  started_at_ms?: number;
  updated_at_ms?: number;
  completed_at_ms?: number;
};
```

`succeeded` means the reconciled runtime identity matches the requested
maintenance semantics. For upgrade with an explicit target version, the running
version must equal that target. `failed` means the installer, exec, marker read,
or reconciliation check produced a concrete failure; the message should include
the expected and observed versions when version reconciliation fails. A damaged
marker must not block startup, but Runtime logs the read failure and exposes a
failed maintenance snapshot instead of silently treating the operation as
successful.

### Contract Carriers

- `desktop-runtime-status`: structured attach status used by Desktop before spawn.
- `runtime/control.sock`: runtime-owned management socket that backs local status queries.
- `--startup-report-file`: structured readiness report for a newly started
  desktop-managed process.
- `/api/local/runtime/health`: no-unlock health probe for attach viability.
- `/api/local/runtime`: unlocked local runtime info for Env App local mode.
- `sys.ping`: E2EE runtime RPC for Env App after the protocol is connected.

All carriers use `snake_case` on the wire and normalize to camelCase only inside
Env App protocol SDK types.

The Docker runtime E2E gate (`./scripts/check_docker_runtime_e2e.sh`) exercises
these carriers against a real `ubuntu:24.04` container. It builds the current
Linux runtime binary, starts `redeven run --mode desktop --desktop-managed --presentation machine`
inside the container, verifies `desktop-runtime-status`, attaches with
`desktop-bridge`, requests Local UI and runtime-control through bridge streams,
then performs direct `sys.ping` and `sys.restart` calls. It also verifies that
desktop-managed runtimes reject runtime-owned `sys.upgrade` and that a
clean `desktop-runtime-stop` settles as `not_running`, not a stale lease.
Stopped-runtime Desktop-owned restart and update paths must become ready again,
and a Desktop-owned package update followed by daemon restart must be attachable
again.
This is the regression boundary for container daemon lifecycle, bridge
forwarding, and maintenance behavior.

## Compatibility Decision Table

| State | User Impact | Primary UI |
| --- | --- | --- |
| `compatible` | No action needed | Stable badge/table row only |
| `update_available` | Optional maintenance | Toast once; Settings badge `Update ready` |
| `restart_recommended` | Continue work, plan restart | Toast; action `Restart when idle` |
| `update_required` | Existing work preserved; new risky actions blocked | Dialog-driven maintenance action |
| `desktop_update_required` | Runtime is newer than Desktop | Toast + release handoff; do not downgrade |
| `managed_elsewhere` | Runtime-control owner is not this Desktop | Provider-link guidance; host/container operations still use the runtime-card operation plan |
| `unknown` | Metadata unavailable | Quiet degraded state; diagnostics available |

Desktop treats the runtime as a singleton per Local Environment profile, but runtime-card management is no longer derived from whether Desktop "owns" that process. Electron still persists one `desktop_owner_id` under `userData` and passes it to managed child processes with `REDEVEN_DESKTOP_OWNER_ID`; that owner id remains a runtime-control lease for secure RPC surfaces such as provider linking and Desktop model-source binding. Stop, restart, start, and update availability comes from the runtime operation plan built from host access, placement, running state, package state, Runtime Service readiness, and maintenance requirements. Execution belongs to the main-process launcher operation; renderer menus submit intent and then render the authoritative operation snapshot.

Provider binding is an explicit runtime-card action, not a side effect of `Open` and not a runtime restart plan. Provider cards always open through the provider tunnel and never manage runtime lifecycle. Welcome `Start runtime` starts only the Local/SSH/container runtime represented by that runtime card. For SSH Host and container targets, Desktop treats `<runtime_root>/runtime/managed/bin/redeven` plus its schema v2 stamp as the canonical installed runtime slot. Start may install the runtime package when that slot is missing, but it must not silently update or replace an existing self-consistent slot, and it must not compare that installed slot with the current Desktop target release as a reason to replace it. `Restart runtime` and `Update runtime` are first-class launcher actions rather than UI-level stop/start compositions. `Restart runtime` can start from a stopped or stale-lock state and may install only when the package probe reports that the canonical slot is missing; otherwise it is process lifecycle only and restarts the same installed binary. Live restarts proceed as the same uninterrupted lifecycle workflow after the user chooses the action, but they do not upgrade or replace the installed package. `Update runtime` is the only explicit user-visible path for replacing, upgrading, or reinstalling runtime packages on SSH Host, Local Container, and SSH Container cards, and it remains allowed on stopped targets because no runtime work is active. Local Host update is different: the card uses `Update Redeven Desktop` and the `desktop_local_update_handoff` operation method because the bundled local runtime moves with the Desktop app release. Welcome presentation does not let update maintenance pre-gate `Open`; Local Host, SSH Host, and container cards keep `Open` as the user's compatibility probe, while the explicit update action remains available in the runtime menu. Open-time Runtime Service incompatibility is then shown in the Open failure panel with version context and an explicit recovery action. Package source is orthogonal to that lifecycle authority: development builds compile packages from the current checkout, while packaged builds fetch or reuse release/cache packages. Source selection never authorizes replacement of an existing target runtime package by Start or Restart. `Connect to provider...` obtains provider open-session material, sends the one-time provider-link ticket to the selected running Local/SSH runtime over runtime-control, and lets the runtime start or replace only the provider control-channel goroutine. Once that binding is persisted, it is explicit authorization for later Desktop-managed startup to restore the provider control channel from saved config as part of the runtime lifecycle. `Disconnect from provider` revokes that local authorization and clears the runtime's persisted provider binding; an active control channel is used to notify the provider first, but the local unlink still completes when that channel is already unavailable. Desktop then refreshes provider runtime health from the provider API when the provider Environment is still present instead of locally fabricating an offline state. Active provider-originated work blocks relink. Runtime-control owner mismatch blocks provider-link RPC but does not hide host/container stop or restart operations.

Welcome menu projection comes from the runtime operation plan. `Stop runtime`,
`Restart runtime`, and the placement-specific update action use stable menu
visibility on runtime-owning cards, so blocked or unavailable actions stay in
place as disabled items with the plan message as their reason. `Start runtime`
uses contextual visibility and appears only when startup is the relevant
recovery action. Provider and external URL lifecycle operations use hidden
visibility and must not leak into provider cards or externally managed entries.

Container runtime targets use the same Runtime Service maintenance model. A Local Container or SSH Container card is still a managed runtime card because the user has host access to the machine that can execute `docker` or `podman`; only the process placement differs. Desktop first inspects the running container, detects its platform, and verifies the schema v2 Desktop stamp under the container-internal canonical slot rooted at `runtime_root` (default `/root/.redeven`). `Start runtime` installs only when the probe reports that no runtime package exists in `<runtime_root>/runtime/managed`, then starts the long-running runtime daemon and waits for `desktop-runtime-status` to confirm daemon health. `Open` then starts the per-Desktop `redeven desktop-bridge` byte-stream protocol using the resolved container-local binary path with `--state-root <runtime_root>`; the bridge attaches to the already-running daemon and never starts a runtime process. Existing damaged or invalid packages surface `Update runtime` instead of being replaced by start/open. A target-version mismatch alone does not make Welcome block `Open`; concrete Runtime Service incompatibility is reported through the Open failure path with version context and an explicit `Update runtime` recovery action. Local UI and runtime-control stay behind a Desktop-owned loopback proxy, and daemon/bridge/bootstrap changes are Runtime/Desktop compatibility surfaces. Container lifecycle remains separate from runtime lifecycle: Redeven lists, saves, and revalidates only running containers, and it never starts or stops the container itself.

The Ubuntu container E2E test keeps this contract executable: it starts only an
already-running container, never asks Redeven to create or stop that container,
and verifies that a second runtime launch against the same state root attaches
to the existing daemon instead of creating another manager process.

## Desktop Launcher UI

Desktop launcher cards keep their current dense SaaS tool layout:

- Status tone continues through `runtime_health` and existing action model.
- Runtime version appears in the existing metadata/fact slot, not as a new
  banner. It is always present; unknown runtime metadata is shown as
  `Version`: `UNKNOWN`.
- Provider Environment cards show `LOCAL LINK` as a compact action when a
  provider binding points at a managed Local/SSH/container runtime. The action
  filters the Environment Library to the linked runtime card and does not act as
  an alternate Open path.
- Runtime lifecycle status and active-work impact stay in the status badge,
  action model, and maintenance guidance instead of adding extra card
  fact rows.
- Provider catalog freshness is tracked separately from route availability:
  stale freshness does not override a last-known online/offline provider route.
  Provider-card refresh first force-syncs the provider catalog, then refreshes
  runtime health for that environment.
- Primary actions remain route-aware:
  - compatible: `Open`
  - unknown Local Host freshness: `Open` first checks the Local Host runtime; if
    the probe reports stopped, the card settles to stopped-runtime guidance with
    `Start runtime` and `Refresh status`
  - not running: `Open` stays disabled and offers `Start runtime`
  - first install needed: `Open` stays disabled and offers `Start runtime`
  - stale lease diagnostic: presented as not running; `Open` stays disabled, the primary recovery is `Start runtime`, and the runtime menu keeps `Restart runtime`, `Update runtime`, and `Refresh status`
  - restart required: `Open` stays disabled and offers `Restart runtime`
  - update required: `Open` remains available as the explicit compatibility
    probe. `Update runtime` or `Update Redeven Desktop` stays as a separate
    runtime-menu action, and Open-time incompatibility appears in the Open
    failure panel with version details.
  - desktop too old: `Update Desktop`
  - runtime-control owner mismatch: provider-link actions stay blocked with owner guidance while host/container operations remain available when the management channel exists
- Runtime lifecycle progress for Local Host, Local Container, SSH Host, and SSH
  Container targets belongs in the owning card's `Open` popup. Open connection
  work has a separate progress model for SSH tunnels, container bridges,
  runtime-control forwarding, Desktop model source preparation, and window
  creation. During either operation, the `Open` trigger remains clickable for
  progress inspection, keeps the existing flowing shimmer treatment, and keeps
  the popup open after the user starts `Start runtime`, `Stop runtime`,
  `Restart runtime`, or `Update runtime` until the user closes it or clicks
  elsewhere. It returns to direct `Open` behavior once the runtime is openable
  and the current Desktop connection is ready. Progress must not use a
  bottom-right SSH-only activity overlay. The progress sequence and failure
  notice must reflect the operation:
  start uses `Starting...` / startup wording, stop uses `Stopping...` plus
  `Verifying runtime stopped`, restart uses `Restarting...` / restart wording,
  and update uses `Updating...` / update wording.
- Recovery guidance and progress disclosure must remain separate. Guidance is
  for blocked or unavailable actions. Progress disclosure is created
  immediately after the user launches lifecycle work, may show a pending
  renderer projection before the main-process operation snapshot arrives, and
  then binds to the authoritative launcher progress. Closing the popup changes
  only visibility; it never cancels the workflow. Success remains visible while
  the popup is open, and failed/canceled/cleanup-failed progress remains visible
  until dismissed.
- Development source-runtime package builds run from an isolated temporary copy
  of the source checkout. This lets `scripts/build_assets.sh` rebuild ignored
  embedded UI outputs without deleting files underneath another target-platform
  `go build`; raw build output belongs in diagnostics, not in the visible
  failure summary.
- Action feedback for completion, failure, and other ephemeral events continues
  through Desktop toasts. No launcher content should shift when a version event
  arrives, and toasts must not become the progress surface for runtime lifecycle
  or Open connection work.

## Env App Settings UI

The existing `Runtime Status` settings card remains the main detailed surface.
It should add rows instead of banners:

- `Service owner`
- `Maintenance authority`
- `Compatibility`
- `Active work`
- `Runtime protocol`

### Runtime Maintenance Authority

Env App must not infer lifecycle actions from `desktop_managed`,
`runtime_kind`, or version policy alone. Desktop exposes an explicit Runtime
Maintenance Context for the current session:

```ts
type RuntimeMaintenanceAuthority =
  | 'runtime_rpc'
  | 'desktop_local'
  | 'desktop_ssh'
  | 'host_device'
  | 'manual';

type RuntimeMaintenanceAction = {
  availability: 'available' | 'unavailable' | 'external';
  method:
    | 'runtime_rpc_restart'
    | 'runtime_rpc_upgrade'
    | 'desktop_local_restart'
    | 'desktop_local_update_handoff'
    | 'desktop_ssh_restart'
    | 'desktop_ssh_force_update'
    | 'host_device_handoff'
    | 'manual';
  label: string;
  title: string;
  message: string;
  detail?: string;
  unavailable_reason_code?: string;
  requires_target_version?: boolean;
};
```

Runtime Service snapshots continue to report service facts. The maintenance
context reports who is allowed to act on this particular session. Env App uses
the context to choose between Desktop shell actions and secure Runtime RPC:

- `runtime_rpc`: call `sys.restart` or `sys.upgrade`.
- `desktop_local`: ask Desktop to restart the local managed service or open the
  Desktop release handoff.
- `desktop_ssh`: ask Desktop to restart the SSH-managed service or force the SSH
  bootstrap installer to refresh the remote runtime.
- `host_device`: show host-device guidance and do not attempt local Desktop
  lifecycle control.
- `manual`: disable direct maintenance actions with the provided reason.

Actions:

- `Restart runtime` starts the main-process restart workflow immediately.
- `Update runtime` starts the main-process runtime package update workflow
  immediately.
- `Manage in Desktop` opens the Desktop update handoff for
  `desktop_release` policy.

Transient update prompts are toast-driven:

- optional update available: `Runtime update ready. Restart when your work is idle.`
- desktop-managed runtime: `Runtime is managed by Redeven Desktop. Use Desktop maintenance controls.`
- failure: `Runtime maintenance failed. Open Runtime Status for details.`

The automatic update floating prompt component is retired. Future explicit,
user-requested maintenance progress may use a dedicated surface only if it is
opened from a user action and never inserts content into the page layout.

## Lifecycle Impact Design

Runtime lifecycle actions surface active-work impact before execution through
card badges, disabled-Open guidance, menu descriptions, and failure diagnostics.
Once the user chooses `Restart runtime` or `Update runtime`, Desktop treats that
choice as the authorization to continue. The progress surface then focuses on
what is happening now: stopping, verifying stopped, updating when needed,
starting, checking service health, or showing the exact failure.

Future idle-aware scheduling can add a separate `Restart when idle` action, but
it should be a distinct menu action rather than a blocking confirmation inserted
mid-workflow.

## Maintenance Flow

The stable flow is intentionally small:

1. Probe or receive a Runtime Service snapshot.
2. Resolve compatibility, active workload, and the current maintenance authority.
3. Keep stable facts in launcher cards or Runtime Settings rows.
4. When the user chooses a disruptive lifecycle action, execute it as one
   uninterrupted, cancelable workflow through the resolved authority:
   - `runtime_rpc`: call `sys.restart` or `sys.upgrade`.
   - `desktop_local`: ask Desktop to restart the local managed service or open the Desktop release handoff.
   - `desktop_ssh`: ask Desktop to restart the SSH-managed service, or run the explicit Desktop-owned runtime package update workflow when the user chooses `Update runtime`. Start and Restart install only missing canonical slots; existing self-consistent slots are reused even when their version differs from the Desktop target. Damaged slots or Open-time Runtime Service incompatibilities surface `Update runtime`. Package preparation reuses the shared release/cache or development source-package path before using any remote installer fallback.
   - `host_device` / `manual`: show guidance and keep direct actions disabled.
5. Reconnect through the normal Env App recovery path and surface completion/failure through toast feedback.

For runtime-owned self-upgrade, `target_version` is required for every
non-dry-run `sys.upgrade` request. `Update started` only means the maintenance
request was accepted. Env App may show `Downloading and installing update...`
while the old process is connected, then `Runtime restarting...` and
`Verifying update...` while it polls. `Updated` is reserved for the point where
`sys.ping.version`, Runtime Service `runtime_version`, or the reconciled
maintenance snapshot reaches the requested release tag. A restart or reconnect
with the old version remains in progress until the marker reports failure or
the controller times out with target/current diagnostics. Env App filters
maintenance snapshots by the current request target and runtime timestamp; for
Desktop-owned update handoff without a target release tag it ignores
runtime-owned upgrade snapshots entirely, so a persisted failure from an earlier
runtime-owned upgrade cannot fail a later Desktop-owned handoff. `Reconnected`
belongs to restart flows, not upgrade completion.

Welcome can run runtime restart/update before an Env App window exists. The card records the runtime maintenance requirement, then the main-process lifecycle workflow performs authoritative preflight and proceeds through the same operation key without a second confirmation or independent retry request. For Local Host update, Welcome opens the Desktop update handoff instead of calling runtime package update, because the local bundled runtime is updated with the Desktop app. Update is still a separate user action; it does not auto-open the Environment after maintenance, and `Open` remains the path that reports concrete compatibility failures with recovery details.

Startup cancellation uses the same lifecycle model for Local, SSH, and container runtime targets. `Stop startup` cancels the current start/update operation, broadcasts the shared cancellation signal through owned runtime subprocesses, downloads, SSH install/start commands, and readiness polling loops, then cleans up local lifecycle resources. Stop workflows must treat a successful stop command as insufficient until the Runtime Service has settled to `not_running` or a stale lock has been safely retired and rechecked. `redeven desktop-runtime-stop` therefore succeeds only after stop verification; if the process still appears alive or status cannot be verified, Desktop keeps the launcher operation failed at the verification step. Open cancellation is separate: `Stop opening` cancels SSH tunnels, container bridges, runtime-control forwarding, Desktop model source preparation, and Env App window creation for the current Desktop session. Successful cancellation is short-lived; cleanup failures remain visible for user attention.
