---
type: UI Contract
title: Flower conversation selection and detail reads
description: Present navigation feedback before committing content and coordinate bounded canonical detail reads.
tags: [flower, navigation, cancellation, recovery, detail]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Flower presents the latest selection intent before transcript work and uses one
coordinator for navigation, command confirmation and reference preflight reads.
ThreadCache owns committed selection and accepted detail; the loader owns only
bounded ephemeral demand.

# Contract

## Selection and navigation
The rail acknowledges a selection with a short-lived navigation intent before committing the conversation. Foreground detail requests cannot bypass this boundary through summary effects.

Visible selection schedules commit after one feedback rendering opportunity
(two animation callbacks and a task); hidden documents commit without waiting
for animation frames. Latest intent supersedes earlier scheduled work.

The destination transcript is exposed only after accepted detail, measurable
layout and destination-visible historical text have settled. The existing scroll
controller positions and reveals it in one layout pass, without smooth initial
scrolling. Preparation has no elapsed-time reveal fallback. Cold navigation
shows separate loading feedback confined to the transcript region; failed body
reads expose local Retry. The composer and navigation remain available.

Cached destinations flush the same layout pass after render effects, before
paint. Historical `content-visibility: auto` placeholders are not real layout:
visible row content must pass `checkVisibility({ contentVisibilityAuto: true })`
before reveal, even with cached text. One capture listener routes non-bubbling
`contentvisibilityautostatechange` events through the scroll owner's existing
coalesced resize/layout pass. Preparation waits for native layout; no timers,
polling, per-row observers or disabled offscreen optimization.

The two-slot body loader prioritizes the latest visible text plus its existing
margin and cancels obsolete navigation/transport demand. ThreadCache retains
immutable bodies. Explicit wheel, touch, scrollbar or keyboard ownership can
interrupt preparation; native scroll events alone cannot.

Already displayed text also remains visible when a live body grows, an accepted
baseline refreshes, or a source becomes canonical. These transitions do not
restart selection preparation or replace prose with a loading skeleton.
Live bodies resume from the accepted UTF-8 byte offset in at most 16 KiB reads
through published Floret ItemBody and ReadLiveBody. The same two-slot loader
coalesces extent changes, lets in-flight chunks finish, and yields between
chunks. Failed reads retain text and expose local Retry; idle bodies do no work.

Selection continues to open the latest interval. Per-thread reading-position
restoration is a separate product policy, not part of presentation stabilization.

Ordinary conversations remain ordered by creation time descending, then ThreadID ascending.

## Detail read ownership
Published Floret v7.69.1 already supplies ThreadSummaryReader.Summary.

ThreadCache remains the sole owner of accepted detail and committed selection, bounded to twelve detail entries.

Neither selection nor detail cancellation reconnects the workspace stream.

# Boundaries

The [sidebar contract](flower-thread-sidebar.md) owns conversation rows, title editing, pending-action presentation and pin ordering. A completed detail read alone never marks content as seen. Canonical View and Summary stay in Floret; the host does not reconstruct its history or lifecycle.

# Evidence

- `redeven:internal/flower_ui/src/threadDetailLoader.test.ts` - Shared demand, fresh confirmations, cancellation, explicit retry, settlement and bounded idle records.

- `redeven:internal/flower_ui/src/threadSelectionSchedule.test.ts` - Visible feedback, hidden documents and idempotent commit cancellation.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Latest selection, retained drafts and interaction ownership.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.threadPresentation.browser.test.tsx` - First exposed destination, delayed reads, cached switches, cancellation, explicit input and failure recovery.
- `redeven:desktop/scripts/check-flower-startup.mjs` - Built Electron rendering opportunities on repeated cached selection, with owned-process cleanup.
