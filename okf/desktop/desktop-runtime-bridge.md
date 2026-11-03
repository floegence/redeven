---
type: Desktop Contract
title: Desktop runtime bridge
tags: [desktop, runtime, bridge, lifecycle]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop opens independent Runtime through startup, scoped transport and sessions. Its process-local coordinator manages Local/WSL/SSH/container lifecycle; Gateway/Cloud remain routes. Observations never create competing owners; plugins use released brokers, not Desktop credentials.

# Contract

- [Process lifecycle](desktop-runtime-process-lifecycle.md) owns coordination and exact-target actions; [readiness](desktop-runtime-readiness.md) owns compatible admission.
- [SSH](desktop-ssh-runtime-operations.md), [WSL](desktop-wsl-runtime-operations.md) and [reinstall](desktop-reinstall-operations.md) define direct execution. [Transport recovery](desktop-transport-recovery.md) owns bridge generations and disposal.
- [Session/model source](desktop-session-model-source.md) owns target routes, model-process lifetime and session invalidation. Private bridge tokens never move between partitions or attach to public origins.

# Boundaries

Runtime control is Desktop coordination, not a general network API or plugin grant. [ReDevPlugin](../architecture/redevplugin-boundary.md) retains its separate execution and capability boundary.

# Evidence

- `redeven:desktop/src/main/runtimeLifecycleCoordinator.ts` - Source.
- `redeven:desktop/src/main/codespaceNativeSession.ts` - Source.
