---
type: UI Contract
title: Flower read state
tags: [ui, flower, threads, read-state]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven confirms reads per user from server version and actual local presentation. Old responses cannot restore already-cleared indicators; unseen activity stays unread. Temporary sync failures recover in background without blocking operations or inventing acknowledgements.

# Contract

Flower read state is a Redeven-owned per-user activity watermark. A separate loaded-content revision prevents metadata or private confirmations from qualifying stale body content as current.

No storage format or historical watermark is reset.

Neither a detail response nor a hidden measuring transcript qualifies as
presentation. Selection telemetry and read acknowledgement wait until the
[destination presentation boundary](flower-thread-selection.md) releases its
prepared viewport, then retain the existing visible-document and content-revision
checks.

Foreground visibility is an input, not a second asynchronous readiness lifecycle.
The selected detail loader and destination presentation boundary own readiness;
returning to the foreground only requests their existing coalesced refresh.
Navigation, reselect, canceled reads and failed refreshes must not strand a
surface-wide readiness flag or prevent another presented thread from confirming
its content revision. Hidden, covered, loading and failed content remains
unacknowledged through the presentation checks themselves.

This boundary adds no polling, detail payload, list refresh, or backend storage.
Acknowledgements retain one in-flight request per thread, monotonic confirmation
and the existing retry policy. Repeated presentation of the same confirmed
revision sends no additional acknowledgement.

# Boundaries

Read confirmation belongs to Redeven product state, not Floret execution or shared lifecycle summaries. The existing database and migrations remain authoritative. No additional read-specific interaction or transport is introduced.

# Evidence

- [Visibility regressions](../../internal/flower_ui/src/FlowerSurface.visibility.test.tsx)
  and [browser regressions](../../internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx)
  cover foreground/reselect/cache/cold-navigation races, late and failed refreshes,
  visible unread indicators and bounded read/acknowledgement counts.

- `redeven:internal/flower_ui/src/threadCache.ts` - Source.
- `redeven:internal/flower_ui/src/threadReadSync.test.ts` - Tests.
