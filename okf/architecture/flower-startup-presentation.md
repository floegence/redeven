---
type: Interaction Contract
title: Flower startup and recovery presentation
description: Keep navigation and drafts available while the single readiness owner prepares, stops or restores Flower.
tags: [flower, startup, readiness, recovery, ui]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App and Desktop render canonical readiness facts and explicit safe recovery actions.
The single readiness owner controls Flower admission while navigation and shell-owned
drafts remain available. No surface starts another availability controller. Stop and
retry follow typed safety facts; a close failure requires application restart, and
unknown or contradictory facts expose a non-retryable contract failure.

# Contract

Env App shares one readiness controller across Activity, Workbench, and Settings.

An operational generation stays mounted during historical thread preparation. A selected thread uses its ordinary loading and retry surface, with New chat and conversation navigation available. The oldest snapshot stores may wait for their identity scan before admitting new threads. A thread-local failure does not return the whole product to startup.

Unconfirmed, failed or revoked permissions cannot authorize new mutations; renewed authority reopens the same controls.

The boundary shows completed/total counts only for a known total and preserves shell-owned drafts.

# Boundaries

Readiness UI is a process-local availability projection, never a second Agent lifecycle. See the [owner and generation contract](ai-readiness-lifecycle.md) and [complete-set recovery](../ai/flower-backup-and-recovery.md).

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/flower/AIReadinessBoundary.browser.test.tsx:1` - Browser interaction, reflow and recovery coverage.

- `redeven:desktop/src/welcome/flower/DesktopFlowerRuntimeBoundary.client.test.tsx:1` - Stop deduplication, explicit retry, failure and draft continuity.

- `redeven:desktop/src/main/runtimeFlowerRoutes.test.ts:1` - Exact authenticated readiness route and method boundaries.
