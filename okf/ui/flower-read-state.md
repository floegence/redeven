---
type: UI Contract
title: Flower read state
description: Keep unread indicators monotonic and acknowledge only rendered content through silent background recovery.
tags: [ui, flower, threads, read-state]
timestamp: 2026-10-19T00:00:00Z
---
# Summary

Redeven owns per-user read confirmation. Unread indicators compare current activity with server confirmation and actual local presentation. Old responses never restore a dot for an already read version; new unseen activity remains unread. Temporary synchronization failures recover silently in the background, without blocking any user operation.

# Contract

Flower read state is a Redeven-owned per-user activity watermark. The server alone persists `last_seen_activity_revision`; acknowledgements contain only the revision of an actually rendered body, and future revisions are rejected. `ThreadCache` merges activity and confirmed-read watermarks independently and monotonically across HTTP lists, details, acknowledgements and private `viewer.read_state` events. Shared summaries carry activity only. Initial connection and reconnect restore the private baseline for the authorized user without putting personal read state in shared messages. A separate loaded-content revision prevents metadata or private confirmations from qualifying stale body content as current. HTTP detail reads activity before the canonical body so a concurrent commit cannot attach a newer acknowledgement revision to older content.

One surface-lifetime read-sync owner retains the greatest presented revision per thread across selection changes. An after-paint token binds thread, selection cycle and loaded-content revision; only a foreground, visible, unobscured, successfully loaded chat can advance presentation. Scrolling to the bottom is not required. Sidebar, switcher and companion derive unread from activity exceeding both server confirmation and local presentation. Merely selecting a thread never suppresses unseen activity.

Read synchronization never blocks interaction or adds notifications or manual controls. Each thread has one logical request with a 15-second timeout and coalesces only presented revisions. Transient failures retry silently at 500ms, 1s, 2s, 5s, 10s and at most 30s with jitter. Offline pauses sending; online and the existing reconnect/access recovery resume it. Access failures pause until recovery. Late replies still merge monotonically, without enlarging the submitted presentation range or taking over newer requests. Thread deletion, runtime identity change and disposal clear pending work. No storage format or historical watermark is reset.

# Boundaries

Read confirmation belongs to Redeven product state, not Floret execution or shared lifecycle summaries. The existing database and migrations remain authoritative. [Live current state](flower-live-timeline.md) owns transport and detail loading; [Activity companion](flower-activity-companion.md) owns placement visibility. No additional read-specific interaction or transport is introduced.

# Evidence

- `redeven:internal/flower_ui/src/threadCache.ts` - Independent monotonic activity and confirmation merging, with a separate loaded-content revision.
- `redeven:internal/flower_ui/src/threadReadSync.test.ts` - Fake-clock retry, timeout, offline/access recovery, coalescing and late-callback coverage.
- `redeven:internal/flower_ui/src/FlowerSurface.visibility.test.tsx` - Exact rendered-content and visibility evidence.
- `redeven:internal/ai/flower_live_stream_test.go` - Private reconnect baselines and per-user isolation.
- `redeven:internal/ai/flower_detail_read_revision_test.go` - Concurrent activity cannot acknowledge an older body.
