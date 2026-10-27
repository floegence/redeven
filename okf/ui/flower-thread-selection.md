---
type: UI Contract
title: Flower conversation selection and detail reads
description: Present navigation feedback before committing content and coordinate bounded canonical detail reads.
tags: [flower, navigation, cancellation, recovery, detail]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Flower acknowledges navigation before transcript work. One coordinator serves
navigation, command confirmation and reference preflight. ThreadCache owns
selection and detail; the loader owns bounded ephemeral demand.
Readiness controls reveal; elapsed time controls feedback only.

# Contract

## Selection and navigation
Rail feedback precedes visible commit by two animation callbacks and a task; hidden documents do not wait for frames. Latest intent supersedes earlier work; summary effects cannot bypass foreground coordination.

Reveal only after accepted detail, measurable layout and visible historical text settle. The scroll owner also prepares the latest active tool sequence after row placement, so both outer and inner tails are positioned before reveal. Restored activity details settle without opening animation; explicit group folds survive and retain a current activity label. Initial positioning has no smooth scrolling or time-based fallback. One cancellable 200 ms deadline spans detail/body/layout loading feedback; ready content/errors appear immediately. Selection, New chat and disposal cancel old feedback; frame, composer/navigation remain stable and failed body reads remain local and retry with renewed viewport demand or reconnect.

Cached destinations flush render effects; visible rows pass `checkVisibility({ contentVisibilityAuto: true })`. ResizeObserver adjusts above-viewport growth before paint, while reveal/body work stays in rAF; visibility events reuse this pass. Navigation clears arrival motion. No positioning polls or per-row observers. Explicit wheel/touch/scrollbar/keyboard input can interrupt preparation; scroll events alone cannot.

Two read slots prioritize visible text/margin and cancel obsolete demand. ThreadCache retains immutable bodies. Growth/refresh/completion never restart selection or remove accepted prose; [live delivery](flower-live-timeline.md) owns validation/retry. Selection opens Latest; reading restoration is separate. Ordinary threads sort by descending creation time, then ascending ThreadID.

## Continuous history and concurrent activity

Users browse earlier and newer history by scrolling. Viewport demand reads
canonical windows automatically; no load-earlier or load-newer action is part
of normal navigation. Retained windows preserve visible, selected and focused
rows while gaps are filled in either direction. Stable item identities preserve
expanded details and scroll anchors during live appends and replacements.
When a collapsed tail is shorter than the viewport, prepending history retains
the visible trailing room required by its reading anchor. The scroll owner
reclaims that room only as it leaves view or content fills it; loading must not
push existing messages down to fill the viewport. Viewport resizing preserves
the anchor, and destination preparation clears the temporary geometry. The
transcript content observer attaches after DOM mounting and corrects growth
before paint. This adds no history reads, persisted state or disclosure changes.
The floating Latest action stays available above the composer while reading
away from latest, including at the bottom of a historical window. It is hidden
during destination preparation and keeps pointer-gesture protection. If the
latest window is already installed, the action scrolls smoothly and retires
retained trailing room at arrival. Otherwise it cancels obsolete reading demand,
installs one bounded tail interest and reveals the prepared latest destination;
it never walks intervening pages. Main and child views share these semantics.
The accepted history baseline belongs to the live observer and reading revision;
superseded navigation cannot replace a newer selection.

Collapsed tools and parent reports retain presentation previews. Full activity
bodies and report text are requested when disclosed, under fresh authorization.
Collapse, navigation and disposal cancel unused demand; reconnect restores active
consumers. Retry is local to an actual read failure. Released empty activity
sources use Floret's canonical default presentation in source order.

Field-only activity presentation remains disabled for ordinary product history
until complete renderer parity is qualified. Complete body expansion is retained;
computer evidence and target hydration can still require full canonical reads.
This release does not promise a fixed opening latency or globally bounded memory
for all expanded terminal output.

## Detail read ownership
Floret supplies canonical summaries, source-bound windows and exact body reads; ThreadCache owns selection/detail with twelve entries. The bounded coordinator shares navigation, confirmation and reference-preflight demand. Cancellation never reconnects the workspace stream.

# Boundaries

The [sidebar contract](flower-thread-sidebar.md) owns conversation rows, title editing, pending-action presentation and pin ordering. A completed detail read alone never marks content as seen. Canonical View and Summary stay in Floret; the host does not reconstruct its history or lifecycle.

# Evidence

- `redeven:internal/flower_ui/src/threadDetailLoader.test.ts` - Shared demand, fresh confirmations, cancellation, explicit retry, settlement and bounded idle records.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.threadPresentation.browser.test.tsx` - First exposed destination, delayed reads, cached switches, cancellation, explicit input and failure recovery.
