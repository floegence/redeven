---
type: UI Contract
title: Flower incremental live state
tags: [ui, flower, live, threads]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret owns canonical history, identity and versions. Redeven authorizes public
projection; one workspace stream delivers it to ThreadCache. Text growth changes
one item at its UTF-8 offset, never copying, scanning or encoding complete history.
Window loss refreshes that reading interest; transport loss uses the existing
connection owner. Both preserve execution, accepted prose and drafts.

# Contract

## Baseline and ownership
ThreadFactsSource carries body-free workspace/account/Computer facts. Authorized root/child windows are independent; one worker coalesces <=64 dirty parents without blocking facts. [Adapter](../ai/floret-redeven-adapter-and-projection.md) owns authorization. Register before freezing navigation-ordered roots; emit Ready, <=25-summary pages, baseline_complete, then private states. Facts wait; accepted reads bypass sidebar preparation. Cancellation drains budgets/queues without Next. Broken observation invalidates, never skips pinned roots.

Merge pages immediately and prune only on completion, preserving local creation/selection. [Startup](../architecture/flower-startup-presentation.md) admits first page, confirmed empty inventory or selected detail, never empty partial Ready. HTTP refresh has 25-row cancellable pages and 10 s per progressing page; retain partial success. Desktop cancels history/item POSTs. Install baseline before shared loading; coalesce demand except command confirmation. Navigation/disposal/transport cancels waiters, preserving content/draft/scroll on reconnect.

## Reading windows
Root/child revisions fence replacement; baseline/delta share one subscription. Initial: 50 items, 1 KiB previews, Activity summaries and existing byte bound. Paging: 150 items/512 KiB; POST: 64 KiB JSON/150 IDs; locator: 8 KiB; exact membership: 448 KiB previews excluding hydrated bodies. Viewer read events and current-only updates cannot manufacture loaded-content coverage.

Charge max(transmitted, window_bytes). Receipts refresh accepted intervals without forcing Latest. Retain confirmed sealed bodies and mounted visible/focused/selected live islands; evict inactive documents whole. Prefetch near missing intervals. One explicit input demand owns handoff, including stationary/folded edges; layout/HTTP cannot traverse. Anchors guide placement, never admission. Failures retain draft/content with Retry.

Collapsed turns/sequences install public range navigation plus retained rows in one observer. Canonical membership resolves same-turn/run skips; no host hidden-page scan. Only intermediate prose may skip, with active/unknown/trailing/approval/input/unsafe facts as boundaries. Accepted finite IDs prevent repeated skips on refresh; gaps stay reachable by scrolling/expansion. [Sequence proofs](flower-tool-sequences.md#membership-and-counts) prevent duplicate folded summaries. HTTP/observer share proof; metadata reads acquire neither bodies nor extra observers. Keyed gaps update affected rows only. Disclosure cancels navigation, restores interest and retires demand; new input starts another.

Foreground pages may publish while baselines queue. Reuse prefixes only with exact sealedID/kind/turn/run/ordinal/canonicalOrdinal; stale windows prove no ends. Preserve focused/selected/disclosed DOM. Receipt alignment uses <=one preview page/displayed span; other gaps remain demand. Sequence contract owns counts/unknown labels. Patch summaries show actual mutation/type or localized count, retaining totals/files on expansion. Activity summaries hold bounded shapes/scalars; field reads use frozen authorized sources.

## Bodies and transport
Retain accepted prose/media/anchors/follow during refresh; skeletons cover only unread content. One observer admits within 160 px. Text/disclosure share two slots/15 s, prioritizing live/interactive, visible, then background with aging every eight admissions. Offscreen/navigation cancels; errors expose Retry.

ThreadCache binds item/turn/run/source. Public text reads <=16 KiB at accepted UTF-8 offsets; Coalesce growth and cancellation ownership; yield between chunks. No polling/full-prefix download. Source/sealing change restarts from canonical preview while retaining readable content until replacement. Same-source progress survives refresh; reject late replies. Retired locator source_changed needs authoritative ItemBody: release slot and await observation, never guess offsets. Terminal/exhausted reads Retry without replay.

live:false alone does not change source. Same-source previews atomically update text/pending/locator; overlap retains layout and suffix resumes at current offset. Changed source retires reads; identity/range/prefix/empty-nonterminal failures stay explicit.

Schema v3 has one decoder. Base64 fragments <=32 KiB carry ID/index/count/total and exact scope/revision with contiguous version/UTF-8 offsets. Growth carries locators. Constant-storage coalescing preserves original base/semantics. Structural commits use separate tasks without adjacent growth work. Bound 16 pending batches, 32 MiB envelope/subscriber and 32 MiB global refs. Started frames are immutable; byte-accounted coverage suppresses duplicates. Summary/private/child mailboxes stay separate. Pending controls use authorized 64-item pages back to user boundary, verify leaf/version and individually read oversized items, never full View/body. Missing authority or a broken sequence invalidates observation.

## DOM and retention
Offscreen sections retain DOM/height; visible/live/focused/selected content stays accessible. Partition active turns near 24 rows after prose, preserving groups and mounted owners. Presence tracks empty/nonempty. Keyed subscriptions dispose with owners. Equal replacements and empty preview boundaries retain ordered membership; preview changes reproject only matching tools. Structural facts avoid per-field observers. Titles never rescan history; thinking retains its block; sets own membership; empty coverage ignores leaf-only changes; following scans no old anchors.

[Activity](flower-activity-interaction.md) owns inspection/before-paint scroll; Fork inherits no disclosure. Readiness/body growth cannot change restoration provenance or cancel unrelated motion; full baseline/hydration admits history. Stage cold sealed Markdown across reconnect and reveal complete final geometry without entrance motion. Navigation suppresses arrivals until placed. Count cache objects once without reactive recursion. Current run/visible anchors guide compaction; paging restores decoration.

Inactive cache: 12 threads/32 MiB estimated, protecting selected/retained/in-flight owners and summaries. Append logs: 256 chunks/256 KiB with absolute cursors/exact-source catchup; active documents/selection uncapped. Catchup notice waits 200 ms, never delays publication. [Composer](flower-turn-launcher.md) owns captured-input DOM before confirmation.

## Recovery
Detail/baseline: 200/600/1200 ms backoff, <=4 attempts/15 s. New revisions retire unpublished state; leaf drift recovers, foreign/malformed terminates. Navigation/disposal/connection cancels. Exhaustion retains draft/DOM/scroll with interrupted-sync Retry; no command replay. history_invalidated permits one bounded read per selection/manual intent, then Retry. Release immediately cancels interest; child release affects only its slot, one-shot windows inherit none.

Transport/handshake/gaps use existing backoff; disposal never publishes and reconnect publishes boundary. Observers track DOM lifetime. Auth/capacity/version/malformed are terminal; transport errors may classify, mapper exceptions never retry. Diagnostics retain category/status/epoch, SSE503/baseline 504/invalid 400/capacity 429. Unknown effects retain request keys.

One pointer-local floating stack (above companion editor) shows compact sync status, Resync and details without moving transcript/composer or occupying headers. Details minimize; Escape/outside dismisses without stealing focus; targets >=44 px. Existing owner coalesces reconnect. Restored requires current connection and selected authoritative detail, not optional collapsed reads. Dismiss after 2.6 s unless focused/hovered/expanded. Preserve drafts/selection/bounds. Canonical cancellation owns Stopping; viewer facts never invent coverage. [Approvals](flower-approval-context.md), [read state](flower-read-state.md), [turn disclosure](flower-turn-process-disclosure.md) retain their policy.

# Boundaries

Streams/queues/cache are ephemeral, never durable cursors/lifecycle. Preserve database kinds/released migrations and complete accessible canonical history; layout grants no authority and omits no data.

# Evidence

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Floating notice geometry](../../internal/envapp/ui_src/src/ui/FlowerSurface.floatingNotices.browser.test.tsx) and [localized recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.syncStatus.browser.test.tsx) cover new-chat loading/failure/retry, narrow layouts, keyboard recovery and unchanged transcript/composer bounds.
