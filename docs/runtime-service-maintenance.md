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
  confirmation dialogs.
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
- Risky or disruptive operations use modal confirmation dialogs with impact
  details.
- Existing work keeps priority. A compatibility problem can block creating new
  sessions or using newer functionality, but should not close live terminals
  unless the user explicitly starts maintenance.
- Recovery actions must be verbs users understand: `Restart when idle`,
  `Restart now`, `Update Desktop`, `Open release page`, `Try again`, and
  `Copy diagnostics`.

## Welcome Detection And Safe Start

Desktop treats saved runtimes as long-lived services that can outlive the
Desktop process. On Welcome startup, Refresh, and restored visibility, Desktop
performs read-only detection for saved SSH Host, Local Container, SSH Container,
and saved Redeven URL entries.

Detection rules:

- Detection never starts, stops, restarts, updates, installs, or replaces a
  runtime.
- Detection never creates a session window, Local UI tunnel, container bridge,
  runtime-control forward, desktop model-source connection, or provider binding.
- A target with a running and openable Runtime Service becomes `Open`-ready
  even after Desktop has restarted, because runtime readiness is not tied to
  Electron process memory.
- A saved Redeven URL probe failure is `Unverified`, not `Not started`, and
  `Open` remains available.
- Password-based SSH detection is non-interactive. Automatic detection may use
  a locally stored SSH password for that saved entry; otherwise the card reports
  `Auto detection waits for manual authentication`.

Manual `Start runtime` uses the same probe-first policy. If the runtime is
already running and openable, Start succeeds without launching a replacement
process. If the runtime is running but incompatible, blocked, or missing a
management socket, Desktop surfaces a maintenance requirement and leaves the
existing process alone. Explicit restart/update actions may be offered by the
operation planner, but they require user confirmation and must preserve active
work unless the user accepts the interruption risk.

Blocked runtime reports and operation failures have separate responsibilities.
Runtime reports describe machine-readable attach or maintenance state, such as
`state_dir_locked`, owner metadata, active workload, and compatibility fields.
Desktop operation failures describe the user-visible outcome of an attempted
launcher action through `DesktopOperationFailurePresentation`.

When a start/open/update action fails, the launcher card, progress popover,
toast, and shell maintenance response must render the operation failure
`summary` first. Raw report fields and process streams remain diagnostics. For
example, an unreachable SSH host should surface `SSH connection to "dify"
failed.` while preserving `control_stderr` and the OpenSSH output only under
`Details` / copied diagnostics. Maintenance requirements may include diagnostic
details for support, but those details must not be concatenated into
`Error.message` and must not replace the operation-level summary.

## Data Structures

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
      "provider_origin": "https://dev.redeven.test",
      "provider_id": "dev_redeven",
      "env_public_id": "env_xxx",
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
Desktop-owned package update followed by daemon restart is attachable again.
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

Desktop treats the runtime as a singleton per Local Environment profile, but runtime-card management is no longer derived from whether Desktop "owns" that process. Electron still persists one `desktop_owner_id` under `userData` and passes it to managed child processes with `REDEVEN_DESKTOP_OWNER_ID`; that owner id remains a runtime-control lease for secure RPC surfaces such as provider linking and Desktop model-source binding. Stop, restart, start, and update availability comes from the runtime operation plan built from host access, placement, running state, package state, Runtime Service readiness, and maintenance requirements.

Provider binding is an explicit runtime-card action, not a side effect of `Open` and not a runtime restart plan. Provider cards always open through the provider tunnel and never manage runtime lifecycle. Welcome `Start runtime` starts only the Local/SSH/container runtime represented by that runtime card. It may install the runtime package when the target has no runtime yet, but it must not silently update or replace an existing package. `Update runtime` is the explicit user-visible path for outdated, incompatible, or maintenance-required runtime packages on SSH Host, Local Container, and SSH Container cards. Local Host update is different: the card uses `Update Redeven Desktop` and the `desktop_local_update_handoff` operation method because the bundled local runtime moves with the Desktop app release. `Connect to provider...` obtains provider open-session material, sends the one-time provider-link ticket to the selected running Local/SSH runtime over runtime-control, and lets the runtime start or replace only the provider control-channel goroutine. Once that binding is persisted, it is explicit authorization for later Desktop-managed startup to restore the provider control channel from saved config as part of the runtime lifecycle. `Disconnect from provider` revokes that local authorization and clears the runtime's persisted provider binding; an active control channel is used to notify the provider first, but the local unlink still completes when that channel is already unavailable. Desktop then refreshes provider runtime health from the provider API when the provider Environment is still present instead of locally fabricating an offline state. Active provider-originated work blocks relink. Runtime-control owner mismatch blocks provider-link RPC but does not hide host/container stop or restart operations.

Welcome menu projection comes from the runtime operation plan. `Stop runtime`,
`Restart runtime`, and the placement-specific update action use stable menu
visibility on runtime-owning cards, so blocked or unavailable actions stay in
place as disabled items with the plan message as their reason. `Start runtime`
uses contextual visibility and appears only when startup is the relevant
recovery action. Provider and external URL lifecycle operations use hidden
visibility and must not leak into provider cards or externally managed entries.

Container runtime targets use the same Runtime Service maintenance model. A Local Container or SSH Container card is still a managed runtime card because the user has host access to the machine that can execute `docker` or `podman`; only the process placement differs. Desktop first inspects the running container, detects its platform, and verifies the Desktop stamp/version under the container-internal `runtime_root` (default `/root/.redeven`). `Start runtime` installs only when the probe reports that no runtime package exists, then starts the long-running runtime daemon and waits for `desktop-runtime-status` to confirm daemon health. `Open` then starts the per-Desktop `redeven desktop-bridge` byte-stream protocol using the resolved container-local binary path with `--state-root <runtime_root>`; the bridge attaches to the already-running daemon and never starts a runtime process. Existing mismatched or invalid packages surface `Update runtime` instead of being replaced by start/open. Local UI and runtime-control stay behind a Desktop-owned loopback proxy, and daemon/bridge/bootstrap changes are Runtime/Desktop compatibility surfaces. Container lifecycle remains separate from runtime lifecycle: Redeven lists, saves, and revalidates only running containers, and it never starts or stops the container itself.

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
  action model, and maintenance confirmations instead of adding extra card
  fact rows.
- Provider catalog freshness is tracked separately from route availability:
  stale freshness does not override a last-known online/offline provider route.
  Provider-card refresh first force-syncs the provider catalog, then refreshes
  runtime health for that environment.
- Primary actions remain route-aware:
  - compatible: `Open`
  - not running: `Open` stays disabled and offers `Start runtime`
  - first install needed: `Open` stays disabled and offers `Start runtime`
  - restart required: `Open` stays disabled and offers `Restart runtime`
  - update required: `Open` stays disabled and offers `Update runtime`, or
    `Update Redeven Desktop` for the Local Host bundled runtime
  - desktop too old: `Update Desktop`
  - runtime-control owner mismatch: provider-link actions stay blocked with owner guidance while host/container operations remain available when the management channel exists
- Runtime lifecycle progress for Local Host, Local Container, SSH Host, and SSH
  Container targets belongs in the owning card's `Open` popup. Open connection
  work has a separate progress model for SSH tunnels, container bridges,
  runtime-control forwarding, Desktop model source preparation, and window
  creation. During either operation, the `Open` trigger remains clickable for
  progress inspection, keeps the existing flowing shimmer treatment, and returns
  to direct `Open` behavior once the runtime is openable and the current Desktop
  connection is ready. Progress must not use a bottom-right SSH-only activity
  overlay.
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
  confirm_label: string;
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

- `Restart runtime` opens a confirmation dialog before any restart request.
- `Update Redeven` opens the same impact dialog for self-upgrade.
- `Manage in Desktop` opens the Desktop update handoff for
  `desktop_release` policy.

Transient update prompts are toast-driven:

- optional update available: `Runtime update ready. Restart when your work is idle.`
- desktop-managed runtime: `Runtime is managed by Redeven Desktop. Use Desktop maintenance controls.`
- failure: `Runtime maintenance failed. Open Runtime Status for details.`

The automatic update floating prompt component is retired. Future explicit,
user-requested maintenance progress may use a dedicated surface only if it is
opened from a user action and never inserts content into the page layout.

## Confirmation Dialog Design

Title examples:

- `Restart Runtime Service?`
- `Update Runtime Service?`
- `Update Redeven Desktop?`

Body structure:

1. Short statement: `This Runtime Service is persistent and may have live work.`
2. Impact summary:
   - `3 terminal sessions`
   - `2 connected environment sessions`
   - `1 web service`
3. Version summary when relevant:
   - current runtime version
   - target runtime version
   - Desktop version handoff if runtime is desktop-managed
4. Actions:
   - `Restart now` / `Update now`
   - `Restart when idle` when implemented
   - `Cancel`

`Restart when idle` may initially be disabled with an explanatory tooltip if the
runtime lacks idle detection. The UI contract still reserves this action for the
future so the product model remains stable.

## Maintenance Flow

The stable flow is intentionally small:

1. Probe or receive a Runtime Service snapshot.
2. Resolve compatibility, active workload, and the current maintenance authority.
3. Keep stable facts in launcher cards or Runtime Settings rows.
4. For disruptive actions, show a confirmation dialog with active-work impact.
5. Execute through the resolved authority:
   - `runtime_rpc`: call `sys.restart` or `sys.upgrade`.
   - `desktop_local`: ask Desktop to restart the local managed service or open the Desktop release handoff.
   - `desktop_ssh`: ask Desktop to restart the SSH-managed service or rerun SSH bootstrap with force update, reusing the shared Desktop runtime package cache before using any remote installer fallback.
   - `host_device` / `manual`: show guidance and keep direct actions disabled.
6. Reconnect through the normal Env App recovery path and surface completion/failure through toast feedback.

Welcome can run runtime restart/update before an Env App window exists. The card records the runtime maintenance requirement, asks for explicit confirmation, then reruns the launcher start path for target runtime package updates. For Local Host update, Welcome opens the Desktop update handoff instead of calling runtime package update, because the local bundled runtime is updated with the Desktop app. It does not auto-open the Environment after maintenance; it unlocks `Open` once the refreshed snapshot is openable.

Startup cancellation uses the same lifecycle model for Local, SSH, and container runtime targets. `Stop startup` cancels the current start/update operation, broadcasts the shared cancellation signal through owned runtime subprocesses, downloads, SSH install/start commands, and readiness polling loops, then cleans up local lifecycle resources. Open cancellation is separate: `Stop opening` cancels SSH tunnels, container bridges, runtime-control forwarding, Desktop model source preparation, and Env App window creation for the current Desktop session. Successful cancellation is short-lived; cleanup failures remain visible for user attention.
