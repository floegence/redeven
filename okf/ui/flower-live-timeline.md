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

Floret owns runtime state, canonical history, item identity and view versions. Redeven authorizes and projects public data; one workspace stream delivers it to ThreadCache. Ordinary text growth carries only the changed item and its UTF-8 append offset. It must not copy, scan, redact, encode or rebuild the complete history. Lost window continuity refreshes only the affected reading interest. Transport loss uses the existing connection owner. Execution, accepted prose and user drafts survive either recovery.

# Contract

## Publication and public data
Redeven requires the released optional Floret observation contracts. The service consumes `ThreadFactsSource.SubscribeFacts` for cleanup and workspace facts without hydrating bodies. The selected conversation and optional child panel each own an authorized `ThreadWindowSource` reading interest. One worker coalesces dirty parent identities for child inventory refreshes; it retains at most 64 pending parents and never blocks the facts pump on child reads.

Account watches, workload leases and Computer cleanup consume lightweight authoritative facts even with no viewer.

See [the adapter boundary](../ai/floret-redeven-adapter-and-projection.md).

## Wire v3 and bounded delivery
Flower schema v3 has one decoder and one update pipeline. Larger envelopes retain bounded fragments: envelope identity, zero-based fragment index/count, total bytes and Base64 payload.

Unknown command results retain their original request keys; a disconnect never repeats an effect automatically.

Initialization registers observation before freezing authorized roots in product
navigation order. Frozen IDs count against global/subscriber budgets and are
released as pages drain. Ready publishes the observer identity immediately, before
any canonical summary read. One asynchronous reader loads at most 25 summaries;
subsequent pages wait for their predecessor to drain. Each page has explicit
baseline_complete (true only on the last), then private read states. Accepted
reading-interest updates bypass an unfinished sidebar baseline. Observer close
cancels page reads; canonical failures invalidate observation. Sidebar preparation
has no arbitrary ten-second cutoff. Pin changes cannot skip frozen roots.

Sidebar pages merge immediately; only completion prunes roots, retaining selection
and locally created roots. A first sidebar result or accepted selected detail ends initial loading. Explicit refresh
uses cancellable 25-row HTTP pages with ten seconds per progressing page; failure
keeps delivered pages. Desktop cancellation covers history/item POST reads.

Unselected roots publish coalesced facts without bodies. The selected root owns
one workspace reading interest with monotonic reading revision; the child panel owns a separate slot. HTTP baseline
and later changes use the same Floret subscription. Page changes replace interest;
older revisions cannot update the displayed page.

Reading starts at the latest interval: at most 150 items within Floret's 512 KiB
window budget. Earlier, newer and latest controls replace it explicitly without
truncating canonical history. Only cold historical text uses a skeleton. Live or
previously displayed prose stays mounted during growth, refresh and completion.
One viewport observer admits reads within 160 pixels. Text and explicitly opened
tool details share two slots and a fifteen-second deadline. Offscreen/navigation
cancellation removes queued demand and aborts active reads. The normal renderer
preserves attachments and references; the scroll owner preserves reading anchors
and user-selected tail-follow. Failures expose local Retry without stopping sync.

ThreadCache alone retains expanded bodies for valid item/turn/run/source identity.
Live reads resolve ItemBody with fresh authorization, then ReadLiveBody returns
at most 16 KiB from the accepted UTF-8 offset. One task per source coalesces
extents, accepts older in-flight prefixes and yields between chunks. No polling,
full-prefix re-download, whole-thread fetch or second transcript store exists.
Canonical completion retains prose until canonical verification; stale runs and
expired live locators cannot overwrite it.

Updates affect only accepted membership and bodies. Appends merge within one
32 KiB fragment only for matching reading revision, thread/item/turn/run,
contiguous versions and UTF-8 offsets. Body growth sends locators, not prefixes.
Contiguous same-source extents coalesce server-side and per browser frame with
constant queue storage, the original base version and all semantic boundaries.
Command latest-page receipts cannot replace historical reading interest; the
authorized detail loader refreshes that interest.

Budgets remain: 16 pending batches, 32 MiB per envelope/subscriber and 32 MiB
globally retained references. Lost window continuity emits revision-fenced
history_invalidated for that interest. The browser attempts one bounded read
per selection or manual action; repeated loss exposes local Retry without a loop.
Failed HTTP history reads and page moves keep accepted content and anchors;
revision-fenced history-release cancels installed or pending interests without
waiting on slow reads. Closing a child releases only its slot. Never combine a
one-shot window with an old subscription's membership. Transport loss, stream
handshake deadlines and workspace sequence gaps reconnect through the existing
owner with bounded exponential backoff. Authorization,
capacity, version incompatibility and malformed contracts remain terminal.
Fetch/bridge classification precedes mapping: mapper exceptions are not retries.
Diagnostics contain category, HTTP status and connection epoch, never response
bodies or arbitrary server messages. Execution and drafts survive recovery.
Initial SSE sync loss returns 503; baseline timeout 504; invalid request 400;
observer capacity 429. These codes use the same recovery owner during rebind.

After selection, the composer status lane localizes connecting, reconnecting and
unconfirmed status. It never animates stale progress. Terminal failure offers
Resync; a fresh baseline restores canonical progress without composer remount.

Child detail uses the same bounded history and body readers, with independent pagination and revision fencing. Canonical command receipts refresh the accepted child interval instead of replacing it. Byte-accounted covered versions suppress already represented deltas. Summary, viewer read state and subagent inventory retain independent mailboxes. Already-started frames are never replaced. These are ephemeral observations, not durable cursors or a second lifecycle.

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
