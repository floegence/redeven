---
type: UI Contract
title: Flower incremental live state
description: One workspace stream, actor-native updates, and one indexed ThreadCache.
tags: [ui, flower, live, threads]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Floret owns runtime state, canonical history, item identity and view versions. Redeven authorizes and projects public data; one workspace stream delivers it to ThreadCache. Ordinary text growth carries only the changed item and its UTF-8 append offset. It must not copy, scan, redact, encode or rebuild the complete history. Missing authority or a broken sequence invalidates observation and refreshes summaries plus the required current view through the existing connection owner. Execution and user drafts survive that recovery.

# Contract

## Publication and public data

Redeven requires the released optional Floret `ThreadUpdateSource` contract at startup. It does not add required methods to `ThreadService` or fall back to complete-view subscription. Actor-native notifications carry exact thread/turn/run identity, `base_version`, `view_version`, lightweight runtime facts, and explicit item/component changes. Omitted components are unchanged; explicit nulls or empty collections clear their component. Item add, replacement, removal and ordering are explicit. Append offsets count UTF-8 bytes, not JavaScript string units.

Floret owns the existing 50 ms ordinary-growth cadence and merges changes before copying payloads. First output and semantic boundaries flush pending growth immediately. Its legacy View and Subscribe APIs adapt the same state/version/publication kernel; complete defensive snapshots are materialized only for explicit reads or actual legacy subscribers. Redeven has no full-view classifier, JSON fingerprint, historical diff or second publication cadence.

One Service pump consumes native updates. Account watches, workload leases and Computer cleanup consume lightweight authoritative facts even with no viewer. Immutable thread-to-endpoint/parent routing is cached without lifecycle or transcript state. With no authorized endpoint observer, presentation projection and encoding are skipped. Root updates retain their ThreadID; child updates are nested under their authorized parent and never create root summaries. Child lifecycle boundaries refresh the existing parent-scoped inventory.

The public DTO projector is shared by snapshots, native changes, history and command handoffs. It strips private resource authority, file-reference body text, sensitive tool arguments, secret answers and internal failure payloads. Dynamic Activity fields retain their existing renderer-specific limits and nested-field policy. Public attachment URLs remain scoped to canonical thread/turn or queue membership; their download endpoint remains the authority. Only changed data passes this boundary during ordinary streaming. Viewer read state and private Computer frames retain separate user/observer scopes. See [the adapter boundary](../ai/floret-redeven-adapter-and-projection.md).

## Wire v2 and bounded delivery

Flower schema v2 has one decoder and one update pipeline. Small envelopes are direct JSON, without Base64 or a second JSON envelope. Larger envelopes retain bounded fragments: envelope identity, zero-based fragment index/count, total bytes and Base64 payload. Fragments contain at most 32 KiB of raw bytes and frames at most 64 KiB. A logical envelope is bounded to 32 MiB. Pending frames retain the 1 MiB budget, live FIFO the 16-envelope budget, and all retained envelopes the 32 MiB global budget. Shared public batches are encoded once and reused across authorized observers; each observer owns only its cursor and private metadata.

The `ready` envelope carries the complete paginated summary baseline, followed by viewer read metadata; that initialization prefix precedes concurrent live FIFO delivery. Subscription is established before authoritative snapshots are read. Invalid or non-advancing catalog pagination fails initialization. Snapshot versions and earlier updates are discarded; every later update must match the accepted base version. No observer can block provider work. Overflow closes the affected observation instead of dropping a semantic boundary. Started envelopes are immutable; the browser validates all fragments and complete UTF-8/JSON before applying the envelope.

Missing baseline, a version gap, queue overflow or damaged fragments uses `FlowerLiveSyncError`: invalidate the connection, keep displayed content, refresh workspace summaries and the selected/open-child current view. There is no cursor replay, polling, invented event or second resynchronization machine. Service subscription failure fences connected observers, then rebinds the one native subscription and reconciles missed cleanup from authoritative summaries before admitting new observers. Browser reconnection cannot leave a permanently dead Service pump.

`LiveTransport` alone owns network retries and callback epochs. Network failures use bounded backoff. Authorization, lock, capacity, wire-version and contract failures remain visible with explicit Resync/recovery; they do not reconnect forever. A connection epoch fences callbacks only and never orders canonical content. Unknown command results retain their original request keys; a disconnect never repeats an effect automatically.

## ThreadCache and independent authorities

ThreadCache owns selection, summaries and at most 12 indexed detail records. Selection protects the current entry; background traffic never promotes cache priority. Unvisited threads retain summaries only. Navigation changes selection without reconnecting the workspace stream. Env App placements retain one Surface, adapter, cache and stream across Activity/Workbench hosts.

A detail snapshot initializes one indexed record. Native batches validate then atomically commit changed items and components through that record. Ordinary appends retain cache/view/list identity and notify only affected fields. The transcript and turn grouping change only when their structural inputs change. There is no raw-current history replica or browser lifecycle projection. Complete materialization is reserved for explicit reads, copy/export or validation boundaries.

Runtime `view_version`, product `settings_revision`, activity/read watermarks and title generation remain independent authorities. Summary updates never author cached messages, turns or interactions. Same-version context supplements and explicit clears retain their existing acceptance rules; omitted context stays unchanged. A late HTTP response cannot roll runtime content back or erase newer title/settings/read metadata. Reconnect fences old runtime versions without clearing accepted content or drafts.

A cold or invalidated detail read buffers a bounded set of native updates. Snapshot admission discards earlier versions and applies continuous successors atomically. Only explicit user retry revisits a failed detail revision. Navigation generations fence late responses without changing admission or outbox settlement. The [selection contract](flower-thread-selection.md) owns the interaction.

## Commands and interaction

Canonical cancellation plus active state owns Stopping feedback. Stop acknowledgement is not a terminal outcome; it never clears drafts or disables navigation. Unknown Stop results remain actionable through the existing read/retry owner. Send admission uses exact request and thread identities; only a canonical receipt or matching accepted input settles the transport outbox. Conflicting or malformed acknowledgements retain the original request for safe recovery.

Queued Send now uses the canonical queue ID and one Floret command, never a host Stop/Send chain. Canonical updates alone remove consumed input. Pending approvals and input requests retain exact identities and validated questions; malformed detail leaves the last view visible with Retry while draft editing, Stop and navigation remain available. See [approval/input contracts](flower-approval-context.md), [read state](flower-read-state.md) and [terminal disclosure](flower-turn-process-disclosure.md).

# Boundaries

The stream, frame queue and indexed cache are bounded observation mechanisms. They cannot decide execution outcomes, rewrite history, settle effects, persist another transcript or infer lifecycle from message content. Wire v1 is upgrade-only, not a parallel runtime implementation. Database kinds and all released migration edges remain unchanged.

# Evidence

- [Native pump and recovery](../../internal/ai/flower_runtime_update.go)
- [Projection and recovery tests](../../internal/ai/flower_runtime_update_test.go)
- [Field-level public DTOs](../../internal/ai/flower_public_dto.go)
- [Workspace baseline and bounded distribution](../../internal/ai/flower_live_stream.go)
- [Small JSON and fragmented wire tests](../../internal/ai/flower_live_fragment_test.go)
- [Strict browser decoder](../../internal/flower_ui/src/flowerLiveWire.ts)
- [Single connection owner](../../internal/flower_ui/src/liveTransport.ts)
- [Indexed detail record](../../internal/flower_ui/src/runtimeThreadRecord.ts)
- [Cache identity and acceptance regressions](../../internal/flower_ui/src/threadCache.test.ts)
- [Production CPU qualifier](../../scripts/qualify_flower_cpu.mjs)
