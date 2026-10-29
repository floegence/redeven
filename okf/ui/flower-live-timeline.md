---
type: UI Contract
title: Flower incremental live state
tags: [ui, flower, live, threads]
lifecycle: contract
reviewed_at: "2026-10-28"
quality_exception: Cross-boundary live-state contract spanning stream ownership, bounded reading interests, delivery and body caching, immediate send feedback, and recovery inside one timeline concept.
---
# Summary

Floret owns canonical history, identity and versions. Redeven authorizes public
projection; one workspace stream delivers it to ThreadCache. Text growth changes
one item at its UTF-8 offset, never copying, scanning or encoding complete history.
Window loss refreshes that reading interest; transport loss uses the existing
connection owner. Both preserve execution, accepted prose and drafts.

# Contract

## Baseline and ownership

Floret owns canonical identities/history/versions. ThreadFactsSource.SubscribeFacts carries workspace/account/Computer facts without bodies/viewers; authorized root and child ThreadWindowSource interests are independent. One worker coalesces≤64 dirty parents without blocking facts; [adapter ownership](../ai/floret-redeven-adapter-and-projection.md) applies.

Register before freezing authorized roots in navigation order. Publish observer Ready,≤25-summary pages,baseline_complete only on last,then private states; ordinary facts wait while accepted reads bypass sidebar preparation. Release budgeted IDs/arrays as pages drain; cancellation releases queues/subscribers without Next. Broken canonical observation invalidates; no timeout/skipped pinned roots.

Merge immediately, prune on completion; preserve selection/local creations. First page, confirmed empty inventory or accepted selected detail admits [startup](../architecture/flower-startup-presentation.md); partial empty Ready does not. Explicit HTTP refresh: cancellable25-row pages,10s per progressing page,retain pages on failure; Desktop cancels history/item POSTs. Install current observer baseline before shared loading; coalesce covered demand but force explicit command confirmation. Navigation/disposal/transport cancels obsolete waiters; reconnect binds new observer without losing content/drafts/scroll.

## Bounded reading

Root/child monotonic revisions fence older replacements; baseline/delta share subscription.

| Read | Bound |
| --- | --- |
| Initial |50items/1KiB previews/Activity summaries/existing byte budget|
| Earlier/newer |150items/512KiB|
| Window POST |64KiB JSON/150identities|
| Body locator |8KiB|
| Exact membership |448KiB canonical previews,excluding hydrated bodies|

Charge max(transmitted,window_bytes). Receipts refresh accepted interval without forcing Latest. Network interest differs from retained reading: keep sealed owners/bodies on confirmed path plus mounted visible/focused/selected live islands; evict inactive documents whole. Gap reads stop at missing intervals; prefetch ahead of edge. One coalesced input demand owns handoff,including stationary/folded edges; layout/HTTP completion never recursively traverses history. Visible message anchors guide layout,not read admission. Failed navigation retains draft/content and localized Retry.

Foreground readers publish; live baselines queue through handoff. Reuse only confirmed preceding cached prefix matching sealedID/kind/turn/run/ordinal/canonicalOrdinal; stale windows cannot infer ends. Paging retains manual disclosure and focused/selected canonical DOM. Publish windows without completing counts: exact sequence statistics need both boundaries and every intervening item/event (running may qualify),otherwise localized generic label. Statistics read no history/receipts/bodies; receipt alignment≤one preview page/displayed span,gaps remain scroll demand. [Sequences](flower-tool-sequences.md) own display.

Collapsed patches use summary name/type for one mutation or localized multi-file count; no invented targets/diff. Expansion retains title/totals/files. Activity summaries contain shape/count/scalars/small values,not field locators; explicit structure/value reads use frozen authorized sources with no storage/index migration.

## Bodies and wire transport

Only unseen text shows skeletons; accepted prose/media/references/anchors/follow survive refresh. One visibility observer admits within160px; text and tool disclosure share two slots/15s deadline. Priorities:visible live/interactive,visible history,background; age every eight admissions. Offscreen/navigation cancels; errors expose local Retry.

ThreadCache is sole body owner keyed item/turn/run/source. Authorized ThreadItemTextReader reads≤16KiB at accepted UTF-8 offsets; one source task coalesces extents,accepts in-flight prefixes,yields between chunks. No polling/full-prefix/history download or duplicate store. Changed source (including sealing) restarts from canonical preview; live/sealed suffixes need not match. Keep accepted text until replacement complete,then publish once. Same-source progress survives refresh; old responses cannot overwrite. Retired live locator returns source_changed only when public ItemBody confirms canonical source; release slot,await authoritative observation,never guess offsets or hide unrelated errors. Exhaustion/terminal errors Retry without execution replay.

live:false alone is not source change. Longer validated same-source preview updates text/pending atomically while retaining locator. Covered chunk overlap validates without layout invalidation; missing suffix resumes from current offset. Source changes discard obsolete reads; identity/range/conflicting-prefix/empty-nonterminal failures remain explicit. Controlled completion-order regressions preserve bubble/draft/focus/geometry through tools.

Schema v3 single decoder: base64 fragments carry ID,index/count,total bytes.≤32KiB fragments require matching revision/thread/item/turn/run,contiguous version/UTF-8 offset. Growth sends locators. Same-source coalescing keeps original base and semantic boundaries in constant storage. Limits:16pending batches,32MiB envelope/subscriber,32MiB global retained refs. Started frames immutable; byte-accounted covered versions suppress duplicate deltas. Summary/private/child mailboxes separate. Pending controls are page-independent:authorized server64-item pages read safety facts back to user boundary,verify leaf/version,individual oversized reads; no full View/body. Missing authority/order invalidates.

## Presentation and retention

Measured offscreen sections retain DOM/intrinsic height while skipping layout. Active turns split after prose near24rows,keeping consecutive tool/thinking groups and existing owners stable through prepend. Visible/live/focused/selected sections retain layout and accessible canonical content/disclosure. Content presence changes only at empty/nonempty boundaries; equal projections retain identity. Keyed Solid subscriptions publish only affected section/entry/sequence/process/end-time/final-answer facts and dispose with owners. Structural projection uses immutable fields without per-field subscriptions; sealing/replacement remains observable. Expired titles never revisit history; thinking append keeps block; membership uses sets; empty receipt coverage ignores leaf-only changes. Following does not scan historical anchors.

Inspection retains disclosure/nested offsets; Fork does not inherit another thread's choices. One scroll owner corrects anchors before paint for growth/input/replacement; readiness schedules independently. Incremental body reads cannot change restoration provenance or cancel unrelated title/disclosure animation; full hydration/baseline explicitly establish historical admission.

Cold sealed chunks stage across reconnect,then publish complete Markdown at final geometry without entrance/partial table/list/code. Retain accepted prose through replacement/live growth. Root/child navigation suppresses arrival scrolling until positioned/revealed. Cache counts raw objects once without reactive recursion. Compaction decorations follow visible anchors/current run,paging restores older decorations without removing history. Inactive budget12threads/32MiB estimated; summaries survive; selected/retained/in-flight protected. Append logs256chunks/256KiB,absolute cursors/exact-source catchup; active documents/selection uncapped.

History/terminal catchup share one floating notice after200ms; fast work mounts none,publication immediate,overlap deduplicated. [Composer](flower-turn-launcher.md) owns immediate captured input/request-key DOM independent of SendAck/windows.

## Recovery

Detail preparation/baseline retries200/600/1200ms,≤4 attempts/15s. New revision discards unpublished data; leaf drift recoverable,foreign/malformed terminal. Navigation/disposal/connection cancels reads/backoff. Success adds no timer/read; exhaustion keeps DOM/draft/scroll with interrupted-sync Retry,distinct from first-load failure. Never replay commands.

history_invalidated grants one bounded automatic read per selection/manual action,then Retry. Release cancels installed/pending interest without waiting; child releases only its slot; one-shot windows inherit no stale members. Transport loss/handshake/gaps use existing backoff; final disposal aborts without cache publication,reconnect publishes boundary. Observers attach after DOM adoption/dispose with rows. Auth/capacity/version/malformed failures terminal. Classify fetch/bridge errors first; mapper exceptions never retry. Diagnostics only category/status/epoch; SSE503,baseline504,invalid400,capacity429. Unknown results retain request keys without replay.

One pointer-local floating stack owns connection/unconfirmed/settings/initial/detail/history/parent-report/navigation feedback without transcript height; companion above editor. Four sidebar wave bars,localized live status,reduced motion. Errors retain explanation/actions; terminal connection offers Resync; no overlapping/composer duplicates or lost progress height. Canonical activity/cancel owns Stopping. One canonical summary; viewer/current-only events cannot invent coverage. [Approvals](flower-approval-context.md),[read state](flower-read-state.md),[process disclosure](flower-turn-process-disclosure.md) own policy.

# Boundaries

Streams,queues/cache are bounded ephemeral observations,never durable cursors or a second lifecycle. Preserve all database kinds/released migration edges. Canonical history stays complete and accessible; layout optimization cannot grant read authority or omit data.

# Evidence

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Floating notice geometry](../../internal/envapp/ui_src/src/ui/FlowerSurface.floatingNotices.browser.test.tsx) and [localized recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.syncStatus.browser.test.tsx) cover new-chat loading/failure/retry, narrow layouts, keyboard recovery and unchanged transcript/composer bounds.
