---
type: UI Contract
title: Flower incremental live state
description: One workspace facts stream, two bounded reading interests, and one indexed ThreadCache.
tags: [ui, flower, live, threads]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Floret owns canonical history, identity and versions. Redeven authorizes public
projection; one workspace stream delivers it to ThreadCache. Text growth changes
one item at its UTF-8 offset, never copying, scanning or encoding complete history.
Window loss refreshes that reading interest; transport loss uses the existing
connection owner. Both preserve execution, accepted prose and drafts.

# Contract

## Ownership and initialization
`ThreadFactsSource.SubscribeFacts` serves account watches, workload/Computer cleanup and workspace observation without bodies or a viewer. Root/child have independent authorized `ThreadWindowSource` interests. One worker coalesces up to 64 dirty parents without blocking the facts pump; see [adapter ownership](../ai/floret-redeven-adapter-and-projection.md).

Register observation before freezing authorized roots in navigation order. Budget/release IDs and backing arrays as pages drain. Ready publishes observer identity, then canonical summaries in drained pages of at most 25; only the last has `baseline_complete`, followed by private read states. Accepted reading updates bypass sidebar preparation; ordinary facts wait for its baseline. Close/cancellation releases subscribers and queued bytes without requiring Next; canonical failure invalidates observation. No arbitrary sidebar timeout or pin-induced skipped roots.

Merge pages immediately; prune only at completion, preserving selection/local creations. First page, confirmed empty inventory or accepted selected detail admits the initial surface; partial empty Ready does not. Explicit HTTP refresh uses cancellable 25-row pages with ten seconds per progressing page and preserves delivered pages on failure. Desktop also cancels history/item POST reads. [Startup](../architecture/flower-startup-presentation.md) owns display.

## Reading, bodies and delivery
Foreground history waits for the current live observer. Ready installs its baseline before releasing navigation into the shared loader. A covered response coalesces later baseline demand; explicit command confirmation remains forced. Navigation, disposal and transport changes cancel obsolete waiters. Reconnect binds a fresh read to the new observer while retaining accepted content, scroll state and unsent drafts.

Root/child slots have independent monotonic revisions. Baseline and deltas share a subscription; replacing a page replaces its interest and fences older revisions. First reads select up to 50 items with 1 KiB text previews and Activity field summaries, subject to the window byte budget. Explicit earlier/newer reads select at most 150 items within 512 KiB; receipts refresh the accepted interval, never replace historical reading with Latest.

Collapsed patch rows use Activity summary display name/change type for one mutation, or localized mutation count for multiple files, without detail reads or invented diff rows/targets. Expansion retains titles, patch totals and each file's statistics.

Root/child window POSTs allow 64 KiB JSON / 150 identities; item/body locators allow 8 KiB. Exact membership budgets 448 KiB canonical preview metadata, excluding hydrated bodies. Selection charges the larger of transmitted size and the original canonical window_bytes carried by compact tool summaries. Network interest stays bounded independently of the reading document. Visited sealed items retain reactive owners and bodies on the confirmed path; eviction removes whole inactive documents. Visible/focused/selected live islands stay mounted. Gap refills stop at the missing interval; prefetch advances only ahead of the reading edge. One coalesced scroll demand owns each handoff; HTTP/layout completion cannot traverse collapsed history recursively. Stationary edge input can request the next page. Failed navigation retains content/drafts and offers localized Retry.

Publish the bounded reading window without completing the surrounding turns for statistics. A sequence shows exact counts only when its loaded boundaries and intervening items/parent events are known; otherwise its sole summary is the localized “Consecutive tool calls” label. Running groups can already have complete counts. Normal scrolling can supply missing evidence, but count presentation never starts history requests, receipt backfill or body reads. Receipt alignment reads at most one preview page per displayed span; missing intervals remain ordinary scroll demand.

The foreground reader owns publication; live baselines wait in its handoff queue. Retention uses one prefix check: sealed ID, kind, turn/run, ordinal and canonical ordinal must match. Reuse only the preceding confirmed cached prefix without inferring a new end from the old window. Pagination preserves manual sequence disclosure through anchor changes and subsequent navigation, and moving canonical rows preserves focus and selected text.

Collapsed Activity summaries carry exact shape, counts, scalars and small display values without per-field body locators. Explicit Activity structure/value reads acquire authorized frozen sources; storage, indexes and migrations stay unchanged.

Only unseen text uses skeletons. Accepted prose, attachments/references, anchors and chosen follow state survive growth, refresh and completion. One observer admits demand within 160 pixels; text/open tools share two slots and a fifteen-second deadline. Visible live text and interactive disclosure precede ordinary visible history reads, then background work; aging every eight admissions prevents starvation. Offscreen/navigation cancellation removes demand and aborts reads; failures offer local Retry.

ThreadCache alone retains expanded bodies by item/turn/run/source identity. Freshly authorized ThreadItemTextReader.ReadItemText reads return at most 16 KiB from the accepted UTF-8 offset. One source task coalesces extents, accepts earlier in-flight prefixes and yields between chunks. No polling, full-prefix/history downloads or duplicate transcript store. A changed source, including live-to-canonical sealing, restarts at its canonical preview byte offset; live and sealed text need not share a suffix or extent. Retain visible prose while bounded chunks assemble the new source, then publish the complete replacement once. Same-source refreshes retain read progress; late old-source chunks cannot overwrite it. Exhausted or terminal body failures expose an explicit localized Retry without replaying execution.

Schema v3 has one decoder. Fragments carry identity, zero-based index/count, total bytes and Base64. Only matching revision/thread/item/turn/run, contiguous version and UTF-8 offset can merge appends inside a 32 KiB fragment. Growth sends locators, not prefixes. Same-source extents coalesce server-side/per browser frame with constant storage, original base version and preserved semantic boundaries. Limits: 16 pending batches, 32 MiB per envelope/subscriber and 32 MiB global retained references. Started frames are immutable; byte-accounted covered versions suppress represented deltas. Summary, private read state and child inventory use independent mailboxes.

Pending controls do not depend on page membership. Server-only authorized 64-item pages collect Computer safety facts only from pending turns, stopping at their user boundaries. Leaf/version confirmation rejects mixed snapshots; oversized safety collections use individual member reads. No full View or historical bodies cross this path. Missing authority or a broken sequence invalidates observation.

Measured offscreen sections retain DOM and intrinsic height while skipping layout. Returning to inspected content preserves disclosure state and nested offsets; report choices belong to the displayed thread, so a Fork does not inherit its source thread's manual disclosure; unchanged sections and unrelated message projections retain identity. One scroll controller owns writes and corrects the visible reading anchor before paint, including stationary edge input and replacement of a summary or placeholder. Readiness notifications remain scheduled independently of before-paint correction.

Cold sealed bodies stage all bounded chunks inside their existing item record and keep the loading presentation until complete, including across reconnect. Complete Markdown publishes atomically with no entrance height animation or partial table/code/list formatting. Existing readable prose remains visible during source replacement; live sources still grow incrementally. Root and child navigation suppress arrival scrolling until the destination is positioned and revealed at its final geometry. Cache accounting traverses each raw object once without recursively unwrapping reactive subtrees or subscribing to their fields.

Compaction decorations accompany visible anchors and the active run's latest operation. Paging restores historical decorations; canonical context remains complete.

ThreadCache evicts inactive detail at twelve threads or 32 MiB estimated detail bytes; lightweight navigation summaries survive eviction. Selected, retained and in-flight owners are protected until release. Append logs retain at most 256 chunks / 256 KiB, with absolute cursors and exact-source catch-up for a paused Markdown consumer. These are cache budgets, not a cap on an explicitly active document or selected text.

History loading and terminal catch-up share the floating notice below. Catch-up reuses the 200 ms feedback deadline: fast completion mounts nothing, data publication remains immediate, and overlapping reads never duplicate notices.

## Immediate send feedback
[Command/composer ownership](flower-turn-launcher.md) shows captured input immediately, retains request-key DOM identity through admission, and separates SendAck from authorized windows without a second lifecycle.

## Recovery and interaction
The coalesced detail loader owns recovery under one fifteen-second deadline: retry the entire baseline/preparation after 200, 600 and 1200 ms, at most four attempts. New revisions discard unpublished pages and obsolete envelopes. Leaf changes are recoverable; foreign threads and malformed ordering are terminal. Navigation, disposal and connection changes cancel reads/backoff. Success adds no timer or read. Accepted DOM, drafts and scroll remain; exhausted refresh offers Retry with interrupted-sync wording, while first-load failure keeps its own title. Recovery never replays commands or execution.

Revision-fenced `history_invalidated` permits one automatic bounded read per selection/manual action; repeated loss offers Retry. Failed reads preserve content/anchors. `history-release` cancels installed/pending interest without waiting for slow reads; child close releases only its slot. One-shot windows cannot reuse old subscription membership.

Transport loss, handshake deadlines and sequence gaps use the existing bounded backoff owner. Final disposal aborts transport without publishing reactive state or cache boundaries into a component tree being torn down; reconnect continues to publish its boundary. Activity visibility observers attach after DOM adoption and disconnect with their row. Authorization, capacity, incompatible versions and malformed contracts are terminal. Classify fetch/bridge errors before mapping; mapper exceptions are not retried. Diagnostics expose category, HTTP status and epoch, never bodies or arbitrary server messages. SSE sync loss is 503, baseline timeout 504, invalid request 400, capacity 429. Unknown command results retain request keys; disconnect cannot replay effects.

One floating stack owns connection/unconfirmed status, settings reads, initial/detail/history failures, parent-report recovery and return-to-parent navigation. Main, embedded and child notices consume no transcript height; collapsed-companion notices float above its editor. Loading uses the sidebar's four wave bars, localized text, live status and reduced-motion support. Errors retain explanations and recovery actions; terminal connection failure offers Resync. Notices stack without overlap and alone accept pointer input. The composer omits duplicate recovery and keeps its progress slot height. Canonical cancellation/activity owns Stopping. Publications read one canonical summary; Viewer/current-only updates cannot invent loaded coverage. [Approvals/input](flower-approval-context.md), [read state](flower-read-state.md) and [process disclosure](flower-turn-process-disclosure.md) own their policies.

# Boundaries

Streams, queues and cache are bounded ephemeral observation, never durable cursors
or another lifecycle. Database kinds and all released migration edges remain.

# Evidence

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Facts pump](../../internal/ai/flower_runtime_update.go), [recovery tests](../../internal/ai/flower_runtime_update_test.go), [public DTOs](../../internal/ai/flower_public_dto.go).
- [Bounded stream](../../internal/ai/flower_live_stream.go), [mixed pressure](../../internal/ai/flower_live_incremental_pressure_test.go), [slow-consumer/Unicode/budget tests](../../internal/ai/flower_live_backpressure_test.go).
- [History](../../internal/ai/flower_history.go), [interest ownership](../../internal/ai/flower_history_observer.go), [backend regressions](../../internal/ai/flower_history_test.go), [browser history](../../internal/envapp/ui_src/src/ui/FlowerSurface.history.browser.test.tsx).
- [Confirmed window retention](../../internal/flower_ui/src/historyWindowRetention.test.ts), [bounded browser publication](../../internal/envapp/ui_src/src/ui/FlowerSurface.continuousHistory.browser.test.tsx), [body layout](../../internal/flower_ui/src/historyBodyLayout.client.test.ts) and [scroll ownership](../../internal/flower_ui/src/flowerScrollTail.test.ts) cover partial boundaries, ordered-baseline races, cancellation, native input and hydration.
- [Floating notice geometry](../../internal/envapp/ui_src/src/ui/FlowerSurface.floatingNotices.browser.test.tsx) and [localized recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.syncStatus.browser.test.tsx) cover new-chat loading/failure/retry, narrow layouts, keyboard recovery and unchanged transcript/composer bounds.
- [Detail recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.historySyncRecovery.browser.test.tsx) covers first-open and summary-refresh source changes, exhaustion, disposal, revision fencing and stable DOM/drafts/scroll; [read recovery](../../internal/flower_ui/src/historyReadRecovery.test.ts) verifies the total deadline and unchanged success-path request/timer counts.
