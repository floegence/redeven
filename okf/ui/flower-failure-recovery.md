---
type: UI Contract
title: Flower failure recovery
description: One turn-level failure owner and bounded manual recovery without replaying uncertain effects.
tags: [ai, flower, recovery, interaction]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Floret owns canonical execution outcomes and retry checkpoints. Flower keeps
accepted messages readable and provides one turn-level failure and recovery
surface. Navigation, settings exit, drafts and queue editing remain available.
Transport uncertainty never proves backend success or authorizes replay.
Readiness timeouts use the shared bounded request helpers and expose a status
refresh without replaying Prepare or Stop. Deterministic migration failures
remain diagnostic/admin recovery states; supported compaction history is
automatically migrated by published Floret v7.74.0 through schema 29. See
[historical compatibility](../ai/flower-upgrade-compatibility.md).

# Contract

Automatic stream recovery displays only canonical run_progress attempts and deadlines.

Historical-thread loading shows only progress in the transcript. Before accepted detail exists, read failure has one centered notice and Retry action; workspace and composer sync notices do not repeat it. Unconfirmed Stop remains independently visible. Loaded conversations retain live-sync recovery notices. New chat and conversation navigation stay in their existing sidebar or header controls; embedded conversations omit global navigation. Leaving a pending read invalidates its late completion through the existing detail owner. Recovery preserves the shell-owned draft and does not replay work automatically.

Full child reports bypass the ordinary tool preview limit while retaining the provider request budget; canonical retry therefore reuses the complete confirmed reports without dispatching tools.

# Boundaries

Floret validates retry checkpoints and confirmed tool results. The host never patches journal records, infers recovery from error prose, replays uncertain effects or starts queued work after failure. SSH access and remote runtime operations remain separate from conversation recovery.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Shared failure, Stop and manual recovery actions.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Canonical item status projection.

- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - One timeline failure owner.
