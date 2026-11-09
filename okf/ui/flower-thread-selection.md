---
type: UI Contract
title: Flower conversation selection and detail reads
tags: [flower, navigation, cancellation, recovery, detail]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Acknowledge navigation before transcript work. One loader owns select/reselect/reconnect/retry; position transcript/active sequence before reveal. Restored labels/groups/turns are static; folded turns cannot block readiness and manual folds retain labels.

# Contract

## Selection and navigation
Rail feedback precedes commit by two animation callbacks plus a task; hidden documents skip frames. Latest intent supersedes work; summaries cannot bypass it. Reveal after baseline/handoff, measurable layout and visible history settle, never runtime quiet. Cached windows renew bounded interest only when needed. Cancellation cannot release newer selection.

No smooth initial positioning/timer fallback. One cancellable200ms feedback deadline spans reads/layout without delaying ready/error. Navigation/new chat/disposal cancels feedback; frame/composer persist, body failures retry locally. Cached destinations flush effects and check contentVisibilityAuto. ResizeObserver corrects above-viewport growth before paint; rAF/visibility handles reveal. No polls/per-row observers. Explicit wheel/touch/scrollbar/keyboard pauses follow, not mere scroll events. Two slots prioritize visible/margin bodies, cancel stale demand and reuse ThreadCache immutable content. Growth/refresh/completion preserves text/selection. [Live delivery](flower-live-timeline.md) owns retry. Open Latest; restoration is separate. Sort creation descending then ID ascending.

## Continuous history and concurrent activity
Native scrolling reads bounded canonical windows, preserving visible/focused/selected rows, details and anchors through live updates. Collapsed short tails retain prepend room until outside view/filled; resize corrects anchors, destination preparation clears temporary geometry. Attach observation after mount and correct before paint without new reads/disclosures.

Latest sits above composer away from actual tail, including historical-window bottom, and hides during preparation. Installed tail scrolls smoothly and retires room on arrival; otherwise cancel old demand, install one bounded tail interest and reveal without page walking. Root/child share this owner. Reading/observer revisions admit baselines; equal canonical versions cannot deduplicate distinct membership. Full-view watermarks cannot suppress reading baselines; retire stale refresh markers without touching newer interest/budgets.

Collapsed skip-and-retain lets one gesture cross advancing folded-only pages until readable dialogue/canonical edge. Preserve page item/byte caps; stop on no progress, failure, disclosure or newer navigation. Explicit disclosure immediately shows cached rows then completes only its sequence with one request/document,40records/page, finite horizon. No replacement observer/full-content button. Delay geometry-neutral indicator150ms; cancellation hides it, only failure exposes Retry. Disclosure/thread/child/Latest cancels obsolete gaps; headers follow canonical order and transfer focus.

Tools/reports retain previews. Existing owner reads authorized bodies; collapse/navigation/disposal cancels unused demand, reconnect restores consumers. Empty Activity uses upstream defaults/source order. Unknown tool outcomes stay localized/readable, never success/retry/malformed. Published source-backed summaries avoid full tool enumeration; Runtime document owns live records/versions. No universal latency/expanded-output memory guarantee.

## Detail read ownership
Floret owns summaries/windows/bodies. ThreadCache has12entries and one bounded coordinator for navigation, command confirmation and reference preflight; cancellation never reconnects workspace stream.

# Boundaries

Published Floret source locators reduce execution preparation reads. Host retains windows/visibility/input state; older-history first-use preparation yields between cancellable transactions, separate from transcript readiness and never permission for full-history UI reads. Qualification uses checksummed published modules, no sibling wiring. Vocabulary-scoped digest-only token cache changes no attribution/budgets/storage.

[Sidebar](flower-thread-sidebar.md) owns rows/rename/pending/pins; detail completion never marks unseen content read. View/Summary remain upstream. summary_unavailable preserves known history read-only; cold selection invents no detail/title/time, late marker cancels preparation, healthy replacement restores selection. Transient failures retain demand with capped backoff; elapsed time cannot fail connected slow reads.

# Evidence

internal/flower_ui/src/threadDetailLoader.test.ts and continuous-history/browser suites verify these boundaries.
