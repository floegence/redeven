---
type: UI Contract
title: Flower failure recovery
tags: [ai, flower, recovery, interaction]
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Floret owns outcomes, retry checkpoints and automatic historical migrations. Flower keeps accepted content readable with one failure/recovery surface; drafts, queue editing, Stop and navigation remain available. Transport uncertainty never proves success or permits replay. Readiness timeouts offer status refresh; deterministic migration failures remain explicit administrative diagnostics.

# Contract

Stream recovery displays only canonical progress attempts/deadlines. [Live delivery](flower-live-timeline.md#recovery-and-interaction) owns local read failure, revision fencing, one bounded window refresh and connection recovery; reader failure cannot restart the workspace stream.

Before accepted detail, show one floating error/Retry above the transcript without consuming its height or duplicating workspace/composer notices. The shared [notice stack](flower-live-timeline.md#recovery-and-interaction) preserves error explanations and recovery controls while keeping loaded messages and the composer stationary. Unconfirmed Stop remains separate. Loaded conversations retain live-sync recovery; embedded views omit global navigation. Leaving a read fences its completion and preserves Shell drafts without replay.

Full child reports bypass ordinary preview limits but retain provider budget; canonical Retry reuses confirmed complete reports without tool dispatch. [Historical compatibility](../ai/flower-upgrade-compatibility.md) owns supported migration evidence rather than a UI-pinned schema version.

# Boundaries

Floret validates retry checkpoints and confirmed tool results. The host never patches journal records, infers recovery from error prose, replays uncertain effects or starts queued work after failure. SSH access and remote runtime operations remain separate from conversation recovery.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Shared failure, Stop and manual recovery actions.

- `redeven:internal/flower_ui/src/flowerTimelineProjection.ts` - One timeline failure owner.
