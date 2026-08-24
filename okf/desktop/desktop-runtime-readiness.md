---
type: Desktop Contract
title: Desktop runtime readiness
description: Direct Runtime health, access readiness, and Open recovery boundaries.
tags: [desktop, runtime, startup, readiness]
timestamp: 2026-08-24T00:00:00Z
---
# Summary

Desktop derives managed Runtime readiness from the exact Local, SSH, or container target, while access-only Gateway/Provider/URL readiness remains separate. A managed Environment opens only after the current Runtime reports compatible service and Local UI readiness. Missing, stopped, old, or damaged Runtime state selects a direct Desktop Start, Update, or reinstall recovery; it never invokes Gateway or Provider lifecycle. A transient status gap during startup is observed within the bounded readiness deadline and is not treated as process exit.

# Contract

## Local Environment

Every Desktop installation includes a managed Local Environment. Desktop uses two explicit paths consistently:

- outer Desktop `stateRoot` for Runtime `--state-root`, startup report, process lock, control socket, and status lookup;
- nested Local Environment `runtimeRoot` for managed files and process inventory.

Start, Auto Start, Open, Stop, Restart, Update, Refresh, and Reinstall use that same pair and the same lifecycle coordinator. Desktop does not append `local-environment` twice or infer one path from the other during attach. A new process that has published listeners but not yet published final status remains in the bounded startup wait. Failure is reported only when the process exits, the state path is inaccessible, the service reports failure, or the readiness deadline expires with the original logs retained.

Packaged Desktop validates the Runtime-only bundle manifest, version, commit, platform, architecture, file inventory, executable permissions, sizes, and digests before modifying the Local installation. Missing or mismatched managed files trigger the direct Runtime repair path. Desktop update handoff tells the user that installation restarts Desktop and the Local Runtime and interrupts Local sessions; choosing Later changes nothing.

## Managed remote readiness

SSH-host, local-container, and SSH-container readiness is observed through the saved direct channel. Open uses one main-process flow:

```text
probe -> decide -> lifecycle when needed -> re-probe same target -> open
```

A healthy Runtime opens directly. A stopped Runtime offers Start and Open. An incompatible Runtime offers Update and Open. Unknown or failed health offers Refresh with the real direct-channel diagnostic. A successful lifecycle step cannot complete Open until the same target produces a fresh compatible readiness observation.

Runtime process health, Runtime Service compatibility, Local UI availability, Workspace readiness, AI readiness, Provider link, and Gateway access are separate facts. AI or Provider failure does not make a healthy Runtime installation unavailable. Gateway failure affects only sessions routed through that Gateway.

## Capability and progress

Local and registered SSH/container targets are direct managed Environments and retain all direct lifecycle actions in every diagnosis state. Gateway, Provider, and URL entries without a direct management registration are access-only and expose no Runtime lifecycle action.

One Launcher Operation owns Open and any nested direct Runtime recovery. Runtime recovery temporarily selects the Runtime lifecycle progress surface, then returns to Open without completing or deleting the parent operation. Renderer binds the exact operation key and start identity; it does not select an older operation, infer progress from card state, or synthesize long-lived steps.

All operation labels, details, errors, recovery actions, tooltips, and accessibility text use structured keys and localized catalogs. Raw command stderr remains literal only inside technical diagnostics.

# Boundaries

Read-only health probes do not start, stop, repair, or reconnect Runtime. Access endpoints are not management channels. Runtime handles its internal sessions and graceful signal cleanup, but it exposes no Provider/Gateway lifecycle authority. Desktop is the only component that decides and executes a managed Runtime recovery.

# Evidence

- `redeven:desktop/src/main/desktopBundle.ts:1` - Runtime-only bundle identity and file validation.
- `redeven:desktop/src/main/desktopWelcomeRuntimeState.ts:1` - Local readiness hydration with explicit state and Runtime roots.
- `redeven:desktop/src/main/runtimeProcess.ts:1` - Local inventory and status lookup path contract.
- `redeven:desktop/src/main/runtimeLifecycleReadiness.ts:1` - Bounded healthy and stopped completion barriers.
- `redeven:desktop/src/main/environmentOpenCoordinator.ts:1` - One probe/decide/lifecycle/re-probe/open flow.
- `redeven:desktop/src/main/launcherOperations.ts:1` - Authoritative progress surface and terminal state.
- `redeven:desktop/src/shared/environmentManagementPrinciples.ts:1` - Direct managed versus access-only capability boundary.
- `redeven:desktop/src/welcome/App.tsx:1` - Localized action menu, progress, and recovery presentation.
