---
type: Architecture Contract
title: Remote browser presentation
description: Present stable tab geometry and continuous input through current source authority.
tags: [architecture, browser, ui, security]
timestamp: 2026-09-26T00:00:00Z
---
# Summary

- Authority: released FloeBrowser owns document readiness, geometry and input fencing; the environment owner admits control through its private Runtime token.
- Outcome: a first tab visit presents its settled geometry, with inert painted continuity during preparation; transient hit-target changes preserve subsequent scrolling without rebuilding the document.
- Invariants: host completion alone grants no input; source grants and responsive sizing precede presentation; cached documents never accept input.
- Failure boundary: changed targets, revoked control and disconnected views cancel obsolete preparation; uncertain source input is never replayed. Websites retain their own admission decisions.

# Contract

[Browser surface ownership](remote-browser-surface.md) defines product windows,
source selection, themes and the authenticated document boundary. FloeBrowser owns
the reusable rendering behavior described here; Redeven must consume its published
contracts rather than copy engine implementation.

## Input readiness and navigation

The environment window forwards input readiness only after both the private
control token and the matching source control grant arrive. Revocation and tab
changes remain immediate; a delayed token cannot revive a revoked grant.
Address submissions additionally wait for idle-control admission. HTTP responses and DOM/control messages may
arrive in either order. A changed tab, newer address or disconnected view cancels
an unsubmitted navigation; previously submitted input is never retried.

The released viewer suspends page gestures from explicit navigation intent through
control admission and source completion. It discards unsent input and reports
readiness only when input can resume. A canceled before-unload decision restores
the original page; late completion cannot release a newer navigation's input
fence. Browser chrome, stop and dialog replies remain available throughout.
Repeated clicks on an already focused text field receive a fresh source focus
confirmation and restore the visible native caret without replaying a click.
Chrome and Electron product qualification exercises this behavior through the
same authorized Flowersec Session, including Unicode text insertion.

Initial pointer and wheel targets can move, disappear, be replaced or become covered
between projection and dispatch. Published FloeBrowser reports these known
no-effect cancellations as `target_changed`. It discards the gesture without
retargeting or replaying it, without forcing a new snapshot, and without an
interrupting warning. Subsequent input uses the current projected target.
An invalid view epoch or a missing DOM sequence still requires snapshot recovery;
authorization failures and uncertain source effects remain visible. Redeven must
not suppress generic failures or add another input/recovery loop around the SDK.
Source hosts and view descriptors require projection protocol 24 and media wire
version 1. The document adapter validates against the published SDK constants;
older or newer protocol versions fail before a view can receive input.

## Continuous pointer gestures

Published FloeBrowser 0.1.21 owns drag coordinates and scheduling. Pointer-down and
ordinary click release keep source hit testing; after actual motion, held moves
and release reference that admitted origin in its document viewport. A thumb
moving ahead of DOM replay cannot change
the coordinate system. The source requires the original live node, current epoch,
held button and host authorization, and validates containing frames and occlusion.
Chromium owns pointer capture and website event delivery. Redeven must not rewrite
coordinates, predict slider positions or add a second input queue.

The viewer retains only the latest unsent position while a move awaits confirmation.
Release flushes that position before pointer-up; focus loss, failure, navigation and
disconnection discard it. Late acknowledgements cannot revive an old gesture or
cancel a newer one. These are generic pointer semantics, qualified with neutral
sliders through the actual Chrome and Desktop Flowersec carriers. They do not
change website verification or guarantee third-party admission.

## Tab geometry and continuity

Managed profiles launch with a native viewport. Only Runtime-owned managed
sources grant the released Playwright adapter `windowViewport` authority: each
authorized viewport update sizes the native window contents as well as the
selected target. New tabs therefore inherit the current display dimensions
before website scripts initialize or cache click geometry. Target emulation
still owns each tab's zoom; resizing the native window does not reset another
controlled tab's viewport. Borrowed personal Chrome pages and extension sources
never receive authority to resize the user's native window. This fixes unintended
initial layout changes without rewriting website coordinates, reloading an
existing page or replaying input. Websites own their response to an intentional
user resize after initialization.

The viewer keeps at most three complete inert tab documents for immediate visual
feedback. The selected preview remains painted while its replacement prepares
offscreen, and swaps only after styles, selection acknowledgement, idle-control
admission and responsive source sizing settle. The document requests idle control
through the released viewer's cancellable `onPrepareView` hook once per selection,
never from a live-status or tab-list notification. Control revocation invalidates
admission so a resumed hidden view prepares its lease again. A successful host
response and the matching source grant must both arrive before controller sizing; denial keeps
the view in observation mode. Selection changes and disconnect cancel preparation,
and late results cannot present an old target. This prevents first-visit centering,
alignment and size changes after the new document becomes visible. An uncached
selection keeps the outgoing painted document inert until its replacement is ready,
including first visits, cache eviction and cached layouts from a different window
size. Cached presentation grants no input: only fresh source selection,
control admission and a complete current document enable page interaction.
Background URL changes, removed directory grants and disconnect evict caches.
Only browsers with state-preserving DOM moves retain iframe documents; other
engines retain the outgoing document in place during preparation and dispose it
after replacement. Page title changes do not invalidate a document. The same
continuity contract applies to observers and controllers; source URL changes and
revocation still invalidate the corresponding presentation.

## Scriptless replay and website admission

The source-page replay remains scriptless. Only the trusted browser chrome
executes locally, through the environment owner's named capabilities. The
address field's Enter key and Go button issue source commands directly, never
a native form submission. Source profile creation and endpoint discovery use
explicit click/Enter handlers for the same reason; composition Enter never
submits. The inline document keeps its restrictive sandbox
without `allow-forms` and its `form-action 'none'` policy.

Website admission remains source-owned. A website may challenge or reject a
managed automation session even when a user supplies correct input. Projection
must preserve ordinary native input and must not alter browser identity or
website security checks to force admission. A neutral coordinate/sequence test
is input evidence, not proof that a third-party verification challenge passes.

# Evidence

- `redeven:internal/envapp/ui_src/src/browserDocument.ts` - Cancellable preparation before display, with status and tab callbacks limited to notifications.
- `redeven:internal/envapp/ui_src/src/browserDocument.test.ts` - Idle admission ordering, absence of live-status reacquisition and cancellation of obsolete requests.
- [FloeBrowser v0.1.14: test/input-focus.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.14/test/input-focus.e2e.ts) — Repeated source focus and native caret continuity.
- [FloeBrowser v0.1.14: test/navigation-input.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.14/test/navigation-input.e2e.ts) — Input fencing through navigation admission and completion.
- [FloeBrowser v0.1.19: test/target-change.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.19/test/target-change.e2e.ts) — Replaced, removed and covered targets cannot receive stale clicks or interrupt subsequent scrolling.
- [FloeBrowser v0.1.19: test/input-recovery.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.19/test/input-recovery.e2e.ts) — Missing event sequences recover independently of target cancellation; current authorization and uncertain-effect failures remain visible.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWindow.test.ts` - Grant/token ordering, immediate revocation and stale selection rejection.
- `redeven:internal/envapp/ui_src/scripts/computerManagedSandbox.node-test.mjs` - Real managed launcher and source host preserve sandbox isolation and new-tab initialization geometry.
- [FloeBrowser v0.1.20: test/popup-viewport.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.20/test/popup-viewport.e2e.ts) — Initial popup dimensions and visible source/projected click markers at desktop and narrow sizes, with opener zoom and borrowed-window isolation.
- [FloeBrowser v0.1.18: src/viewer/replay-pages.ts](https://github.com/floegence/floebrowser/blob/v0.1.18/src/viewer/replay-pages.ts) — Bounded inert document retention.
- [FloeBrowser v0.1.18: test/tab-sizing.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.18/test/tab-sizing.e2e.ts) — Per-frame source and viewer geometry across admission, cancellation, visibility and window-size changes.
- [FloeBrowser v0.1.18: test/tab-continuity.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.18/test/tab-continuity.e2e.ts) — Per-frame cold, warm, evicted and renamed tab continuity across three engines and both input roles.
- [FloeBrowser v0.1.16: test/tab-cache.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.16/test/tab-cache.e2e.ts) — Immediate presentation without stale input authority.
