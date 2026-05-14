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
remain automatic unless user confirmation is needed to protect live work.

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
    "desktop_ai_broker": {
      "supported": true,
      "bind_method": "runtime_control_v1"
    },
    "provider_link": {
      "supported": true,
      "bind_method": "runtime_control_v1"
    }
  },
  "bindings": {
    "desktop_ai_broker": {
      "state": "bound",
      "session_id": "broker_xxx",
      "ssh_runtime_key": "ssh:..."
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
  desktop_ai_broker: RuntimeServiceCapability;
  provider_link: RuntimeServiceCapability;
}>;

type RuntimeServiceBindingState = 'unbound' | 'bound' | 'unsupported' | 'error' | 'expired';

type RuntimeServiceBinding = Readonly<{
  state: RuntimeServiceBindingState;
  session_id?: string;
  ssh_runtime_key?: string;
  expires_at_unix_ms?: number;
  model_source?: string;
  model_count?: number;
  missing_key_provider_ids?: string[];
  last_error?: string;
}>;

type RuntimeServiceBindings = Readonly<{
  desktop_ai_broker: RuntimeServiceBinding;
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

- `capabilities.desktop_ai_broker` and `bindings.desktop_ai_broker` let Desktop decide whether an attached SSH runtime can accept the optional `Desktop` model-source binding without falling back to string-based heuristics. A binding error should be shown as model-source availability state, not as a Runtime Service startup failure.
- `capabilities.provider_link` and `bindings.provider_link` describe whether a Desktop-managed Local or SSH runtime can accept an explicit provider-link command and which provider Environment, if any, is currently connected.

### Contract Carriers

- `runtime/local-ui.json`: persisted attach state used by Desktop before spawn.
- `--startup-report-file`: structured readiness report for a newly started
  desktop-managed process.
- `/api/local/runtime/health`: no-unlock health probe for attach viability.
- `/api/local/runtime`: unlocked local runtime info for Env App local mode.
- `sys.ping`: E2EE runtime RPC for Env App after the protocol is connected.

All carriers use `snake_case` on the wire and normalize to camelCase only inside
Env App protocol SDK types.

## Compatibility Decision Table

| State | User Impact | Primary UI |
| --- | --- | --- |
| `compatible` | No action needed | Stable badge/table row only |
| `update_available` | Optional maintenance | Toast once; Settings badge `Update ready` |
| `restart_recommended` | Continue work, plan restart | Toast; action `Restart when idle` |
| `update_required` | Existing work preserved; new risky actions blocked | Dialog-driven maintenance action |
| `desktop_update_required` | Runtime is newer than Desktop | Toast + release handoff; do not downgrade |
| `managed_elsewhere` | Desktop cannot own lifecycle | Stable card state + toast on blocked action |
| `unknown` | Metadata unavailable | Quiet degraded state; diagnostics available |

Desktop treats the runtime as a singleton per Local Environment profile. Desktop-managed ownership is a lease, not a heuristic: Electron persists one `desktop_owner_id` under `userData`, passes it to managed child processes with `REDEVEN_DESKTOP_OWNER_ID`, and only owns an attached runtime when the runtime reports the same id through startup reports, `runtime/local-ui.json`, and Local UI health/runtime endpoints.

Provider binding is an explicit runtime-card action, not a side effect of `Open` and not a runtime restart plan. Provider cards always open through the provider tunnel and never manage runtime lifecycle. Welcome `Start Runtime` starts only the Local or SSH runtime represented by that runtime card. `Connect to provider...` obtains provider open-session material, sends the one-time provider-link ticket to the selected running Local/SSH runtime over runtime-control, and lets the runtime start or replace only the provider control-channel goroutine. Active provider-originated work blocks relink. External-managed runtimes and runtimes leased to another Desktop instance stay outside Desktop ownership and are never silently replaced. Legacy Desktop-managed runtimes without a lease id are restart-reclaimable only when idle for lifecycle maintenance, not for provider binding.

## Desktop Launcher UI

Desktop launcher cards keep their current dense SaaS tool layout:

- Status tone continues through `runtime_health` and existing action model.
- Runtime service facts appear in existing metadata/fact slots, not as new
  banners:
  - `Runtime Service`: `Running`, `Update ready`, `Restart recommended`,
    `Needs update`, `Update Desktop`, `Managed elsewhere`
  - `Version`: `v1.4.2`
  - `Active work`: `3 terminals, 1 web service`
- Primary actions remain route-aware:
  - compatible: `Open`
  - not running: `Open`
  - idle legacy managed runtime: `Open` with a restart-reclaim plan
  - update required: `Open` with restart plan when idle
  - desktop too old: `Update Desktop`
  - managed elsewhere: `Open` stays blocked with owner guidance
- Action feedback continues through Desktop toasts. No launcher content should
  shift when a version event arrives.

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

- automatic optional update: `Runtime update ready. Restart when your work is idle.`
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
   - `desktop_ssh`: ask Desktop to restart the SSH-managed service or rerun SSH bootstrap with force update.
   - `host_device` / `manual`: show guidance and keep direct actions disabled.
6. Reconnect through the normal Env App recovery path and surface completion/failure through toast feedback.

Welcome can run SSH-managed restart/update before an Env App window exists. The card records the runtime maintenance requirement, asks for explicit confirmation, then reruns the launcher start path. It does not auto-open the Environment after maintenance; it unlocks `Open` once the refreshed snapshot is openable.

SSH startup cancellation uses the same lifecycle model. `Stop startup` cancels the current start/update operation, broadcasts the shared cancellation signal through owned subprocesses, downloads, SSH commands, broker preparation, binding requests, and polling loops, then cleans up local resources. Successful cancellation is short-lived; cleanup failures remain visible for user attention.
