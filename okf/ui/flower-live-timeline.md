---
type: UI Contract
title: Flower incremental live state
tags: [ui, flower, live, threads]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Floret owns canonical history/versions; Redeven authorizes one workspace stream into ThreadCache. UTF-8 growth changes only its item. Merge pages immediately,prune after completion,preserving creation/selection. [Startup](../architecture/flower-startup-presentation.md) accepts first page,confirmed empty or selected detail,never partial Ready.

# Contract

## Baseline and windows
ThreadFactsSource publishes body-free workspace/account/Computer facts. Independent root/child windows use one worker coalescing<=64 dirty parents without blocking facts. The [adapter](../ai/floret-redeven-adapter-and-projection.md) authorizes. Register before freezing navigation-ordered roots;publish Ready,<=25-summary pages,baseline_complete,private states. Facts wait;accepted reads bypass sidebar preparation. Cancel drains queues/budgets without Next;broken observation invalidates rather than skipping pinned roots.

HTTP:25rows/page,retain partial success; cancellation owns pending pages. Desktop cancels history/item POSTs. Baseline precedes shared loading;coalesce except command confirmation. Navigation/disposal/transport cancel waiters,reconnect retains content/draft/scroll.

Root/child revisions fence replacement;baseline/delta share subscription. Initial50items/1KiB previews/Activity summaries/existing byte cap. Paging150items/512KiB;POST64KiB/150IDs;locator8KiB;exact membership448KiB previews excluding hydrated bodies. Viewer/current-only events prove no coverage. Equal versions compare membership/coverage,not bounds. Duplicate receipts reuse records;same-leaf handoff uses bounded observations/indexed owners,archived bodies,order/file-target enrichment.

Charge max(transmitted,window_bytes);refresh intervals without forcing Latest. Retain sealed bodies and visible/focused/selected islands;evict inactive documents whole. Prefetch gaps without traversing summaries. Explicit input owns folded/stationary handoff;anchors place,never admit. Preserve folded header before paint. Retain clamped wheel distance minus native movement;only rAF advances it. Reverse input/disclosure/navigation/Latest cancels;reduced motion immediate. Follow resumes only at actual tail(1px),never immovable/near-bottom snap. [Selection](flower-thread-selection.md) owns continuous reading.

One observer installs navigation/collapsed rows. Same-turn/run proof skips intermediate prose only;active/unknown/trailing/approval/input/unsafe facts stop. Accepted IDs bound repeats;scroll/expand reaches keyed gaps. [Sequence proofs](flower-tool-sequences.md#membership-and-counts) share HTTP/observer coverage without bodies/extra observers. Disclosure retires demand;new input starts fresh;foreground pages may publish during baseline queue. Sealed-prefix reuse requires exact ID/kind/turn/run/ordinal/canonicalOrdinal;stale windows prove no ends. Receipts align<=one preview page/displayed span. Activity/sequence owners retain counts,unknowns,mutations,expanded files/frozen authorized fields.

## Bodies and transport
Body-free thread facts clear retained run progress when the run ends or its identity changes. Only an active update for the same run may retain progress. A terminal facts update can precede the equal-version detail update; composer admission must release immediately without waiting for another history refresh.

Refresh retains prose/media/anchors/follow. Historical canonical previews/pending remain while sealed chunks stage;complete Markdown commits synchronously and restores paragraph/table/message anchors before paint. Disposed owners cannot correct later viewport. Horizontal table overflow never owns vertical reading;only clipped trailing text/empty margins defer. One observer admits within160px. Text/disclosure share two physical slots without an elapsed timeout,priority live/interactive→visible→background,aging every8admissions. Offscreen/navigation cancels;failure Retry.

ThreadCache binds item/turn/run/source. <=16KiB chunks use accepted UTF8 offsets,yield/coalesce without polling/full-prefix reads. Visibility survives full extents;completed reads detach parent cancellation. Source/seal change retires reads/restarts preview while retaining content;same-source progress survives refresh. source_changed releases slot/awaits authoritative ItemBody,no guessed offsets;live:false alone changes no source. Same-source text/pending/locator publish atomically;overlap retains layout/resumes offset. Identity/range/prefix/empty-nonterminal failures stay explicit;Retry never replays execution.

Floret validates intermediate/final membership against complete content. Empty/whitespace previews require exact source,matching optional run/UTF8 prefix length and safe-integer unread extent. Hydration/growth/replacement preserve preview_bytes;preview cannot prove empty canonical content. Missing/duplicate/wrong-kind/execution/order rejects atomically;diagnostics field/reason only,no payload/sourceIDs.

Schema3 has one decoder. Base64<=32KiB binds ID/index/count/total,scope/revision,contiguous version/UTF8 offset. Constant-storage coalescing preserves base/semantics;started frames immutable,byte coverage suppresses duplicates. Limits16pending batches,32MiB envelope/subscriber,32MiB global refs. Separate summary/private/child mailboxes. Pending controls page64 authorized items to user boundary,check leaf/version;oversize items individually,no full View/body. Broken sequence/authority invalidates.

## Retention and recovery
Keep DOM/height/accessibility for live/visible/focused/selected;partition near24rows after prose without splitting groups. Keyed subscriptions dispose with owners;replace thread identity only. Equal/empty replacements retain membership;matching tools reproject. Thinking keeps block;presence tracks empty;empty coverage ignores leaf. [Streaming](flower-streaming-stability.md) owns reactive/structural/token reuse,not historical field/title/follow rescans.

[Activity](flower-activity-interaction.md) owns inspection/before-paint placement;Fork inherits no disclosure. Body readiness cannot alter restoration provenance/unrelated motion. Full baseline/hydration admits history;cold sealed Markdown survives reconnect/reveals final geometry without entrance. Navigation suppresses arrival until placed. Count objects once,avoid reactive recursion;current run/visible anchors guide compaction,paging restores decorations.

Inactive cache12threads/32MiB estimated protects selected/retained/in-flight/summary owners. Byte census only for eviction;baseline replacement/leaving retained documents invalidates estimate,sole displayed live document gets none. Append logs256chunks/256KiB,absolute cursors/exact-source catchup;active documents/selection uncapped. Delay catchup notice200ms,never publication. [Composer](flower-turn-launcher.md) owns captured input.

Detail, body, parent-event and baseline reads belong to visible demand until cancellation. An intact session has no elapsed/header/idle failure deadline. Actual transport/availability failures retry with capped 200/600/1200/2500/5000/10000 ms backoff; backoff releases physical read slots. Authorization, malformed contracts and foreign identity stop. Navigation/disposal cancels pending I/O and fences late results; accepted content, draft, DOM and scroll remain stable. Live observation reconnects only after actual transport loss, 408/429/5xx or explicit synchronization invalidation. Unknown command effects are never automatically replayed; canonical admission wins over late transport errors.

An authority-corrupt historical summary publishes explicit `summary_unavailable: {code: "authority_corrupt"}` with read-only settings identity, zero timestamps and no runtime facts. This is the only zero-timestamp summary shape. The decoder remains strict for normal summaries; one damaged thread cannot invalidate healthy workspace observation. Cached canonical title/time/content survive, cold selection does not issue a fabricated detail read, and a later healthy summary clears the marker. Accepted sends display localized “Received, syncing” until their canonical observation arrives.

Floating notices above companion expose interrupted updates/Resync/minimizable details without moving content/header;minimize preserves center. Shared Button/presence owns feedback;hidden details inert. Preserve reduced-motion/forced colors,44px targets,focus-preserving Escape/outside dismissal,drafts/selection/bounds. Coalesce busy recovery;empty explanation immediate without task-pause implication. Restoration needs current connection/selected authoritative detail,not collapsed reads. Dismiss after2.6s unless focused/hovered/expanded. Cancellation owns Stopping;timed-out Stop restores Resync after read settlement. Initial exit may finish after readiness. [Decisions](flower-approval-surface.md),[read state](flower-read-state.md),[turns](flower-turn-process-disclosure.md) retain policy.

# Boundaries

Streams/queues/cache are ephemeral, never durable cursors/lifecycle. Preserve database kinds/migrations and complete accessible history; layout grants no authority or data omission.

# Evidence

Under `internal/envapp/ui_src/src/ui`, browser suites cover: `plugins/PluginFlowerAdmission` (terminal facts before equal-version detail restores Send); `FlowerSurface.continuousHistory` (native bidirectional wheel/root-child/retry/cold-table/reduced-motion, per-frame displacement/hydration/idle/focus/drafts); `floatingNotices` and `syncStatus` (localized narrow recovery, keyboard, unchanged bounds); `boundedPreview` (exact hydration without replay); `unavailableHistory` (Go-produced broken-thread baseline beside healthy completion). `internal/ai/flower_preview_contract_test.go` generates published v7.102.0 sanitized intermediate/final membership and prefix locators; mapper tests cover atomic deltas/completion. Desktop `check-flower-startup.mjs`/`check-flower-navigation.mjs` qualify baselines,selection,drafts,one stream,no duplicate scan and cleanup. Finding earlier prose alone is not scrolling acceptance.
