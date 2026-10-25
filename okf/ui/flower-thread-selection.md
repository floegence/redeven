---
type: UI Contract
title: Flower conversation selection and detail reads
description: Present navigation feedback before committing content and coordinate bounded canonical detail reads.
tags: [flower, navigation, cancellation, recovery, detail]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Flower acknowledges navigation before transcript work. One coordinator serves
navigation, command confirmation and reference preflight. ThreadCache owns
selection and detail; the loader owns bounded ephemeral demand.
Readiness controls reveal; elapsed time controls feedback only.

# Contract

## Selection and navigation
Rail feedback precedes visible commit by two animation callbacks and a task; hidden documents do not wait for frames. Latest intent supersedes earlier work; summary effects cannot bypass foreground coordination.

Reveal only after accepted detail, measurable layout and visible historical text settle. The scroll owner positions without smooth initial scrolling or time-based fallback. One cancellable 200 ms deadline spans detail/body/layout loading feedback; ready content/errors appear immediately. Selection, New chat and disposal cancel old feedback; frame, composer/navigation remain stable and body failures offer Retry.

Cached destinations flush render effects; visible rows pass `checkVisibility({ contentVisibilityAuto: true })`. ResizeObserver adjusts above-viewport growth before paint, while reveal/body work stays in rAF; visibility events reuse this pass. Navigation clears arrival motion. No positioning polls or per-row observers. Explicit wheel/touch/scrollbar/keyboard input can interrupt preparation; scroll events alone cannot.

Two read slots prioritize visible text/margin and cancel obsolete demand. ThreadCache retains immutable bodies. Growth/refresh/completion never restart selection or remove accepted prose; [live delivery](flower-live-timeline.md) owns validation/retry. Selection opens Latest; reading restoration is separate. Ordinary threads sort by descending creation time, then ascending ThreadID.

## Detail read ownership
Released Floret's `ThreadSummaryReader.Summary` owns summaries; ThreadCache owns selection/detail with twelve entries. The bounded coordinator shares navigation, confirmation and reference-preflight demand. Cancellation never reconnects the workspace stream.

# Boundaries

The [sidebar contract](flower-thread-sidebar.md) owns conversation rows, title editing, pending-action presentation and pin ordering. A completed detail read alone never marks content as seen. Canonical View and Summary stay in Floret; the host does not reconstruct its history or lifecycle.

# Evidence

- `redeven:internal/flower_ui/src/threadDetailLoader.test.ts` - Shared demand, fresh confirmations, cancellation, explicit retry, settlement and bounded idle records.

- `redeven:internal/flower_ui/src/threadSelectionSchedule.test.ts` - Visible feedback, hidden documents and idempotent commit cancellation.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Latest selection, retained drafts and interaction ownership.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.threadPresentation.browser.test.tsx` - First exposed destination, delayed reads, cached switches, cancellation, explicit input and failure recovery.
- `redeven:desktop/scripts/check-flower-startup.mjs` - Built Electron rendering opportunities on repeated cached selection, with owned-process cleanup.
