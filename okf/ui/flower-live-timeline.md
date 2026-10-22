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
