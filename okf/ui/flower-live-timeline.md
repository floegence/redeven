---
type: UI Contract
title: Flower incremental live state
description: One workspace facts stream, two bounded reading interests, and one indexed ThreadCache.
tags: [ui, flower, live, threads]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Floret owns canonical history, identity and versions. Redeven authorizes public
projection; one workspace stream delivers it to ThreadCache. Text growth changes
one item at its UTF-8 offset, never copying, scanning or encoding complete history.
Window loss refreshes that reading interest; transport loss uses the existing
connection owner. Both preserve execution, accepted prose and drafts.

# Contract

## Ownership and initialization
Released `ThreadFactsSource.SubscribeFacts` serves account watches, workload/Computer cleanup and workspace observation without body hydration or a viewer. Root and optional child have independent authorized `ThreadWindowSource` interests. One worker coalesces child refreshes with at most 64 dirty parents, never blocking the facts pump; see [adapter ownership](../ai/floret-redeven-adapter-and-projection.md).

Register observation before freezing authorized roots in navigation order. Budget IDs/backing arrays and release them as pages drain. Ready publishes observer identity before asynchronous canonical summaries, at most 25 per page; drain each before starting the next. Only the last has `baseline_complete`, followed by private read states. Accepted reading updates bypass sidebar preparation; ordinary facts wait behind its baseline. Close cancels reads; canonical failure invalidates observation. No arbitrary sidebar timeout or pin-induced skipped roots.

Merge pages immediately; prune only at completion, preserving selection/local creations. First page, confirmed empty inventory or accepted selected detail admits the initial surface; partial empty Ready does not. Explicit HTTP refresh uses cancellable 25-row pages with ten seconds per progressing page and preserves delivered pages on failure. Desktop also cancels history/item POST reads. [Startup](../architecture/flower-startup-presentation.md) owns display.

## Reading, bodies and delivery
Root/child slots have independent monotonic revisions. Baseline and deltas share a subscription; replacing a page replaces its interest and fences older revisions. Latest/earlier/newer reads select at most 150 items within 512 KiB; receipts refresh the accepted interval, never replace historical reading with Latest.

Only unseen text uses skeletons. Accepted prose, attachments/references, anchors and chosen follow state survive growth, refresh and completion. One observer admits demand within 160 pixels; text/open tools share two slots and a fifteen-second deadline. Offscreen/navigation cancellation removes demand and aborts reads; failures offer local Retry.

ThreadCache alone retains expanded bodies by item/turn/run/source identity. Freshly authorized ItemBody/ReadLiveBody reads return at most 16 KiB from the accepted UTF-8 offset. One source task coalesces extents, accepts earlier in-flight prefixes and yields between chunks. No polling, full-prefix/history downloads or duplicate transcript store. Completion verifies canonical content without removing prose; stale runs/locators cannot overwrite it.

Schema v3 has one decoder. Fragments carry identity, zero-based index/count, total bytes and Base64. Only matching revision/thread/item/turn/run, contiguous version and UTF-8 offset can merge appends inside a 32 KiB fragment. Growth sends locators, not prefixes. Same-source extents coalesce server-side/per browser frame with constant storage, original base version and preserved semantic boundaries. Limits: 16 pending batches, 32 MiB per envelope/subscriber and 32 MiB global retained references. Started frames are immutable; byte-accounted covered versions suppress represented deltas. Summary, private read state and child inventory use independent mailboxes.

Pending controls do not depend on page membership. Server-only authorized canonical evidence validates out-of-window Computer tools without sending historical bodies; missing authority fences observation.

## Recovery and interaction
Revision-fenced `history_invalidated` permits one automatic bounded read per selection/manual action; repeated loss offers Retry. Failed reads preserve content/anchors. `history-release` cancels installed/pending interest without waiting for slow reads; child close releases only its slot. One-shot windows cannot reuse old subscription membership.

Transport loss, handshake deadlines and sequence gaps use the existing bounded backoff owner. Authorization, capacity, incompatible versions and malformed contracts are terminal. Classify fetch/bridge errors before mapping; mapper exceptions are not retried. Diagnostics expose category, HTTP status and epoch, never bodies or arbitrary server messages. SSE sync loss is 503, baseline timeout 504, invalid request 400, capacity 429. Unknown command results retain request keys; disconnect cannot replay effects.

Mounted composers localize connection/unconfirmed status without stale animation; terminal failure offers Resync. Canonical cancellation/activity owns Stopping. Each summary publication reads one canonical summary; viewer/current-only updates cannot invent loaded coverage. [Approvals/input](flower-approval-context.md), [read state](flower-read-state.md) and [process disclosure](flower-turn-process-disclosure.md) own their policies.

# Boundaries

Streams, queues and cache are bounded ephemeral observation, never durable cursors
or another lifecycle. Database kinds and all released migration edges remain.

# Evidence

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Facts pump](../../internal/ai/flower_runtime_update.go), [recovery tests](../../internal/ai/flower_runtime_update_test.go), [public DTOs](../../internal/ai/flower_public_dto.go).
- [Bounded stream](../../internal/ai/flower_live_stream.go), [mixed pressure](../../internal/ai/flower_live_incremental_pressure_test.go), [slow-consumer/Unicode/budget tests](../../internal/ai/flower_live_backpressure_test.go).
- [History](../../internal/ai/flower_history.go), [interest ownership](../../internal/ai/flower_history_observer.go), [backend regressions](../../internal/ai/flower_history_test.go), [browser history](../../internal/envapp/ui_src/src/ui/FlowerSurface.history.browser.test.tsx).
