---
type: Desktop Contract
title: Desktop transport recovery
tags: [desktop, runtime, transport, recovery]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Each Desktop placement bridge owns one HTTP/2 session, an immutable-generation recovery snapshot, and one exact registry identity. Recovery replaces the stdio exec and HTTP/2 session once through that owner, validates process and Runtime identity, rejects stale callbacks, and disposes transport and model resources through one terminal settlement path. Health observers and individual streams cannot independently recreate the bridge lifecycle.

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

- `redeven:desktop/src/main/nativeLocalTransportRecovery.test.ts:1` - Production HTTP failure routing and explicit Open cover terminal native listener loss, unrelated request isolation, and workspace-preserving lifecycle recovery.

- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.test.ts:280` - Terminal Desktop failure stops protocol acquisition and rejects late connection events.

- `redeven:desktop/src/main/localUIURL.ts:44` - Desktop builds the Env App entry URL under `/_redeven_proxy/env/`.
