---
type: UI Contract
title: Flower incremental live state
description: One workspace stream, actor-native updates, and one indexed ThreadCache.
tags: [ui, flower, live, threads]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Floret owns runtime state, canonical history, item identity and view versions. Redeven authorizes and projects public data; one workspace stream delivers it to ThreadCache. Ordinary text growth carries only the changed item and its UTF-8 append offset. It must not copy, scan, redact, encode or rebuild the complete history. Missing authority or a broken sequence invalidates observation and refreshes summaries plus the required current view through the existing connection owner. Execution and user drafts survive that recovery.

# Contract

## Publication and public data
Redeven requires the released optional Floret observation contracts. The service consumes runtime updates for cleanup and workspace facts; the selected root conversation uses an authorized `ThreadWindowSource` reading interest.

Account watches, workload leases and Computer cleanup consume lightweight authoritative facts even with no viewer.

See [the adapter boundary](../ai/floret-redeven-adapter-and-projection.md).

## Wire v3 and bounded delivery
Flower schema v3 has one decoder and one update pipeline. Larger envelopes retain bounded fragments: envelope identity, zero-based fragment index/count, total bytes and Base64 payload.

Unknown command results retain their original request keys; a disconnect never repeats an effect automatically.

Initialization registers observation before freezing authorized root IDs in product navigation order. It reads at most 25 canonical summaries before the first ready envelope, then reads each subsequent page as the previous page drains. Every baseline page carries an explicit boolean baseline_complete; only the final page is true. Frozen IDs count against subscriber and global memory budgets and are released as pages drain. Each page precedes its private viewer read states; concurrent live publications follow the complete baseline. Each page has a ten-second read deadline; a stalled page fails the observer rather than extending startup indefinitely. Closing observation cancels in-flight reads. Pin changes during loading cannot skip frozen roots.

The sidebar merges partial pages immediately and prunes old roots only at completion, preserving selection and roots created locally during loading. The live baseline owns initial list loading. Explicit list refresh uses cancellable 25-row HTTP pages with the existing ten-second deadline applied to each progressing page; delivered pages remain usable on failure. History and item POST reads participate in Desktop read cancellation.

Unselected root conversations publish coalesced runtime facts without item bodies. The selected root establishes one reading interest on its workspace observer using a monotonically increasing reading revision. Its HTTP baseline is consumed from the same Floret subscription that supplies subsequent changes. Changing pages replaces that interest; older revisions cannot update the displayed page.

The initial page contains the latest interval, at most 150 items under Floret's 512 KiB item-window budget. Earlier, newer and latest controls replace the interval explicitly. Canonical history remains complete. Truncated ordinary user/assistant text is a loading placeholder, never a separate Markdown document or a manual expansion step. One viewport observer requests complete bodies when their message enters the viewport or its 160-pixel margin. Text and explicitly opened tool details share one two-slot request queue with a fifteen-second read deadline. Leaving the viewport or conversation cancels automatic reads; queued offscreen requests never start. Complete text uses the ordinary Markdown/media renderer, preserving references and attachments. Hydration preserves the current reading anchor through the existing scroll owner; tail-follow remains active only when the reader chose it. Tool presentation remains disclosure-driven. A failed body read offers local Retry without stopping workspace synchronization. Expanded immutable items remain in the existing bounded-window ThreadCache while their canonical preview and identity remain unchanged; stale completions cannot overwrite newer content. No whole-thread download or duplicate transcript store is introduced.

Native changes update only accepted membership and bodies. Contiguous appends merge only within the same reading revision and exact thread/item/turn/run identities, actor versions and UTF-8 offsets. Merge work stays within one 32 KiB fragment. Bounded body growth advances its locator rather than retransmitting the prefix. A command's latest-page receipt cannot replace an active historical interval; the authorized detail loader refreshes that reading interest instead.

The existing 16 pending-batch, 32 MiB per-envelope/subscriber and 32 MiB global retained-reference budgets remain enforced. Pressure or lost continuity on a bounded reading route invalidates observation and reconnects through the normal bounded baseline path. A separate one-shot window must not be combined with the old subscription's different membership. Reading failures fence observation before recovery; failed page movement retains its prior accepted anchor. Transport loss, read/handshake timeouts, HTTP 408/5xx and lost sequence continuity reconnect through the same owner with bounded exponential backoff. Authorization, capacity, incompatible versions and malformed contracts remain actionable terminal failures. Fetch/bridge failures are classified before history mapping, so mapper exceptions cannot become transport retries. Terminal diagnostics include only error category, HTTP status and connection epoch, never response bodies or arbitrary server messages. Execution and drafts survive recovery. A failed initial SSE subscription maps runtime synchronization loss to HTTP 503 and baseline deadlines to HTTP 504, so the same recovery owner retries while the backend rebinds. Invalid requests remain HTTP 400 and observer capacity remains HTTP 429. After conversation selection, the composer status lane shows localized connecting, reconnecting or status-unconfirmed feedback while observation is unavailable. It never animates stale execution progress; terminal failure offers Resync through the existing workspace owner. A fresh baseline restores canonical progress without remounting the composer.

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

- [Isolated Electron startup acceptance](../../desktop/scripts/check-flower-startup.mjs): run `pnpm --dir desktop test:flower-startup` to verify preparation, partial selection, final membership, draft retention and cleanup against a built renderer. Reports and screenshots are written to `desktop/dist/flower-startup-acceptance`.
- [English and Chinese navigation acceptance](../../desktop/scripts/check-flower-navigation.mjs): verifies that navigation retains the selected conversation and draft while later baseline pages arrive, with one live stream and no duplicate HTTP list scan.

- [Native pump and recovery](../../internal/ai/flower_runtime_update.go)

- [Projection and recovery tests](../../internal/ai/flower_runtime_update_test.go)

- [Field-level public DTOs](../../internal/ai/flower_public_dto.go)

- [Bounded stream and snapshot resolution](../../internal/ai/flower_live_stream.go)

- [Mixed backlog without historical hydration, fragment boundaries, and capacity recovery](../../internal/ai/flower_live_incremental_pressure_test.go)

- [Continuous initialization, slow-consumer Unicode soak, semantic state, route and budget tests](../../internal/ai/flower_live_backpressure_test.go)

- [History and body boundary](../../internal/ai/flower_history.go) and [observer ownership](../../internal/ai/flower_history_observer.go).
- [Bounded history regressions](../../internal/ai/flower_history_test.go) and [browser interactions](../../internal/envapp/ui_src/src/ui/FlowerSurface.history.browser.test.tsx).
