---
type: UI Contract
title: Flower failure recovery
description: One turn-level failure owner and bounded manual recovery without replaying uncertain effects.
tags: [ai, flower, recovery, interaction]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Floret owns outcomes, retry checkpoints and automatic historical migrations. Flower keeps accepted content readable with one failure/recovery surface; drafts, queue editing, Stop and navigation remain available. Transport uncertainty never proves success or permits replay. Readiness timeouts offer status refresh; deterministic migration failures remain explicit administrative diagnostics.

# Contract

Stream recovery displays only canonical progress attempts/deadlines. [Live delivery](flower-live-timeline.md#recovery-and-interaction) owns local read failure, revision fencing, one bounded window refresh and connection recovery; reader failure cannot restart the workspace stream.

Before accepted detail, show one centered transcript error/Retry, not duplicate workspace/composer notices. Unconfirmed Stop remains separate. Loaded conversations retain live-sync recovery; embedded views omit global navigation. Leaving a read fences its completion and preserves Shell drafts without replay.

Full child reports bypass ordinary preview limits but retain provider budget; canonical Retry reuses confirmed complete reports without tool dispatch. [Historical compatibility](../ai/flower-upgrade-compatibility.md) owns supported migration evidence rather than a UI-pinned schema version.

# Boundaries

Floret validates retry checkpoints and confirmed tool results. The host never patches journal records, infers recovery from error prose, replays uncertain effects or starts queued work after failure. SSH access and remote runtime operations remain separate from conversation recovery.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Shared failure, Stop and manual recovery actions.

- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Canonical item status projection.

- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - One timeline failure owner.
