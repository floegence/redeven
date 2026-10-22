---
type: UI Contract
title: Flower incremental live state
description: One workspace stream, actor-native updates, and one indexed ThreadCache.
tags: [ui, flower, live, threads]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret owns runtime state, canonical history, item identity and view versions. Redeven authorizes and projects public data; one workspace stream delivers it to ThreadCache. Ordinary text growth carries only the changed item and its UTF-8 append offset. It must not copy, scan, redact, encode or rebuild the complete history. Missing authority or a broken sequence invalidates observation and refreshes summaries plus the required current view through the existing connection owner. Execution and user drafts survive that recovery.

# Contract

## Publication and public data
Redeven requires the released optional Floret `ThreadUpdateSource` contract at startup.

Account watches, workload leases and Computer cleanup consume lightweight authoritative facts even with no viewer.

See [the adapter boundary](../ai/floret-redeven-adapter-and-projection.md).

## Wire v2 and bounded delivery
Flower schema v2 has one decoder and one update pipeline. Larger envelopes retain bounded fragments: envelope identity, zero-based fragment index/count, total bytes and Base64 payload.

Unknown command results retain their original request keys; a disconnect never repeats an effect automatically.

Initialization retains the complete authorized summary/read-state baseline as a byte-budgeted prefix. Concurrent runtime updates retain one dirty marker per `(runtime thread, wire thread, subagent route)` and the newest observed version. The consumer reads the authoritative current view outside the service lock after the prefix; it does not wait for a quiet producer. Publications newer than the captured view retain one marker for the next read.

During normal delivery, consecutive appends with identical thread/item/turn/run identities and stable runtime facts merge only when actor versions and UTF-8 byte offsets are contiguous. Output-token counts and last-progress timestamps may advance monotonically within the same provider attempt; the merged update retains the newest values. Attempt, phase, first-output and semantic changes remain boundaries. Re-encoding is bounded to one 32 KiB fragment. Other pending runtime mutations converge through a current snapshot; summary, viewer read state, and subagent inventory keep their latest independently scoped value. Already-started envelopes are never replaced.

A current view can advance ahead of the ordered publication pump. A transient, byte-accounted covered version suppresses already represented deltas until the pump catches up. A delta spanning that version requires another current view, never a partial text append. This is in-memory observation metadata, not a replay cursor or a second durable lifecycle.

Snapshots may cover transient phases such as preparing. The source still publishes admission before output; receivers apply the newest complete state without replaying an older phase over it. Pending approvals, interactions, tool results, cancellation, terminal facts, and full current text come from canonical authority. Missing, stale, or invalid authority fences the connection.

The existing 16 pending-batch, 32 MiB per-envelope/subscriber, and 32 MiB global retained-reference budgets remain enforced, including routing and merge metadata. Coalescing bounds repeated work for the same routes; more than 16 independent pending routes can still require recovery. Sampled convergence logs and closure logs include initialization phase, queue depth/bytes, batch kind, route, and version range without transcript content.

## ThreadCache and independent authorities
Workspace summary publication reads one authoritative Floret summary.

Viewer read events and current-only updates cannot manufacture loaded-content coverage.

## Commands and interaction
Canonical cancellation plus active state owns Stopping feedback.

See [approval/input contracts](flower-approval-context.md), [read state](flower-read-state.md) and [terminal disclosure](flower-turn-process-disclosure.md).

# Boundaries

The stream, frame queue and indexed cache are bounded observation mechanisms. Database kinds and all released migration edges remain unchanged.

# Evidence

- [Native pump and recovery](../../internal/ai/flower_runtime_update.go)

- [Projection and recovery tests](../../internal/ai/flower_runtime_update_test.go)

- [Field-level public DTOs](../../internal/ai/flower_public_dto.go)

- [Bounded stream and snapshot resolution](../../internal/ai/flower_live_stream.go)

- [Continuous initialization, slow-consumer Unicode soak, semantic state, route and budget tests](../../internal/ai/flower_live_backpressure_test.go)
