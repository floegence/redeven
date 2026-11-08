---
type: Desktop Contract
title: Desktop transport recovery and model-source sessions
tags: [desktop, runtime, transport, recovery]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

A placement bridge owns one immutable recovery generation and exact Environment session. The existing coordinator waits for Desktop transport readiness inside published source acquisition instead of racing another connection controller. A ready bridge plus repeated retryable upper-layer transport failures requests bounded SSH verification once per protocol attempt; it neither restarts Runtime nor replays requests.

# Contract

## Transport recovery
### Recovery presentation
First load and terminal failures use the full unboxed status surface. After successful admission, recoverable loss uses a compact out-of-flow status with expandable controls/diagnostics; it does not cover the workspace, move content, steal draft focus or expose a full-canvas countdown. Successful protocol and secure-session recovery restores the workspace immediately. Authentication loss and terminal transport failure still withdraw interaction authority.

Local artifact fetch/body acquisition has a 15-second deadline and preserves caller cancellation and upstream retry classification. Paused/failed Desktop state cannot acquire new credentials.

Optional recovery artwork loads separately with fixed placeholder geometry; asset failure cannot hide status or controls.

A 30-second stalled-app timeout shows an actionable failure instead of an endless loading surface.

Each established bridge owns one immutable transport-recovery snapshot with a monotonic `generation` and `revision`, the real `waiting`, `connecting`, `paused`, `ready`, or `failed` phase, completed attempt count, optional SSH transport generation, known retry and recovery timestamps, a structured failure, and explicitly allowed actions.

Lifecycle generation fencing cancels matching Opens so a late response cannot recreate the old session.

## Model-source sessions
- Every `DesktopSessionContextSnapshot` carries `target_route`: Local publishes declared `local_host`/`remote_desktop`; SSH, Gateway and External Local UI publish `remote_desktop`.
- Compaction is a Runtime thread action. Desktop and Env App share canonical timeline/read-state updates rather than inventing transcript messages.
- One Responses transport manager survives control reconnects. Idempotent `ai.thread.transport.release` releases only memory; Floret owns canonical deletion. Exact v4 transport events reject incompatible peers.

# Boundaries

Transport recovery IPC is a narrow current-session capability. The separate Desktop Restart handoff exposes only the current window's bounded user-authored state to its fresh session, never ports, tokens, other Environment snapshots, Runtime handles, or launcher operations. Terminal transport failure may preserve the renderer window for diagnosis and navigation, but every previously loaded Runtime surface remains non-interactive until a fresh session is explicitly opened.

Private-origin replacement clears browser storage. Env App includes its saved
plugin composer/comment cache and selected draft route in this same handoff,
flushes the active workspace before capture, and commits restored storage before
acknowledgment. Failed capture or persistence cannot report successful restoration.
Restored cache is user intent only; opening a draft requires fresh server authority.
The draft query and fragment are product navigation, not IPC authority. Restart
admission retains the exact entry origin/path and other query parameters, root
webContents, main frame and document generation while accepting that navigation.

Welcome Flower and Tessiven share compatibility/AI readiness. Returning to preparation disposes stale initialization while parent `ComposerDraftStore` retains drafts. Plugin workers/sandboxes receive no runtime-control endpoint/token; resource access uses released ReDevPlugin brokers and registered adapters.

# Evidence

- `redeven:desktop/src/main/nativeLocalTransportRecovery.test.ts:1` - Tests.
- `redeven:desktop/src/main/localUIURL.ts:44` - Source.

- `redeven:desktop/src/main/runtimeOpenContinuity.test.ts` - Executes the production Open boundary: bridge-first dialing and no network/auth-triggered lifecycle mutation.
