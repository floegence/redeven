---
type: UI Contract
title: UI presentation transactions
description: Heavy selection changes present visual intent first, commit content after paint, and defer layout effects until content presentation.
tags: [ui, interaction, performance, keep-alive]
timestamp: 2026-07-14T00:00:00Z
---
# Summary

Redeven prioritizes visible input acknowledgement over the secondary work caused by a selection change. A heavy navigation event is one presentation transaction with three ordered stages: the lightweight selected control is updated synchronously, target content visibility is committed after that intent can paint, and visibility-dependent focus, resize, scroll restoration, viewport movement, or measurement runs only after the target content can paint. This ordering applies to Activity navigation, Activity/Workbench mode, terminal sessions, Workbench widgets, Flower and Codex threads, Files/Git modes, and heavy Settings, Plugin Center, or Debug Console panels.

# Contract

## Mechanism

The published floe-webapp controller exposes separate visual and committed values. User pointer, click, and keyboard paths call `request()` so visual state changes immediately and only the latest sequence reaches commit. Terminal may call `preview()` on pointer down before click and resets obsolete previews. Initialization, persisted restoration, permission correction, automatic open, and connection recovery use the synchronous canonical path such as `commitNow()` because they are not waiting to acknowledge a user input. External canonical state changes cancel an older pending transaction and synchronize the visual target. Cleanup cancels scheduled work so a disposed owner cannot commit later.

The standard event sequence is `requested`, `intent_presented`, `commit_started`, `committed`, and `content_presented`. `cancelled` terminates a transaction that loses ownership or is disposed. A monotonically increasing transaction or request identity suppresses stale commits: rapid input may update visual state more than once, but only the newest target may mount a cold feature, fetch thread detail, restore focus, resize a terminal, move the Workbench viewport, or publish content presentation. Persistence follows the committed state and runs once; a preview is never persisted as canonical state.

Keep-alive and UI-first scheduling are complementary. Once a surface, provider, terminal core, transcript, or heavy panel has been visited, ordinary navigation keeps its DOM and runtime identity alive while changing visibility. Hidden surfaces continue receiving terminal output, monitor updates, thread events, provider state, drafts, subscriptions, and other data flow. Navigation must not trigger cleanup, suspend, hibernate, refetch, history replay, provider initialization, or resource degradation. A legitimate first lazy visit may show loading inside the target feature, but the selected navigation control still presents first and the loading state must not cover the ActivityBar or replace the previous warm transcript during staged thread loading.

Resource collections follow the same stable-presentation rule. A first Codespaces or Web Services request may show a card-shaped skeleton only after a 150 ms quiet period, using the collection surface rather than a contrasting blocking curtain. Once a collection has resolved, background refresh keeps the rendered cards or empty state, filters, and local scroll position mounted until the replacement snapshot is ready; only the initiating refresh control and accessibility status report the in-flight work. Operations that genuinely block the surface, such as resolving and opening a Web Service route, retain their dedicated blocking presentation.

Activity uses the Shell UI-first mode and after-paint `ActivityAppsMain` activation. Activity and Workbench are also two kept-alive views with after-paint activation. Files and Git mount on first visit and retain path, filters, selection, view mode, expanded state, and scroll. Terminal warm cores become visible without replay or reconstruction; focus and resize follow content presentation. Workbench widget selection updates the selected boundary before z-order persistence, viewport motion, fit, focus, and measurement. Flower and Codex keep an old transcript visible while a cold target loads and atomically replace it only when the latest target is ready.

Debug Console subscribes to the product presentation event stream and groups samples by `surface + source`. It records intent-paint, commit, and content-paint p50, p95, and maximum values. Intent paint targets p95 at or below 16.7 ms, with a hard acceptance ceiling of 32 ms. A user interaction must not produce a 50 ms or longer renderer task or frame gap. Warm content presentation targets p95 at or below 50 ms and maximum at or below 100 ms. First lazy visits retain the 32 ms visual-feedback ceiling even when target-local loading takes longer. Debug instrumentation reports a slow presentation when intent reaches 32 ms or content reaches 100 ms; performance gates and browser tests provide the stricter distribution and long-task assertions.

# Boundaries

UI-first scheduling is not permission to duplicate canonical state or create a second business model. Visual state is presentation-only, committed state remains the source for persistence and business effects, and external canonical corrections win. The transaction layer does not change backend protocols, persistent schemas, permission semantics, terminal transport, thread ordering, or provider ownership.

Not every interaction should wait one frame. A control that only changes lightweight local presentation should remain synchronous. The transaction contract is required when one input would otherwise couple selected feedback to heavy DOM visibility, lazy mount, RPC or history work, focus, resize, scroll, viewport animation, layout measurement, or persistence.

Keep-alive does not mean eagerly loading every feature. Initial resources still exclude heavy feature modules and styles, and an unvisited surface remains lazy. After first activation, however, ordinary navigation cannot convert that surface back into an unloaded state merely to reduce background work. Explicit environment replacement, permission-root replacement, connection recovery, resource-pressure policy already owned by the relevant subsystem, and user-requested closure may establish separate lifecycle boundaries; a navigation click alone may not.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:2405` - Activity/Workbench display mode uses a shared UI-first selection controller.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx:1423` - Terminal selection separates visual state, committed session state, and deferred focus.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.tsx:3246` - Files and Git retain mounted panels after first activation.
- `redeven:internal/envapp/ui_src/src/ui/services/uiPresentationTransactions.ts:32` - Redeven records the standard upstream transaction phases with surface, source, and target identity.
- `redeven:internal/envapp/ui_src/src/ui/debugConsole/createUIPerformanceTracker.ts:380` - Debug Console aggregates presentation samples by transaction identity and phase.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:2568` - Flower distinguishes warm atomic display from cold staged thread loading.
- `redeven:internal/envapp/ui_src/src/ui/codex/threadController.ts:179` - Codex keeps distinct selected, foreground, displayed, loading, cache, and transaction state.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:942` - Activity tests preserve Files DOM identity and state across Terminal, Monitor, Flower, and Codex round trips.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.browser.test.tsx:875` - Ten warm terminal cores switch without reconstruction or history replay.
- `redeven:internal/envapp/ui_src/src/ui/debugConsole/createUIPerformanceTracker.test.ts:31` - Tests cover all transaction phases and percentile aggregation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx:1575` - Codespaces separates delayed initial collection loading from stable background refresh rendering.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx:786` - Web Services keeps resolved cards or its empty state mounted while a replacement snapshot loads.
