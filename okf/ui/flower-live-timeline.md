---
type: UI Contract
title: Flower incremental live state
tags: [ui, flower, live, threads]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Floret owns canonical history, identity and versions. Redeven authorizes public
projection; one workspace stream delivers it to ThreadCache. Text growth changes
one item at its UTF-8 offset, never copying, scanning or encoding complete history.
Window loss refreshes that reading interest; transport loss uses the existing
connection owner. Both preserve execution, accepted prose and drafts.

# Contract

## Baseline and ownership

ThreadFactsSource.SubscribeFacts carries workspace/account/Computer facts without bodies/viewers. Authorized root/child ThreadWindowSource interests are independent; one worker coalesces≤64 dirty parents without blocking facts. [Adapter ownership](../ai/floret-redeven-adapter-and-projection.md) applies.

Register before freezing authorized roots in navigation order. Emit Ready,≤25-summary pages,last-page baseline_complete,then private states. Facts wait; accepted reads bypass sidebar preparation. Draining/cancellation releases budgets/queues/subscribers without Next. Broken observation invalidates; never time out/skip pinned roots.

Merge pages immediately, prune only on completion, preserving selection/local creations. [Startup](../architecture/flower-startup-presentation.md) admits first page, confirmed empty inventory or selected detail, never partial empty Ready. HTTP refresh uses cancellable25-row pages/10s per progressing page and retains partial results; Desktop cancels history/item POSTs. Install baseline before shared loading; coalesce demand except explicit command confirmation. Navigation/disposal/transport cancels obsolete waiters; reconnect preserves content/draft/scroll.

## Bounded reading

Monotonic root/child revisions fence stale replacements; baseline/delta share subscription.

| Read | Bound |
| --- | --- |
| Initial |50items/1KiB previews/Activity summaries/existing byte budget|
| Earlier/newer |150items/512KiB|
| Window POST |64KiB JSON/150identities|
| Body locator |8KiB|
| Exact membership |448KiB canonical previews,excluding hydrated bodies|

Viewer read events and current-only updates cannot manufacture loaded-content coverage.

Charge max(transmitted,window_bytes). Receipts refresh accepted intervals without forcing Latest. Retain confirmed-path sealed bodies and mounted visible/focused/selected live islands; evict inactive documents whole. Gap reads stop at missing intervals, prefetch before edges. One input demand owns handoff, including stationary/folded edges; layout/HTTP completion cannot traverse history. Anchors guide layout, not admission. Failure retains draft/content with Retry.

A mounted collapsed turn or tool sequence requests published Floret range navigation plus retained visible/focused/selected rows in one observer installation. The canonical membership index resolves same-turn/run boundaries; no product scan of hidden pages. Turn skips include only canonically intermediate prose; active, unknown, trailing, approval/input and unsafe-effect facts remain boundaries. Accepted interest becomes finite IDs, so live refresh never repeats the skip. Omitted intervals remain reachable by scrolling or progressive completion on explicit expansion. [Certified sequence gaps](flower-tool-sequences.md#membership-and-counts) prevent duplicate folded summaries across retained islands. HTTP and ordered observer delivery share one proof result; metadata checks never acquire bodies or another observer. Keyed gap subscriptions update affected rows only. Disclosure cancels pending navigation, restores prior interest and retires old scroll demand; new explicit input starts another demand.

Foreground reads publish while live baselines queue. Reuse only confirmed prefixes matching sealedID/kind/turn/run/ordinal/canonicalOrdinal; stale windows cannot infer ends. Paging preserves disclosure/focused/selected DOM. [Sequences](flower-tool-sequences.md#membership-and-counts) own exact coverage/counts and generic unknown labels. Receipt alignment≤one preview page/displayed span; gaps remain scroll demand.

Patches show one mutation name/type or localized file count, never invented diffs; expansion retains title/totals/files. Activity summaries hold shape/count/scalars/small values; field reads use frozen authorized sources.

## Bodies and wire transport

Accepted prose/media/anchors/follow survive refresh; only unseen text has skeletons. One observer admits within160px; text/disclosure share two slots/15s, ordered live/interactive→visible history→background, aging every eight admissions. Offscreen/navigation cancels; failures expose Retry.

ThreadCache owns bodies by item/turn/run/source. Authorized ThreadItemTextReader reads≤16KiB at accepted UTF-8 offsets; one source task coalesces extents/accepts in-flight prefixes/yields between chunks. No polling/full-prefix/history download. Changed source/sealing restarts at canonical preview, retaining accepted prose until complete replacement. Same-source progress survives refresh; reject stale replies. Retired locators return source_changed only after public ItemBody confirms source: release slot/await observation, never guess offsets/hide errors. Exhaustion/terminal errors Retry without replay.

live:false alone is no source change. Same-source previews atomically update text/pending and retain locator; overlap preserves layout, missing suffix resumes at current offset. Source changes discard obsolete reads; identity/range/prefix/empty-nonterminal errors stay explicit.

Schema v3 single decoder: base64 fragments carry ID,index/count,total bytes.≤32KiB fragments require matching revision/thread/item/turn/run,contiguous version/UTF-8 offset. Growth sends locators. Coalescing preserves original base/semantic boundaries in constant storage. Limits:16pending batches,32MiB envelope/subscriber,32MiB global refs. Started frames are immutable; byte-accounted covered versions suppress duplicate deltas. Summary/private/child mailboxes stay separate. Pending controls are page-independent:authorized server64-item pages read safety facts back to user boundary,verify leaf/version,individual oversized reads; no full View/body. Missing authority or a broken sequence invalidates observation.

## Presentation and retention

Offscreen sections retain DOM/intrinsic height without layout; visible/live/focused/selected sections keep accessible content/disclosure. Split active turns after prose near24rows without splitting tool/thinking groups or replacing owners on prepend. Presence changes only empty/nonempty; equal projections keep identity. Keyed subscriptions publish affected section/entry/sequence/process/end-time/final-answer facts and dispose with owners. Immutable structural projection observes sealing/replacement without per-field subscriptions. Expired titles never revisit history; thinking retains block, membership uses sets, empty coverage ignores leaf-only changes; following scans no historical anchors.

[Activity](flower-activity-interaction.md) owns inspection/before-paint scrolling; Fork inherits no disclosure. Independent readiness and incremental bodies cannot change restoration provenance/cancel unrelated motion; full hydration/baseline admit history.

Stage cold sealed chunks across reconnect; publish complete Markdown at final geometry without entrance/partial structures. Retain accepted prose; root/child navigation suppresses arrival scrolling until positioned/revealed. Count raw cache objects once, without reactive recursion. Compaction follows visible anchors/current run; paging restores older decorations. Inactive budget12threads/32MiB estimated, preserving summaries and selected/retained/in-flight owners. Append logs256chunks/256KiB use absolute cursors/exact-source catchup; active documents/selection remain uncapped.

Catchup shares one notice after200ms without delaying publication. [Composer](flower-turn-launcher.md) owns captured-input/request-key DOM before SendAck/windows.

## Recovery

Detail/baseline retries200/600/1200ms,≤4 attempts/15s. New revisions discard unpublished data; leaf drift recovers,foreign/malformed terminates. Navigation/disposal/connection cancels reads/backoff. Success adds no work; exhaustion preserves DOM/draft/scroll with interrupted-sync Retry, distinct from first-load failure. Never replay commands.

history_invalidated permits one bounded read per selection/manual action, then Retry. Release cancels pending/installed interest immediately, child only its slot; one-shot windows inherit no members. Transport loss/handshake/gaps use existing backoff; disposal aborts without publication and reconnect publishes boundary. Observers follow DOM adoption/disposal. Auth/capacity/version/malformed failures are terminal; classify fetch/bridge errors, never retry mapper exceptions. Diagnostics: category/status/epoch, SSE503/baseline504/invalid400/capacity429. Unknown results retain keys without replay.

One pointer-local stack owns feedback without transcript height; companion above editor. Sidebar has four wave bars/localized status/reduced motion. Retain error actions/terminal Resync without duplicate notices or lost height. Canonical cancellation owns Stopping; viewer facts cannot invent coverage. [Approvals](flower-approval-context.md),[read state](flower-read-state.md),[process disclosure](flower-turn-process-disclosure.md) own policy.

# Boundaries

Streams/queues/cache are ephemeral, never durable cursors/lifecycle. Preserve database kinds/released migrations and complete accessible canonical history; layout grants no authority and omits no data.

# Evidence

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Floating notice geometry](../../internal/envapp/ui_src/src/ui/FlowerSurface.floatingNotices.browser.test.tsx) and [localized recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.syncStatus.browser.test.tsx) cover new-chat loading/failure/retry, narrow layouts, keyboard recovery and unchanged transcript/composer bounds.
