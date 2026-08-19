---
type: Desktop Contract
title: Desktop SSH runtime operations
description: SSH transport isolation, target discovery, and Gateway lifecycle delegation.
tags: [desktop, ssh, runtime, process]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

Desktop shares one lazy, credential-scoped SSH transport manager for access and setup, while the target Gateway performs host Runtime lifecycle work. Local, SSH-host, and SSH-container actions remain recoverable when the Runtime is stopped, old, unreachable, partially installed, or represented only by verified residual processes. A cached probe is an observation, never a reason to remove a direct lifecycle entry point; the click performs the authoritative probe. Transport generations fence retries; SSH hostnames, container labels, and Desktop card ids never substitute for a lifecycle target identity.

# Contract

## Transport and setup

The SSH manager keys leases by normalized destination, port, auth mode, SSH binary, and credential scope. A master exit invalidates the pinned generation; the current command returns an interruption and does not silently acquire a replacement or choose another transport. An established bridge may later recover only after exact session identity checks.

SSH discovery follows bounded `Include` rules, excludes wildcard/negated hosts from selectable aliases, and keeps manually entered destinations possible. SSH host, local-container, and SSH-container setup uses an explicit target and supervisor enrollment path. Provider never reads these credentials implicitly.

## Lifecycle delegation

Before build or upload, Desktop requests the Gateway capability and scoped authorization for the exact target/generation and artifact policy. Once prepared, Gateway owns target lock, Runtime fence, workload confirmation, staging, commit, health, and recovery. If ordinary start or restart is unavailable because the installed Runtime is old, unknown, or damaged, Desktop routes that intent through the authoritative update operation and preserves the requested user-facing outcome. Stop remains available as an idempotent cleanup action, including for positively identified residual Runtime processes. A confirmed update that was requested by Open resumes the readiness check and opens only after Runtime health succeeds.

SSH-container execution follows the same order inside the selected exact container: inspect the saved container id or stable reference, start that container first for Start, Restart, Update, or initialization when it is stopped, re-inspect it, then inspect exact process identities, stop verified residuals for restart or update, repair or install the package when required, start one Runtime, and verify one new current process before Open. Stop never starts a stopped container and completes idempotently once the saved container is positively identified as stopped. Start never replaces a live process implicitly. An identity that cannot be tied to the selected user, namespace, state root, and executable remains fail-closed rather than signaling an unrelated process.

Desktop reports typed phases and can attach after disconnect; it does not maintain a second SSH lifecycle state machine. Artifact preparation or upload failure cancels a still-precommit operation so its Gateway target lock is released and the next user attempt starts cleanly.

# Boundaries

SSH and container inventory is observational until a lifecycle action executes. Desktop may start only the exact saved container needed for Runtime recovery; it never creates or selects an unrelated container. Engine absence, permission failure, missing container, or SSH failure is reported as the real boundary after the action is attempted. URL access has no Runtime control fallback, and an unavailable Gateway does not disable existing Connect or Workspace sessions.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH lease and generation fencing.
- `redeven:desktop/src/main/sshRuntime.ts:1` - SSH target setup and Gateway lifecycle adapter.
- `redeven:desktop/src/main/containerRuntime.ts:230` - Exact container inspect/start commands and lifecycle recovery verification.
- `redeven:internal/runtimegateway/supervisor/` - Shared target lock and operation execution core.
