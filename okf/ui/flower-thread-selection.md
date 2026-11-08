---
type: UI Contract
title: Flower conversation selection and detail reads
tags: [flower, navigation, cancellation, recovery, detail]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Flower acknowledges navigation before transcript work. One loader owns selection/reselect/reconnect/retry. Position transcript and active sequence after placement before reveal. Restored titles/groups/turns are static; folded turns cannot block readiness, and manual folds retain labels.

# Contract

## Selection and navigation
Rail feedback precedes commit by two animation callbacks and a task; hidden documents skip frames. Latest intent supersedes prior work; summaries cannot bypass coordination. Reveal after required baseline/handoff, measurable layout and visible historical text settle. Cached windows renew bounded interest if needed; ready caches prepare immediately. Never await runtime quiet. Canceled reads cannot release newer selections.

No smooth initial positioning or timer fallback. One cancellable 200 ms feedback deadline spans detail/body/layout without delaying ready/error state. New chat/navigation/disposal cancels old feedback; frame/composer stay stable and body failures retry locally.

Cached destinations flush effects and use checkVisibility({contentVisibilityAuto:true}). ResizeObserver corrects above-viewport growth before paint; rAF/visibility handles reveal/body work. No polls/per-row observers. Explicit wheel/touch/scrollbar/keyboard pauses following through late reads; scroll events alone do not. Two slots prioritize visible/margin text and cancel obsolete demand; ThreadCache retains immutable bodies. Growth/refresh/completion preserves accepted prose/selection. [Live delivery](flower-live-timeline.md) owns validation/retry. Open Latest; reading restoration is separate. Sort by creation descending then ThreadID ascending.

## Continuous history and concurrent activity
Scrolling reads canonical windows automatically, retaining visible/selected/focused rows, details and anchors across live changes. A collapsed short tail retains trailing room during prepend; reclaim it only outside view or as content fills it. Resize preserves anchors; destination preparation clears temporary geometry. Attach content observation after mount and correct growth before paint, without new reads/state/disclosure changes.

Latest remains above the composer away from current tail, even at a historical window bottom; hide during preparation and preserve gesture protection. If tail is installed, smooth-scroll and retire trailing room at arrival. Otherwise cancel obsolete demand, install one bounded tail interest and reveal its prepared destination without walking pages. Root/child share this path.

Observer/reading revision own accepted baselines. Ordered delivery/deduplication cannot discard distinct baselines at equal canonical version; full-view watermarks cannot suppress reading baselines. Retire obsolete refresh markers without invalidating newer interest. Queue budgets remain unchanged.

Collapsed ranges use canonical skip-and-retain to reach prior dialogue. One explicit reading gesture continues across advancing folded-only pages until readable content appears or the canonical edge is reached. It does not require another gesture per failed/retry turn. Each page retains the existing item/byte budgets; no-progress, read failure, disclosure changes and superseding navigation stop continuation. Explicit disclosure shows cached rows immediately and completes only its sequence: one request/document, 40 records/page, finite forward horizon. No full-content button/replacement observer. Show one geometry-neutral indicator after 150 ms; cancellation hides it immediately and only failure exposes Retry. Disclosure changes cancel obsolete navigation; thread/child/Latest clears gap demand. Headers follow canonical order and transfer focus to earlier owners.

Tools/reports retain previews; disclosure reads authorized bodies through the existing owner. Collapse/navigation/disposal cancels unused demand; reconnect restores consumers. Empty activity sources use Floret defaults in source order. Canonical unknown tool outcomes remain readable with an explicit localized unknown label; they are never converted to success, retried, or rejected as malformed history. Ordinary history retains full expansion; demand pages use published Floret v7.91.0 source-backed summaries without enumerating all turn tools. Runtime document owns mutable live records/versions. No universal latency or expanded-output memory guarantee.

## Detail read ownership
Floret supplies canonical summaries/windows/body reads. ThreadCache owns selection/detail with twelve entries; one bounded coordinator shares navigation, command confirmation and reference preflight. Cancellation never reconnects the workspace stream.

# Boundaries

Published Floret v7.103.1 reduces execution preparation reads through upstream
source locators. The host retains bounded windows, visibility-driven body reads
and interaction state. First-use preparation of older prompt histories is
cancellable and yields between transactions. It is separate from transcript
readiness and never authorizes a full-history UI load. Formal qualification uses
the checksummed published module without workspace or sibling source wiring.
Exact token counts reuse an upstream vocabulary-scoped, bounded digest-only cache;
attribution, budgets and canonical storage remain unchanged.

The [sidebar contract](flower-thread-sidebar.md) owns conversation rows, title editing, pending-action presentation and pin ordering. A completed detail read alone never marks content as seen. Canonical View and Summary stay in Floret; the host does not reconstruct its history or lifecycle.

# Evidence

- `redeven:internal/flower_ui/src/threadDetailLoader.test.ts` - Tests.

A `summary_unavailable` thread preserves any previously known history and becomes read-only. Cold selection settles without a detail request or invented timestamp/title; late unavailable summaries cancel outstanding detail preparation. Healthy summary replacement restores ordinary selection. Transient read failures keep the selection demand and retry with capped backoff; elapsed time alone never turns a connected slow read into failure.
