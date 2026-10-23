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

Flower acknowledges navigation before transcript work. One coordinator serves
navigation, command confirmation and reference preflight. ThreadCache owns
selection and detail; the loader owns bounded ephemeral demand.
Readiness controls reveal; elapsed time controls feedback only.

# Contract

## Selection and navigation
The rail acknowledges intent before commit. Visible selection commits after one
feedback rendering opportunity (two animation callbacks and a task); hidden
documents do not wait for frames. Latest intent supersedes earlier work. Summary
effects cannot bypass this boundary for foreground reads.

Expose the destination only after accepted detail, measurable layout and visible
historical text settle. The scroll controller positions and reveals it without
smooth initial scrolling or an elapsed-time reveal fallback. Show loading feedback
only after 200 ms, using one cancellable deadline across detail, body and layout
preparation. Ready content and errors appear immediately, without minimum dwell.
New selection, New chat and disposal cancel old feedback. Keep the transcript
frame, composer and navigation stable; failed body reads expose local Retry.

Cached destinations flush layout after render effects. Visible historical rows
must pass `checkVisibility({ contentVisibilityAuto: true })` before reveal.
Above-viewport rows can expand later: ResizeObserver corrects scroll before paint,
while reveal and body requests stay in rAF to avoid observer loops. Visibility
events reuse that pass. Navigation clears old arrival motion; native offscreen
skipping, bounded reads and manual scrolling remain. No positioning polling or
per-row observers are added.

Two body-read slots prioritize latest visible text plus margin and cancel obsolete
demand; ThreadCache retains immutable bodies. Wheel, touch, scrollbar or keyboard
input can interrupt preparation; native scroll events alone cannot.

Growth, refresh and canonical completion preserve displayed prose without
restarting selection. [Live delivery](flower-live-timeline.md) owns incremental
body reads, source validation and local Retry.

Selection opens the latest interval; reading-position restoration is separate.

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
