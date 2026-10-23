---
type: UI Contract
title: Flower read state
description: Keep unread indicators monotonic and acknowledge only rendered content through silent background recovery.
tags: [ui, flower, threads, read-state]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Redeven owns per-user read confirmation. Unread indicators compare current activity with server confirmation and actual local presentation. Old responses never restore a dot for an already read version; new unseen activity remains unread. Temporary synchronization failures recover silently in the background, without blocking any user operation.

# Contract

Flower read state is a Redeven-owned per-user activity watermark. A separate loaded-content revision prevents metadata or private confirmations from qualifying stale body content as current.

No storage format or historical watermark is reset.

Neither a detail response nor a hidden measuring transcript qualifies as
presentation. Selection telemetry and read acknowledgement wait until the
[destination presentation boundary](flower-thread-selection.md) releases its
prepared viewport, then retain the existing visible-document and content-revision
checks.

# Boundaries

Read confirmation belongs to Redeven product state, not Floret execution or shared lifecycle summaries. The existing database and migrations remain authoritative. No additional read-specific interaction or transport is introduced.

# Evidence

- `redeven:internal/flower_ui/src/threadCache.ts` - Independent monotonic activity and confirmation merging, with a separate loaded-content revision.

- `redeven:internal/flower_ui/src/threadReadSync.test.ts` - Fake-clock retry, timeout, offline/access recovery, coalescing and late-callback coverage.

- `redeven:internal/flower_ui/src/FlowerSurface.visibility.test.tsx` - Exact rendered-content and visibility evidence.
