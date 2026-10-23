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

Cached destinations flush that same layout pass after render effects and before
the task's paint, avoiding a transient loading frame. The two-slot body loader
prepares the latest visible text first, including its existing viewport margin,
and cancels obsolete demand on navigation or transport boundaries. Immutable
bodies remain in ThreadCache; no additional content cache or polling loop exists.
Native scroll events do not prove user intent. The scroll controller's explicit
wheel, touch, scrollbar and keyboard ownership may interrupt preparation.

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
