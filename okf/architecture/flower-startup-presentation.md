---
type: Interaction Contract
title: Flower startup and recovery presentation
description: Keep navigation and drafts available while the single readiness owner prepares, stops or restores Flower.
tags: [flower, startup, readiness, recovery, ui]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Env App/Desktop render one owner’s readiness and typed Stop/Retry facts while
navigation and drafts remain available. Close failure requires application restart;
unknown or contradictory facts are non-retryable contract failures. Surfaces add
no parallel availability controller.

# Contract

Env App shares one readiness controller across Activity, Workbench, and Settings.

After runtime readiness, the workspace stays in the existing Flower loading presentation until the first authoritative conversation-list page or selected conversation detail has been applied. A confirmed empty list also admits the workspace. Remaining baseline pages load progressively; the initial boundary does not wait for the complete history inventory. No welcome suggestions, composer, or stale-state reconnect banner appears before this first content result. An empty partial ready envelope only establishes live authority; it does not admit a false empty workspace. Embedded conversations retain their own detail loading and retry boundary; they do not wait for a sidebar inventory.

Initial connection retries keep the same loading presentation. A terminal failure stops its indicator and offers Retry in place, with localized access, version, capacity, or timeout guidance where applicable. Raw diagnostics and error cards are not part of this entry presentation. Existing stream/HTTP owners retain reads, deadlines, cancellation and retries; UI adds no controller or timer.

Once admitted, the surface never returns to initial loading on refresh or reconnect. Selection, transcript, drafts and navigation remain mounted; existing notices describe connection failures.

[Message continuity](../ui/flower-live-timeline.md) also preserves displayed
prose during body growth and canonical completion. Body locators never restart
initial loading.

An operational generation stays mounted during historical thread preparation. A selected thread uses its ordinary loading and retry surface, with New chat and conversation navigation available. The oldest snapshot stores may wait for their identity scan before admitting new threads. A thread-local failure does not return the whole product to startup.

Unconfirmed, failed or revoked permissions cannot authorize new mutations; renewed authority reopens the same controls.

Show completed/total counts only when total is known.

# Boundaries

Readiness UI is a process-local availability projection, never a second Agent lifecycle. See the [owner and generation contract](ai-readiness-lifecycle.md) and [complete-set recovery](../ai/flower-backup-and-recovery.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.initialLoading.test.tsx` - Delayed first page, empty inventory, initial retry, access guidance and subsequent reconnect continuity.

- `redeven:desktop/scripts/check-flower-startup.mjs` - Built Electron renderer keeps the existing loading presentation before its first page, then retains selection and drafts through later pages.

- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.browser.test.tsx:1` - Browser interaction, reflow and recovery coverage.

- `redeven:desktop/src/welcome/flower/DesktopFlowerRuntimeBoundary.client.test.tsx:1` - Stop deduplication, explicit retry, failure and draft continuity.

- `redeven:desktop/src/main/runtimeFlowerRoutes.test.ts:1` - Exact authenticated readiness route and method boundaries.
