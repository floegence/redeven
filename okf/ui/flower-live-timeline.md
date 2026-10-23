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
Redeven requires the released optional Floret observation contracts. The service consumes runtime updates for cleanup and workspace facts; the selected root conversation uses an authorized `ThreadWindowSource` reading interest.

Account watches, workload leases and Computer cleanup consume lightweight authoritative facts even with no viewer.

See [the adapter boundary](../ai/floret-redeven-adapter-and-projection.md).

## Wire v2 and bounded delivery
Flower schema v2 has one decoder and one update pipeline. Larger envelopes retain bounded fragments: envelope identity, zero-based fragment index/count, total bytes and Base64 payload.

Unknown command results retain their original request keys; a disconnect never repeats an effect automatically.

Initialization delivers the authorized summary/read-state baseline. Unselected root conversations publish coalesced runtime facts without item bodies. The selected root establishes one reading interest on its workspace observer using a monotonically increasing reading revision. Its HTTP baseline is consumed from the same Floret subscription that supplies subsequent changes. Changing pages replaces that interest; older revisions cannot update the displayed page.

The initial page contains the latest interval, at most 150 items under Floret's 512 KiB item-window budget. Earlier, newer and latest controls replace the interval explicitly. Canonical history remains complete. Large text is a raw UTF-8 preview inside the ordinary message shell, retaining references and attachments; it is never parsed as an independent Markdown document. Tool presentation and complete text load only when opened. Expanded immutable items remain in ThreadCache while their canonical preview and identity remain unchanged; navigation cancels outstanding body requests, and stale completions cannot overwrite newer content.

Native changes update only accepted membership and bodies. Contiguous appends merge only within the same reading revision and exact thread/item/turn/run identities, actor versions and UTF-8 offsets. Merge work stays within one 32 KiB fragment. Bounded body growth advances its locator rather than retransmitting the prefix. A command's latest-page receipt cannot replace an active historical interval; the authorized detail loader refreshes that reading interest instead.

The existing 16 pending-batch, 32 MiB per-envelope/subscriber and 32 MiB global retained-reference budgets remain enforced. Pressure or lost continuity on a bounded reading route invalidates observation and reconnects through the normal bounded baseline path. A separate one-shot window must not be combined with the old subscription's different membership. Reading failures fence observation until retry; failed page movement retains its prior accepted anchor. Execution and drafts survive recovery.

Child detail retains the existing full-view transport. Its initialization/pressure markers converge through a canonical current snapshot; byte-accounted covered versions suppress already represented deltas. Summary, viewer read state and subagent inventory retain independent mailboxes. Already-started frames are never replaced. These are ephemeral observations, not durable cursors or a second lifecycle.

Pending controls remain available independently of the selected page. Computer assistance may cite a tool outside the interval: authorized server-only canonical evidence validates provenance and publishes status, while the historical body stays off the wire. Missing authority fences observation.

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

- [Mixed backlog without historical hydration, fragment boundaries, and capacity recovery](../../internal/ai/flower_live_incremental_pressure_test.go)

- [Continuous initialization, slow-consumer Unicode soak, semantic state, route and budget tests](../../internal/ai/flower_live_backpressure_test.go)

- [History and body boundary](../../internal/ai/flower_history.go) and [observer ownership](../../internal/ai/flower_history_observer.go).
- [Bounded history regressions](../../internal/ai/flower_history_test.go) and [browser interactions](../../internal/envapp/ui_src/src/ui/FlowerSurface.history.browser.test.tsx).
