---
type: UI Contract
title: Flower live current state
description: One workspace stream, typed current views, and bounded browser caches.
tags: [ui, flower, live, threads]
timestamp: 2026-08-18T00:00:00Z
---
# Summary

Flower uses one workspace SSE for every thread. The stream carries a baseline of summaries, summary replacements, active-thread current views, and viewer read state. Selecting a thread changes only `ThreadCache.selectedId`; it never reconnects transport or cancels background execution. A selected summary that advances beyond cached detail starts bounded detail revalidation without cursor replay or polling.

# Contract

`ThreadCache` owns selected ID, summary map, and a bounded LRU of typed detail views. Summary updates are stripped of messages and interaction detail and can never overwrite a cached view. HTTP detail, action responses, and `LiveCurrent` all use one receiver. Floret's monotonic `view_version` is the only detail ordering authority; accepted, unchanged, and stale results have one shared side-effect boundary.

`LiveTransport` owns the single connection and a process-local `connectionEpoch`. The epoch only invalidates callbacks from the prior connection; it is not stored in `ThreadCache` and never orders detail content. Normal network failures reconnect quietly with bounded backoff; authorization failure is terminal and visible. There is no browser event log, cursor, generation graph, replay endpoint, retention-gap reducer, polling loop, or per-selection SSE.

The server never silently drops an authoritative frame. An initial baseline
paginates the complete workspace summary inventory and includes current views
for active and waiting threads, even when the inventory exceeds one catalog
page or the ordinary live-frame count. A missing, repeated, or non-advancing
page cursor fails the subscription before `ready`. If one subscriber exceeds
its byte budget, or one encoded frame is itself oversized, the server closes
that subscriber. The client treats the disconnect as loss of cache authority
and reconnects; the new baseline restores summaries and the selected current
view. This fail-fast resynchronization contract avoids a second replay protocol
while ensuring a lost terminal update cannot leave the UI permanently running
or waiting.

Canonical terminal updates and reconnect baselines converge the current view. Background running, waiting_user, waiting_approval, and completed summaries update without pointer or focus events. When a selected summary is ahead, Flower issues a fresh detail request instead of reusing an older in-flight request. One recovery request runs per thread, tracks newer summary targets, and uses finite 100/300/900 ms retries for transient failure. Exhaustion preserves cached content and exposes an explicit retry action.

Summary state only triggers revalidation. It never creates, merges, or replaces timeline messages. While a terminal summary is ahead of active detail, Flower hides stale thinking and shows that the latest reply is syncing. Stop remains available while summary, detail, an active-turn admission failure, or an in-flight Stop request proves that a turn may still be active. The next accepted detail replaces the timeline atomically. Stale or unchanged detail cannot confirm the outbox, move the transcript, clear an error, mark content read, or update status presentation.

Floret installs a canonical fallback title with the first accepted user message.
Automatic-title pending and failure summaries retain it, provider success
replaces it through the existing summary stream, and a host rename remains
authoritative. Flower never renders an untitled label: list and switcher rows
without a canonical title are omitted, while a legacy detail snapshot with an
empty title may derive the same whitespace-normalized, 200-rune fallback from
its first canonical user message or first attachment/reference label. The
selected header reads the latest summary title before its cached detail title,
so a provider update cannot flash empty or wait for transcript replacement.

# Boundaries

`LiveTransport` and `ThreadCache` are bounded observation state, not a durable event log or lifecycle mirror. A disconnect, byte-budget closure, or stale version discards local authority and triggers baseline refresh; the browser cannot replay, settle, reorder, or synthesize canonical thread state.

# Evidence

- `redeven:internal/ai/flower_live_stream.go` - Workspace baseline and current-state stream.
- `redeven:internal/flower_ui/src/liveTransport.ts` - Single connection and epoch fencing.
- `redeven:internal/flower_ui/src/threadCache.ts` - Summary/detail separation and bounded view cache.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Selection, current-view application, and quiet reconnect integration.
- `redeven:internal/flower_ui/src/FlowerSurface.terminalConvergence.test.ts` - Single receiver and obsolete-path removal checks.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx` - Terminal loss, stale request, bounded retry, and first-load fixtures.
- `redeven:internal/flower_ui/src/flowerThreadTitle.ts` - Shared canonical title consumption and legacy first-message derivation.
- `redeven:internal/ai/flower_live_stream_test.go` - Complete baseline, byte-budget, oversized-frame, terminal-state, and reconnect coverage.
