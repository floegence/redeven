---
type: Desktop Contract
title: Desktop SSH runtime operations
description: SSH transport isolation, target discovery, and Gateway lifecycle delegation.
tags: [desktop, ssh, runtime, process]
timestamp: 2026-08-17T00:00:00Z
---
# Summary

Desktop shares one lazy, credential-scoped SSH transport manager for access and setup, while the target Gateway performs Runtime lifecycle work. Transport generations fence retries; SSH hostnames, container labels, and Desktop card ids never substitute for a lifecycle target identity.

# Contract

## Transport and setup

The SSH manager keys leases by normalized destination, port, auth mode, SSH binary, and credential scope. A master exit invalidates the pinned generation; the current command returns an interruption and does not silently acquire a replacement or choose another transport. An established bridge may later recover only after exact session identity checks.

SSH discovery follows bounded `Include` rules, excludes wildcard/negated hosts from selectable aliases, and keeps manually entered destinations possible. SSH host, local-container, and SSH-container setup uses an explicit target and supervisor enrollment path. Provider never reads these credentials implicitly.

## Lifecycle delegation

Before build or upload, Desktop requests the Gateway capability and scoped authorization for the exact target/generation and artifact policy. Once prepared, Gateway owns target lock, Runtime fence, workload confirmation, staging, commit, health, and recovery. Desktop reports typed phases and can attach after disconnect; it does not maintain a second SSH lifecycle state machine.

# Boundaries

SSH and container inventory is observational until Gateway accepts a lifecycle operation. Container create/start/stop remains user container tooling. URL access has no Runtime control fallback, and an unavailable Gateway does not disable existing Connect or Workspace sessions.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH lease and generation fencing.
- `redeven:desktop/src/main/sshRuntime.ts:1` - SSH target setup and Gateway lifecycle adapter.
- `redeven:desktop/src/main/containerRuntime.ts:430` - Container lifecycle remains outside Desktop command construction.
- `redeven:internal/runtimegateway/supervisor/` - Shared target lock and operation execution core.
