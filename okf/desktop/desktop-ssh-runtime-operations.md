---
type: Desktop Contract
title: Desktop SSH runtime operations
description: SSH transport isolation and direct Desktop Runtime lifecycle execution.
tags: [desktop, ssh, runtime, process]
timestamp: 2026-08-20T00:00:00Z
---
# Summary

Desktop shares one lazy, credential-scoped SSH transport manager and executes SSH-host and SSH-container Runtime lifecycle actions through the same direct Desktop coordinator as Local targets. Actions remain recoverable when the Runtime is stopped, stale, unreachable, partially installed, or represented by residual processes. Cached probes are observations only; each click authoritatively acts on the exact saved target. SSH establishment uses the Environment `connect_timeout_seconds` setting (10 seconds by default); remote commands and probes are cancellation-bound, with no second fixed timeout. Transport generations fence retries, and hostnames, container labels, or Desktop card ids never substitute for target identity. The direct coordinator is the only Desktop lifecycle owner; the target stores no Desktop lock, PID lease, daemon, or second state machine.

# Contract

## Transport and setup

The SSH manager keys leases by normalized destination, port, auth mode, SSH binary, and credential scope. A master exit invalidates the pinned generation; the current command returns an interruption and does not silently acquire a replacement or choose another transport. An established bridge may later recover only after exact session identity checks.

SSH discovery follows bounded `Include` rules, excludes wildcard/negated hosts from selectable aliases, and keeps manually entered destinations possible. SSH host, local-container, and SSH-container setup uses an explicit target and supervisor enrollment path. Provider never reads these credentials implicitly.

## Direct lifecycle execution

Desktop creates one Launcher Operation before opening the SSH channel. Start, Stop, Restart, Update, Refresh, Open recovery, and Reinstall reuse that operation owner and publish the same typed lifecycle timeline. If ordinary start or restart is unavailable because the installed Runtime is old, unknown, or damaged, Desktop runs the direct recovery operation and preserves the requested user-facing outcome. Stop remains available as an idempotent cleanup action, including for residual Runtime processes. A confirmed update requested by Open resumes the readiness check and opens only after Runtime health succeeds.

SSH-container execution follows the same order inside the selected exact container: inspect the saved container id or stable reference, start that container first for Start, Restart, Update, or initialization when it is stopped, re-inspect it, then inspect exact process identities, stop verified residuals for restart or update, repair or install the package when required, start one Runtime, and verify one new current process before Open. Stop never starts a stopped container and completes idempotently once the saved container is positively identified as stopped. Start never replaces a live process implicitly. An identity that cannot be tied to the selected user, namespace, state root, and executable remains fail-closed rather than signaling an unrelated process.

Local containers follow the same exact-identity rules through the local engine executor. Local host, SSH host, Local container, and SSH container all share the same main-process Open/lifecycle decision order: probe, choose one recovery operation, execute it, re-probe the same target, then open. Unknown health is not treated as initialization, and a running Runtime makes Start a no-op. If only update is advertised, Update is the convergence operation for Start, Restart, and Open recovery.

Desktop reports typed phases, per-step elapsed time, and actionable terminal failures, and can attach after disconnect without creating a second SSH lifecycle state machine. A slow phase remains visible with its current step and elapsed time, and cancellation, SSH interruption, or process exit closes the operation with retry/diagnostic guidance. An old or incompatible Runtime is classified as an update requirement and exposes Update Runtime before Open. Artifact preparation or upload failure cancels a still-precommit operation; the next user attempt starts a fresh direct operation.

# Boundaries

SSH and container inventory is observational until a lifecycle action executes. Desktop may start only the exact saved container needed for Runtime recovery; it never creates or selects an unrelated container. Engine absence, permission failure, missing container, or SSH failure is reported as the real boundary after the action is attempted. URL access has no Runtime control fallback, and an unavailable Gateway does not disable existing Connect or Workspace sessions.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH lease and generation fencing.
- `redeven:desktop/src/main/sshRuntime.ts:1` - SSH target setup and Gateway lifecycle adapter.
- `redeven:desktop/src/main/containerRuntime.ts:230` - Exact container inspect/start commands and lifecycle recovery verification.
- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts:1` - One in-process owner for direct lifecycle actions.
- `redeven:desktop/src/main/reinstallTargetCoordinator.ts:1` - Direct-channel final recovery without a target-side lock.
- `redeven:desktop/src/main/environmentOpenCoordinator.ts:1` - Unified Open/lifecycle recovery decision.
- `redeven:scripts/smoke_desktop_runtime_lifecycle.mjs:1` - SSH-container and Local-container failure guidance smoke.
