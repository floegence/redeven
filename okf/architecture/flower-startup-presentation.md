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

Env App and Desktop render canonical readiness facts and explicit safe recovery actions.
The single readiness owner controls Flower admission while navigation and shell-owned
drafts remain available. No surface starts another availability controller. Stop and
retry follow typed safety facts; a close failure requires application restart, and
unknown or contradictory facts expose a non-retryable contract failure.

# Contract

Env App shares one readiness controller across Activity, Workbench, and Settings.

After runtime readiness, the workspace stays in the existing Flower loading presentation until the first authoritative conversation-list page has been applied. A confirmed empty list also admits the workspace. Remaining baseline pages load progressively; the initial boundary does not wait for the complete history inventory. No welcome suggestions, composer, or stale-state reconnect banner appears before this first result. Embedded conversations retain their own detail loading and retry boundary; they do not wait for a sidebar inventory.

Initial connection retries keep the same loading presentation. A terminal failure stops its indicator and offers Retry in place, with localized access, version, capacity, or timeout guidance where applicable. Raw diagnostics and error cards are not part of this entry presentation. The workspace-stream or HTTP list owner still owns reads, deadlines, cancellation and retries; the UI adds no availability controller or timer.

Once admitted, the surface never returns to initial loading on refresh or reconnect. Conversation selection, mounted transcript, drafts and navigation remain available; existing synchronization notices describe subsequent connection failures.

An operational generation stays mounted during historical thread preparation. A selected thread uses its ordinary loading and retry surface, with New chat and conversation navigation available. The oldest snapshot stores may wait for their identity scan before admitting new threads. A thread-local failure does not return the whole product to startup.

Unconfirmed, failed or revoked permissions cannot authorize new mutations; renewed authority reopens the same controls.

The boundary shows completed/total counts only for a known total and preserves shell-owned drafts.

# Boundaries

Readiness UI is a process-local availability projection, never a second Agent lifecycle. See the [owner and generation contract](ai-readiness-lifecycle.md) and [complete-set recovery](../ai/flower-backup-and-recovery.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.initialLoading.test.tsx` - Delayed first page, empty inventory, initial retry, access guidance and subsequent reconnect continuity.

- `redeven:desktop/scripts/check-flower-startup.mjs` - Built Electron renderer keeps the existing loading presentation before its first page, then retains selection and drafts through later pages.

- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.browser.test.tsx:1` - Browser interaction, reflow and recovery coverage.

- `redeven:desktop/src/welcome/flower/DesktopFlowerRuntimeBoundary.client.test.tsx:1` - Stop deduplication, explicit retry, failure and draft continuity.

- `redeven:desktop/src/main/runtimeFlowerRoutes.test.ts:1` - Exact authenticated readiness route and method boundaries.
