---
type: UI Contract
title: Flower live current state
description: One workspace stream, typed current views, and bounded browser caches.
tags: [ui, flower, live, threads]
timestamp: 2026-08-14T00:00:00Z
---
# Summary

Flower uses one workspace SSE for every thread. The stream carries a baseline of summaries, summary replacements, active-thread current views, and viewer read state. Selecting a thread changes only `ThreadCache.selectedId`; it never reconnects transport or cancels background execution. Disconnect recovery refreshes summaries and the selected typed view without cursor replay or polling.

# Contract

`ThreadCache` owns selected ID, summary map, and a bounded LRU of typed detail views. Summary updates are stripped of messages and interaction detail and can never overwrite a cached view. Only a detail GET or `LiveCurrent` update replaces detail, and older view versions are ignored.

`LiveTransport` owns the single connection and a process-local `connectionEpoch`. Every reconnect invalidates callbacks from the prior connection. Normal network failures reconnect quietly with bounded backoff; authorization failure is terminal and visible. There is no browser event log, cursor, generation graph, replay endpoint, retention-gap reducer, polling loop, or per-selection SSE.

Canonical terminal updates and reconnect baselines converge the current view. Background running, waiting_user, waiting_approval, and completed summaries update without pointer or focus events. A missing detail may show a local loading state, but it never clears the rail or cached transcript.

Floret installs a canonical fallback title with the first accepted user message.
Automatic-title pending and failure summaries retain it, provider success
replaces it through the existing summary stream, and a host rename remains
authoritative. Flower never renders an untitled label: list and switcher rows
without a canonical title are omitted, while a legacy detail snapshot with an
empty title may derive the same whitespace-normalized, 200-rune fallback from
its first canonical user message or first attachment/reference label. The
selected header reads the latest summary title before its cached detail title,
so a provider update cannot flash empty or wait for transcript replacement.

# Evidence

- `redeven:internal/ai/flower_live_stream.go` - Workspace baseline and current-state stream.
- `redeven:internal/flower_ui/src/liveTransport.ts` - Single connection and epoch fencing.
- `redeven:internal/flower_ui/src/threadCache.ts` - Summary/detail separation and bounded view cache.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Selection, current-view application, and quiet reconnect integration.
- `redeven:internal/flower_ui/src/flowerThreadTitle.ts` - Shared canonical title consumption and legacy first-message derivation.
