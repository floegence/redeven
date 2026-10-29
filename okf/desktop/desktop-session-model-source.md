---
type: Desktop Contract
title: Desktop session and model source
tags: [desktop, sessions, models, flower]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop publishes each Environment session's explicit target route and identity. Accepted Runtime Stop, Restart and Update invalidate attached sessions. One model-source process handle per session starts without delaying Env App; that process owns reconnects while provider credentials remain local. Persisted Flower history stays readable when the live model source is unavailable.

# Contract

- Every `DesktopSessionContextSnapshot` carries `target_route`: Local publishes declared `local_host`/`remote_desktop`; SSH, Gateway and External Local UI publish `remote_desktop`.
- Compaction is a Runtime thread action. Desktop and Env App share canonical timeline/read-state updates rather than inventing transcript messages.
- One Responses transport manager survives control reconnects. Idempotent `ai.thread.transport.release` releases only memory; Floret owns canonical deletion. Exact v4 transport events reject incompatible peers.

# Boundaries

Welcome Flower and Tessiven share compatibility/AI readiness. Returning to preparation disposes stale initialization while parent `ComposerDraftStore` retains drafts. Plugin workers/sandboxes receive no runtime-control endpoint/token; resource access uses released ReDevPlugin brokers and registered adapters.

# Evidence

- `redeven:desktop/src/main/runtimeFlowerStreamOwner.ts` - Runtime event streams release their document ownership on full navigation, renderer crash, or destruction; in-page navigation preserves the active connection.

- `redeven:desktop/src/welcome/FlowerNavigation.client.test.tsx` - Canvas startup waits for AI publication and preserves drafts through recovery.
