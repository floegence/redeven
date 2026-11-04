---
type: UI Contract
title: Flower incremental live state
tags: [ui, flower, live, threads]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Floret owns canonical history/versions; Redeven authorizes one workspace stream into ThreadCache. UTF-8 growth changes only its item. Transport/window recovery preserves execution, prose and drafts; retained DOM and scoped reads keep navigation/disclosure stable without rescanning history.

# Contract

## Baseline/ownership
ThreadFactsSource carries body-free workspace/account/Computer facts. Root/child windows independent; one worker coalesces<=64 dirty parents without blocking facts. [Adapter](../ai/floret-redeven-adapter-and-projection.md) authorizes. Register before freezing navigation-ordered roots; emit Ready,<=25-summary pages,baseline_complete,private states. Facts wait; accepted reads bypass sidebar prep. Cancel drains budgets/queues without Next. Broken observation invalidates, never skips pinned roots.

Merge pages immediately; prune only after completion, preserving creation/selection. [Startup](../architecture/flower-startup-presentation.md) admits first page,confirmed empty or selected detail,never partial Ready. HTTP refresh25-row pages/10s per progressing page retains partial success. Desktop cancels history/item POST. Baseline precedes shared loading; coalesce demand except command confirmation. Navigation/dispose/transport cancels waiters; reconnect keeps content/draft/scroll.

## Windows
Root/child revisions fence replacements; baseline/delta share subscription. Initial50 items/1KiB preview/Activity summary/existing byte cap. Paging150 items/512KiB; POST64KiB JSON/150IDs; locator8KiB; exact membership448KiB previews excluding hydrated bodies. Viewer/current-only events grant no coverage.

Charge max(transmitted, window_bytes). Receipts refresh accepted intervals without forcing Latest. Retain confirmed sealed bodies and mounted visible/focused/selected live islands; evict inactive documents whole. Prefetch near missing intervals. One explicit input demand owns handoff, including stationary/folded edges; layout/HTTP cannot traverse. Anchors guide placement, never admission. Folded summaries remain reading anchors through canonical header relocation. Prepending and sealed-body completion preserve their screen position before paint. An upward wheel at an unloaded edge retains only its clamped distance; the same scroll owner applies that distance as bounded motion after insertion, subtracting any native movement. Only the animation-frame callback advances retained wheel motion; body/resize layout flushes repair geometry without advancing the input clock again. Reverse input, disclosure, navigation and Latest cancel it; reduced motion applies the bounded distance immediately. A short latest tail cannot resume following from an immovable downward gesture. Native downward scrolling resumes following only at the actual tail (one-pixel rounding tolerance), never by snapping across the near-bottom margin. Canonical folded navigation may prepare adjacent pages within the existing prefetch margin; it never moves the reader across all those summaries. Failures retain draft/content with Retry.

Collapsed turns/sequences install public navigation/retained rows in one observer. Canonical membership resolves same-turn/run skips without host hidden scans. Only intermediate prose may skip; active/unknown/trailing/approval/input/unsafe facts bound it. Finite accepted IDs prevent repeat skips; scroll/expand reaches gaps. [Sequence proofs](flower-tool-sequences.md#membership-and-counts) avoid duplicate summaries; HTTP/observer share proof without body/extra observer reads. Keyed gaps update affected rows. Disclosure cancels navigation/restores interest/retires demand; new input starts fresh.

Foreground pages may publish during baseline queue. Reuse sealed prefix only with exact ID/kind/turn/run/ordinal/canonicalOrdinal; stale windows prove no ends. Preserve focused/selected/disclosed DOM. Align receipts with<=one preview page/displayed span; other gaps stay demand. Sequence owns counts/unknown labels. Patch summaries show real mutation/type or localized count, retaining totals/files on expand. Activity keeps bounded shape/scalars; fields read frozen authorized source.

## Bodies and transport
Retain accepted prose/media/anchors/follow during refresh. Unread historical text keeps its canonical preview in the same bubble, with stable pending status from first mount; never insert a synthetic fixed-height skeleton. Stage sealed body chunks until complete, then correct the reading anchor after synchronous Markdown rendering and before the next frame. While reading inside a preview, retain the visible paragraph/table row through Markdown DOM replacement using its message identity and element position. Horizontal table overflow does not own vertical reading. Only a clipped trailing text fragment or empty message margin may defer to the next visible message. Disposed messages cannot correct a later viewport. One observer admits within 160 px. Text/disclosure share two slots/15 s, prioritizing live/interactive, visible, then background with aging every eight admissions. Offscreen/navigation cancels; errors expose Retry.

ThreadCache binds item/turn/run/source. Text chunks<=16KiB at accepted UTF-8 offsets; coalesce growth/yield batches. Visibility owner survives complete extents; finished reads detach parent cancel listeners without aborting. Offscreen/navigation/source changes cancel. No poll/full-prefix download. Source/seal change restarts canonical preview while retaining readable content; same-source progress survives refresh and late replies reject. Retired locator source_changed releases slot, awaits authoritative ItemBody, never guesses offsets. Terminal/exhausted Retry does not replay.

Canonical final/intermediate membership is validated by Floret against full content. An empty or whitespace-only bounded preview remains valid when its exact content source matches the item, optional run matches, UTF-8 preview length matches, and safe integer extent proves unread bytes. Cached body hydration, source growth and same-source replacement keep preview_bytes equal to the retained UTF-8 prefix length. Do not infer empty canonical content from a prefix. Missing/duplicate/wrong-kind/wrong-execution/out-of-order references still stop application atomically; typed diagnostics record only field/reason categories, never payloads or source identities.

live:false alone does not change source. Same-source previews atomically update text/pending/locator; overlap retains layout and suffix resumes at current offset. Changed source retires reads; identity/range/prefix/empty-nonterminal failures stay explicit.

Schema3 has one decoder. Base64 fragments<=32KiB carry ID/index/count/total/exact scope/revision/contiguous version-UTF8 offsets. Constant-storage coalescing retains original base/semantics. Bound16 pending batches,32MiB envelope/subscriber and32MiB global refs. Started frames immutable; byte-accounted coverage suppresses duplicates. Separate summary/private/child mailboxes. Pending controls use authorized64-item pages to user boundary, check leaf/version and individually read oversized items, never full View/body. Broken authority/sequence invalidates.

## DOM/retention
Offscreen sections keep DOM/height; live/visible/focused/selected accessible. Partition active turns near24 rows after prose, preserving groups/owners. Keyed subscriptions dispose with owners. Thread identity only replaces; fields reactive. Equal replacement/empty preview retains membership; matching tools reproject. Unchanged tokens/entries/coverage reuse summaries. Structural facts avoid field observers; titles never rescan; thinking retains block; presence tracks emptiness; empty coverage ignores leaf; follow scans no old anchors.

[Activity](flower-activity-interaction.md) owns inspection/before-paint scroll; Fork inherits no disclosure. Body/readiness cannot alter restoration provenance or unrelated motion; full baseline/hydration admits history. Stage cold sealed Markdown through reconnect, reveal final geometry without entrance. Navigation suppresses arrival until placed. Count cache objects once without reactive recursion. Current run/visible anchors guide compaction; paging restores decorations.

Inactive cache12 threads/32MiB estimated protects selected/retained/in-flight/summary owners. Append logs256chunks/256KiB use absolute cursors/exact-source catchup; active documents/selection uncapped. Catchup notice waits200ms, publication never waits. [Composer](flower-turn-launcher.md) owns captured-input DOM before confirmation.

## Recovery
Detail/baseline backoff200/600/1200ms,<=4 attempts/15s. Revision retires unpublished state; leaf drift recovers,foreign/malformed stops. Navigation/dispose/connection cancels. Exhaustion retains content/draft/DOM/scroll with interrupted-sync Retry,not command replay. history_invalidated allows one bounded read/selection-manual intent,then Retry. Release cancels immediately; child only its slot,one-shot inherits none.

Transport/handshake/gap keeps backoff; dispose cannot publish,reconnect publishes boundary. Observer follows DOM lifetime. Auth/capacity/version/malformed stops; classified transport may retry,mapper exceptions never. Diagnostics preserve category/status/epoch and SSE503/baseline504/invalid400/capacity429. Unknown effects retain request keys.

A centered floating stack above the companion shows interrupted live updates, Resync and minimizable details without moving content or occupying headers. Minimize preserves its horizontal center. Shared Button and floating presence own control feedback and entry/exit; detail expansion uses a bounded transition, chevron and inert hidden controls. Reduced motion removes animation; forced colors retain borders/focus. Busy Resync shows progress and coalesces repeated activation. Without transcript content, the same notice exposes its explanation immediately; it never implies that the underlying task paused. Escape/outside dismisses without stealing focus; targets >=44 px. The owner coalesces reconnect. Restored requires current connection/selected authoritative detail, not optional collapsed reads. Dismiss after 2.6 s unless focused/hovered/expanded. Preserve drafts/selection/bounds. Canonical cancellation owns Stopping; viewer facts grant no coverage. [Approvals](flower-approval-context.md), [read state](flower-read-state.md) and [turn disclosure](flower-turn-process-disclosure.md) retain policy.

A timed-out Stop confirmation retains an actionable Resync button once its read settles; awaiting canonical confirmation must not leave that explicit recovery action busy indefinitely. Initial synchronization notices may finish their exit transition after readiness.

# Boundaries

Streams/queues/cache are ephemeral, never durable cursors/lifecycle. Preserve database kinds/migrations and complete accessible history; layout grants no authority or data omission.

# Evidence

- [Continuous history browser tests](../../internal/envapp/ui_src/src/ui/FlowerSurface.continuousHistory.browser.test.tsx) sample native wheel displacement from folded-only first screens through delayed cold-table completion, including root/child, multiple retry turns, reverse input and reduced motion. Checks bound total and per-frame movement, hydration drift, idle reads, focus and drafts; merely finding earlier prose does not qualify scrolling.

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Floating notice geometry](../../internal/envapp/ui_src/src/ui/FlowerSurface.floatingNotices.browser.test.tsx) and [localized recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.syncStatus.browser.test.tsx) cover new-chat loading/failure/retry, narrow layouts, keyboard recovery and unchanged transcript/composer bounds.

- [Published bounded-preview acceptance](../../internal/ai/flower_preview_contract_test.go) produces the sanitized full-contract fixture from released Floret v7.102.0, including canonical intermediate/final membership and exact prefix locators. Mapper/record tests cover atomic deltas and body completion; [browser acceptance](../../internal/envapp/ui_src/src/ui/FlowerSurface.boundedPreview.browser.test.tsx) verifies hydration without task replay.
