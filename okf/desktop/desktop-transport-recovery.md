---
type: Desktop Contract
title: Desktop transport recovery
tags: [desktop, runtime, transport, recovery]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Each placement bridge owns HTTP/2, immutable recovery generation and registry identity. Its owner replaces stdio/session once, verifies process/Runtime, rejects late callbacks and disposes resources at one terminal boundary. Health observers or individual streams cannot independently restart transport.

# Contract

## Recovery presentation
Recovery uses an unboxed layout within the existing shell, with generous whitespace, semantic theme colors, standard buttons, and fine separators around the authoritative countdown or active phase.

A 30-second stalled-app timeout shows an actionable failure instead of an endless loading surface.

## Mechanism
Each established bridge owns one immutable transport-recovery snapshot with a monotonic `generation` and `revision`, the real `waiting`, `connecting`, `paused`, `ready`, or `failed` phase, completed attempt count, known retry and recovery timestamps, a structured failure, and explicitly allowed actions.

Lifecycle generation fencing cancels matching Opens so a late response cannot recreate the old session.

# Boundaries

Transport recovery IPC is a narrow current-session capability. The separate Desktop Restart handoff exposes only the current window's bounded user-authored state to its fresh session, never ports, tokens, other Environment snapshots, Runtime handles, or launcher operations. Terminal transport failure may preserve the renderer window for diagnosis and navigation, but every previously loaded Runtime surface remains non-interactive until a fresh session is explicitly opened.

# Evidence

- `redeven:desktop/src/main/nativeLocalTransportRecovery.test.ts:1` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.test.ts:280` - Tests.
- `redeven:desktop/src/main/localUIURL.ts:44` - Source.
