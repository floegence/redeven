---
type: UI Contract
title: Flower incremental live state
description: One workspace facts stream, two bounded reading interests, and one indexed ThreadCache.
tags: [ui, flower, live, threads]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Floret owns canonical history, identity and versions. Redeven authorizes public
projection; one workspace stream delivers it to ThreadCache. Text growth changes
one item at its UTF-8 offset, never copying, scanning or encoding complete history.
Window loss refreshes that reading interest; transport loss uses the existing
connection owner. Both preserve execution, accepted prose and drafts.

# Contract

## Ownership and initialization

The service consumes released `ThreadFactsSource.SubscribeFacts` without body
hydration for account watches, workload/Computer cleanup and workspace facts,
including when nobody is viewing. Root and optional child each own one authorized
`ThreadWindowSource` interest. One worker coalesces child inventory refreshes with
at most 64 dirty parents; it never blocks the facts pump on child reads. See
[adapter ownership](../ai/floret-redeven-adapter-and-projection.md).

Observation registers before freezing authorized roots in navigation order.
Frozen IDs and their backing array are budgeted and released as pages drain.
Ready sends observer identity before canonical summary reads. One asynchronous
reader loads at most 25 summaries per page, starting the next after the prior
drains. Pages carry `baseline_complete`, true only on the last, followed by private
read states. Accepted reading updates bypass unfinished sidebar preparation;
ordinary concurrent facts stay behind its baseline. Close cancels the reader;
canonical failure invalidates observation. There is no arbitrary ten-second
sidebar cutoff, and pin changes cannot skip frozen roots.

Pages merge immediately; only completion prunes roots, preserving selection and
local creations. The first page, confirmed empty inventory or accepted selected
detail admits the initial surface. Partial empty Ready does not. Explicit HTTP
refresh uses cancellable 25-row pages with ten seconds per progressing page and
retains delivered pages on failure. Desktop cancellation includes history/item
POST reads. [Startup](../architecture/flower-startup-presentation.md) owns display.

## Reading, bodies and delivery

Root and child slots use independent monotonic revisions. Each HTTP baseline and
its deltas come from the same subscription; replacing a page replaces interest.
Old revisions cannot change the page. Latest/earlier/newer controls select at most
150 items within the 512 KiB window budget without truncating canonical history.
Command receipts refresh the accepted interval rather than installing a latest
page over historical reading.

Only unseen historical text uses skeletons. Accepted prose remains mounted during
body growth, refresh and completion. One viewport observer admits demand within
160 pixels; text and explicitly opened tools share two read slots and a fifteen-
second deadline. Offscreen/navigation cancellation removes queued demand and
aborts reads. The normal renderer retains attachments/references, while the scroll
owner retains anchors and user-selected tail-follow. Failures offer local Retry.

ThreadCache alone retains expanded bodies by valid item/turn/run/source identity.
Freshly authorized ItemBody and ReadLiveBody return at most 16 KiB from the accepted
UTF-8 offset. One source task coalesces extents, accepts earlier in-flight prefixes
and yields between chunks. No polling, full-prefix downloads, whole-thread fetches
or duplicate transcript store. Completion retains prose through canonical
verification; stale runs and expired locators cannot overwrite it.

Schema v3 has one decoder/update pipeline. Fragmented envelopes carry identity,
zero-based index/count, total bytes and Base64. Appends merge within one 32 KiB
fragment only for matching revision, thread/item/turn/run, contiguous version and
UTF-8 offset. Body growth sends locators, not prefixes. Same-source extents
coalesce server-side/per browser frame with constant storage, original base version
and semantic boundaries. Budgets remain 16 pending batches, 32 MiB per envelope/
subscriber and 32 MiB globally retained references. Started frames are immutable;
byte-accounted covered versions suppress represented deltas. Summary, private
read-state and child inventory keep independent mailboxes.

Pending controls are independent of page membership. Server-only authorized
canonical evidence validates Computer tools outside the interval and publishes
status without sending historical bodies. Missing authority fences observation.

## Recovery and interaction

Window loss emits revision-fenced `history_invalidated`. One automatic bounded
read is allowed per selection/manual action; repeated loss offers local Retry
without looping. Failed HTTP/page reads preserve accepted content and anchors.
Revision-fenced `history-release` cancels installed or pending interest without
waiting for slow reads; child close releases only its slot. A one-shot window
must never reuse an old subscription's membership.

Transport loss, handshake deadlines and workspace sequence gaps use the existing
bounded exponential-backoff owner. Authorization, capacity, incompatible versions
and malformed contracts remain terminal. Fetch/bridge classification precedes
mapping; mapper exceptions are not retried. Diagnostics expose category, HTTP
status and epoch, never bodies/arbitrary server messages. Initial SSE sync loss
is 503, baseline timeout 504, invalid request 400, capacity 429. Unknown command
results keep request keys; disconnect never automatically repeats an effect.

The mounted composer localizes connecting/reconnecting/unconfirmed status without
animating stale progress; terminal failure offers Resync. Canonical cancellation
and active state own Stopping. Summary publication reads one canonical summary;
viewer-read/current-only updates cannot manufacture loaded-content coverage.
See [approvals/input](flower-approval-context.md), [read state](flower-read-state.md)
and [process disclosure](flower-turn-process-disclosure.md).

# Boundaries

Streams, queues and cache are bounded ephemeral observation, never durable cursors
or another lifecycle. Database kinds and all released migration edges remain.

# Evidence

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Facts pump](../../internal/ai/flower_runtime_update.go), [recovery tests](../../internal/ai/flower_runtime_update_test.go), [public DTOs](../../internal/ai/flower_public_dto.go).
- [Bounded stream](../../internal/ai/flower_live_stream.go), [mixed pressure](../../internal/ai/flower_live_incremental_pressure_test.go), [slow-consumer/Unicode/budget tests](../../internal/ai/flower_live_backpressure_test.go).
- [History](../../internal/ai/flower_history.go), [interest ownership](../../internal/ai/flower_history_observer.go), [backend regressions](../../internal/ai/flower_history_test.go), [browser history](../../internal/envapp/ui_src/src/ui/FlowerSurface.history.browser.test.tsx).
