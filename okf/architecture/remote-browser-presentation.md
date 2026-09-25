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

Pointer and wheel targets can move, disappear, be replaced or become covered
between projection and dispatch. Published FloeBrowser reports these known
no-effect cancellations as `target_changed`. It discards the gesture without
retargeting or replaying it, without forcing a new snapshot, and without an
interrupting warning. Subsequent input uses the current projected target.
An invalid view epoch or a missing DOM sequence still requires snapshot recovery;
authorization failures and uncertain source effects remain visible. Redeven must
not suppress generic failures or add another input/recovery loop around the SDK.
Source hosts and view descriptors require projection protocol 23 and media wire
version 1. The document adapter validates against the published SDK constants;
older or newer protocol versions fail before a view can receive input.

## Tab geometry and continuity

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
- [FloeBrowser v0.1.18: src/viewer/replay-pages.ts](https://github.com/floegence/floebrowser/blob/v0.1.18/src/viewer/replay-pages.ts) — Bounded inert document retention.
- [FloeBrowser v0.1.18: test/tab-sizing.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.18/test/tab-sizing.e2e.ts) — Per-frame source and viewer geometry across admission, cancellation, visibility and window-size changes.
- [FloeBrowser v0.1.18: test/tab-continuity.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.18/test/tab-continuity.e2e.ts) — Per-frame cold, warm, evicted and renamed tab continuity across three engines and both input roles.
- [FloeBrowser v0.1.16: test/tab-cache.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.16/test/tab-cache.e2e.ts) — Immediate presentation without stale input authority.
