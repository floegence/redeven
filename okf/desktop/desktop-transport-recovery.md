---
type: Desktop Contract
title: Desktop transport recovery and model-source sessions
tags: [desktop, runtime, transport, recovery]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

A placement bridge owns one immutable recovery generation and exact Environment session. Only its owner replaces transport after validation; late callbacks are fenced. Model-source lifetime survives control reconnects without delaying Env App or persisting transport history, while terminal failure withdraws interaction authority.

# Contract

## Transport recovery
### Recovery presentation
Recovery uses an unboxed layout within the existing shell, with generous whitespace, semantic theme colors, standard buttons, and fine separators around the authoritative countdown or active phase.

A 30-second stalled-app timeout shows an actionable failure instead of an endless loading surface.

Each established bridge owns one immutable transport-recovery snapshot with a monotonic `generation` and `revision`, the real `waiting`, `connecting`, `paused`, `ready`, or `failed` phase, completed attempt count, known retry and recovery timestamps, a structured failure, and explicitly allowed actions.

Lifecycle generation fencing cancels matching Opens so a late response cannot recreate the old session.

## Model-source sessions
- Every `DesktopSessionContextSnapshot` carries `target_route`: Local publishes declared `local_host`/`remote_desktop`; SSH, Gateway and External Local UI publish `remote_desktop`.
- Compaction is a Runtime thread action. Desktop and Env App share canonical timeline/read-state updates rather than inventing transcript messages.
- One Responses transport manager survives control reconnects. Idempotent `ai.thread.transport.release` releases only memory; Floret owns canonical deletion. Exact v4 transport events reject incompatible peers.

# Boundaries

Transport recovery IPC is a narrow current-session capability. The separate Desktop Restart handoff exposes only the current window's bounded user-authored state to its fresh session, never ports, tokens, other Environment snapshots, Runtime handles, or launcher operations. Terminal transport failure may preserve the renderer window for diagnosis and navigation, but every previously loaded Runtime surface remains non-interactive until a fresh session is explicitly opened.

Welcome Flower and Tessiven share compatibility/AI readiness. Returning to preparation disposes stale initialization while parent `ComposerDraftStore` retains drafts. Plugin workers/sandboxes receive no runtime-control endpoint/token; resource access uses released ReDevPlugin brokers and registered adapters.

# Evidence

- `redeven:desktop/src/main/nativeLocalTransportRecovery.test.ts:1` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/createRuntimeReconnectController.test.ts:280` - Tests.
- `redeven:desktop/src/main/localUIURL.ts:44` - Source.

- `redeven:desktop/src/main/runtimeFlowerStreamOwner.ts` - Source.
- `redeven:desktop/src/welcome/FlowerNavigation.client.test.tsx` - Tests.
