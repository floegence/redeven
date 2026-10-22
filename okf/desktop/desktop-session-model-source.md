---
type: Desktop Contract
title: Desktop session and model source
description: Session routing, Desktop model catalog, Flower attach, and lifecycle invalidation.
tags: [desktop, sessions, models, flower]
timestamp: 2026-10-18T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop session context publishes an explicit target route and owns the current Environment session identity. Runtime Stop, Restart, and Update invalidate attached sessions at accepted lifecycle boundaries. Desktop owns one model-source process handle per Environment session without delaying Env App presentation; the process owns connection recovery while provider credentials remain local. Flower history remains available from persisted state when that live model source is unavailable.

# Contract

## Mechanism
Desktop main owns the complete session-context route contract. Every `DesktopSessionContextSnapshot` carries a required `target_route`: Local Environment targets publish their declared `local_host` or `remote_desktop` route, while SSH, Gateway, and External Local UI targets always publish `remote_desktop`.

The Desktop bridge treats compaction as a thread action, not as a transcript message or a local UI-only marker, so Desktop and Env App receive the same live timeline decorations and read-state patches from the runtime.

The executor retains one Responses transport manager across control reconnects. The idempotent ai.thread.transport.release management command releases only in-memory transport resources; canonical deletion remains Floret-owned. Transport events pass through the exact v4 contract; incompatible peers fail immediately.

# Boundaries

Welcome's full Flower page and embedded Tessiven conversation use the same Runtime compatibility and AI readiness boundary. A transition back to preparation disposes stale Flower initialization, while the parent-owned ComposerDraftStore preserves drafts for the next ready instance.

Plugin workers and sandbox surfaces must not receive runtime-control endpoint data, use runtime-control bearer tokens, or treat runtime-control routes as plugin capabilities; plugin access to Redeven resources must go through released ReDevPlugin brokers and Redeven-registered adapters.

# Evidence

- `redeven:desktop/src/main/runtimeFlowerStreamOwner.ts` - Runtime event streams release their document ownership on full navigation, renderer crash, or destruction; in-page navigation preserves the active connection.

- `redeven:desktop/src/welcome/FlowerNavigation.client.test.tsx` - Canvas startup waits for AI publication and preserves drafts through recovery.

- `redeven:internal/envapp/ui_src/src/styles/desktop-tessiven-model.browser.test.tsx` - Real browser placement, configured Desktop model and draft recovery in light and dark themes.
