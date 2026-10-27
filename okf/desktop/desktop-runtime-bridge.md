---
type: Desktop Contract
title: Desktop runtime bridge
description: Canonical navigation and security boundary for Desktop-integrated Runtime access and direct lifecycle.
tags: [desktop, runtime, bridge, lifecycle]
timestamp: 2026-08-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop opens independently runnable Runtime through machine-readable startup, scoped transport and session contracts. Its process-local coordinator owns direct Local, WSL, SSH and container lifecycle. Gateway/Provider remain access routes. Runtime service, health, process and session observations cannot become competing owners; plugins use their released brokers rather than Desktop control credentials.

# Contract

- [Process lifecycle](desktop-runtime-process-lifecycle.md) owns coordination and exact-target actions; [readiness](desktop-runtime-readiness.md) owns compatible admission.
- [SSH](desktop-ssh-runtime-operations.md), [WSL](desktop-wsl-runtime-operations.md) and [reinstall](desktop-reinstall-operations.md) define direct execution. [Transport recovery](desktop-transport-recovery.md) owns bridge generations and disposal.
- [Session/model source](desktop-session-model-source.md) owns target routes, model-process lifetime and session invalidation. Private bridge tokens never move between partitions or attach to public origins.

# Boundaries

Runtime control is Desktop coordination, not a general network API or plugin grant. [ReDevPlugin](../architecture/redevplugin-boundary.md) retains its separate execution and capability boundary.

# Evidence

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts` - Single target owner.
- `redeven:desktop/src/main/codespaceNativeSession.ts` - Isolated request authentication.
