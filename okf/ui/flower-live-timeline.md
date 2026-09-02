---
type: UI Contract
title: Flower live current state
description: One workspace stream, typed current views, and bounded browser caches.
tags: [ui, flower, live, threads]
timestamp: 2026-08-18T00:00:00Z
---
# Summary

Flower uses one workspace SSE for every thread. The stream carries a baseline of summaries, summary replacements, active-thread current views, open SubAgent current views, and viewer read state. Selecting a thread changes only `ThreadCache.selectedId`; it never reconnects transport or cancels background execution. A selected summary that advances beyond cached detail requests that exact revision through one per-thread coordinator without cursor replay or polling.

Env App retains one `EnvAIPage` and one `FlowerSurface` after access becomes
available. Activity companion, Activity full page, and the selected Workbench
Flower widget provide placement hosts for that same DOM tree. Moving between
hosts does not create another adapter, thread cache, list request, or workspace
stream.

# Contract

`ThreadCache` owns selected ID, summary map, and a bounded LRU of typed detail views. Summary updates are stripped of messages and interaction detail and can never overwrite a cached view. HTTP detail, state-bearing action responses, and `LiveCurrent` all use one receiver. Floret's monotonic `view_version` orders runtime content; Redeven's activity revision orders update and read metadata; Redeven's monotonic `settings_revision` orders product settings. The receiver merges those three authorities independently, so an unchanged runtime view cannot discard newer product metadata.

Flower read state is a Redeven-owned per-user activity revision watermark. Requests contain only the displayed `activity_revision`; equal or older acknowledgements are valid and cannot advance beyond current activity, while a future revision is rejected. The browser keeps one per-thread, per-selection-cycle coordinator: one request may be in flight, only the greatest newer revision remains pending, and a failed revision is not retried until a newer revision or a new genuine presentation cycle. Signature, prompt, message-time, polling, timer, and error-class retry paths do not exist.

Stop is the deliberate command-only exception. Composer and thread-menu entry
points share one per-thread request owner, show pending only while that request
is in flight, and consume only an acknowledgement. A successful request never
writes `ThreadCache`; the existing workspace stream supplies the canceled or
next-active current view. Transport failure clears pending, leaves Stop
retryable, and records diagnostics without showing a Stop error notification.
The client does not synthesize `read_status`, load detail, poll, or open another
connection to confirm cancellation.

A valid current view independently confirms any outbox entry with the same canonical request key, even when its runtime detail is unchanged or older than the cached view. Request identity proves admission; it does not order runtime content. For a New Chat send, that same confirmation settles the submitted draft, moves its scope to the canonical thread, selects the canonical thread when the original selection intent is still current, and replaces the optimistic row in one UI batch. A later navigation invalidates only the selection transfer, not admission or cache convergence. Only accepted runtime content may move the transcript, clear runtime errors, or update status presentation.

`LiveTransport` owns the single connection and a process-local `connectionEpoch`. The epoch only invalidates callbacks from the prior connection; it is not stored in `ThreadCache` and never orders detail content. Normal network failures reconnect quietly with bounded backoff; authorization failure is terminal and visible. There is no browser event log, cursor, generation graph, replay endpoint, retention-gap reducer, polling loop, or per-selection SSE.

Redeven owns one visual publication boundary for Floret current views. The first
non-empty live thinking view publishes immediately. Later text-only growth keeps
only the highest `view_version` and publishes at most once every 50 ms, giving
the browser a stable paint opportunity without rebuilding text deltas. Item,
tool, interaction, activity, failure, and terminal transitions bypass that
cadence and publish immediately. The final current is always a complete Floret
view; Flower never accumulates reasoning text or restores the retired block
delta protocol.

Floret v7.1.0 publishes the exact TurnID and RunID on every ordered current
item and interaction, including historical rows after restart. It also retains
the exact active RunID and one process-local `RunProgress` phase. Flower rejects
an incomplete or conflicting identity before detail enters `ThreadCache`; it
never assigns an empty identity or substitutes the latest run. Flower renders
the active phase only in the fixed lane above the
composer; it never inserts a transient timeline row. One RunID keeps the same
indicator, Flower, and dots DOM nodes while phase text changes, so CSS animation
time remains continuous. Only a different thread or exact RunID remounts the
indicator. Waiting for interaction and terminal views clear it. Messages and
Activity still provide transcript and collapsed-summary content, but never
decide the lifecycle phase. Redeven has no model-I/O stream, message-content
phase inference, TurnID-as-RunID fallback, polling, or second progress state.

Resolving Ask User starts a new Floret Run inside the same Turn. The runtime
first publishes the resolved interaction, then the new RunID in `preparing`,
followed by `waiting_response`, `streaming`, and `finalizing`. Reasoning and
assistant items grow under that exact RunID before terminal settlement. The
workspace stream forwards those authoritative views directly; Flower does not
poll, synthesize progress, split a terminal response into fake deltas, or keep
the prior Run's attempt identity.

Canonical Thread ownership is immutable product routing metadata. The runtime
view pump resolves `thread_id -> (endpoint_id, parent_thread_id?)` once and
reuses that binding instead of querying SQLite for every provider token. Root
current views feed the thread cache. Each child current is sent through its
parent stream as `thread.batch.subagent_current`; it never becomes a root
summary. Child lifecycle boundaries separately refresh the parent-scoped full
SubAgent inventory. The binding contains no lifecycle, message, permission,
model, or settings state and is removed with the Thread or Service.

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

The baseline list is built from one Floret root-inventory `List` projection.
Redeven does not call `View` for each row; timeline, attachment, context, and
SubAgent detail load only for the selected thread. Until the first list request
succeeds, the rail shows a loading skeleton. The empty-conversation copy is
valid only after an authoritative empty list response. A reconnecting `ready`
baseline replaces the root summary set and removes stale non-root cache entries.

`thread.batch.subagents` is a strict full replacement for one cached parent
inventory; an empty array clears it. The patch never creates a summary, changes
the selected thread, navigates to a child, or clears an open child detail.
`thread.batch.subagent_current` is independent: the envelope identifies the
parent, the nested view identifies the child, and only the exact active pair may
accept it. The top-right panel and Activity rows read the canonical inventory,
and both open the existing floating SubAgent detail window.

The open child detail is one stable browser selection containing parent and
child identity, summary snapshot, request generation, loading state, and the
highest accepted current. HTTP and SSE share its monotonic `view_version`
receiver. A reconnecting `ready` starts one deduplicated HTTP refresh for that
open child; ordinary time passage starts none. Membership refresh, late HTTP,
and unrelated parent or child frames cannot close or replace it. There is no
child detail pagination, polling, tail timer, request lock, sync message, pulse,
or bottom status lane.

Canonical terminal updates and reconnect baselines converge the current view. Background running, waiting_user, waiting_approval, and completed summaries update without pointer or focus events. One detail request may run per thread and selection cycle. Updates received during that request retain only the greatest target revision and start at most one follow-up request. A cache hit with no newer summary renders immediately and does not revalidate. A failed revision is not retried automatically in the same display cycle; without cached detail Flower leaves loading and shows an explicit retry, while an update failure with valid cached detail is non-blocking. There is no retry delay, exhausted state, foreground reload, initial-request map, or message-content completeness guess.

Context pressure and whole-thread usage remain separate projections. The context circle uses the latest request pressure, while its tooltip displays the canonical cumulative cache-hit rate supplied live and in detail snapshots by Floret v7.1.0. A committed provider-usage frame replaces the confirmed totals; a projected-request frame without totals preserves them through the single merge helper. The client never sums stream samples, and missing totals or a zero input denominator is displayed as unavailable.

Summary revision and runtime state only trigger detail loading. Product settings revisions and message content shape do not. Summary never creates, merges, or replaces timeline messages. While a terminal summary is ahead of active detail, Flower hides stale thinking and shows that the latest reply is syncing. Stop remains available while summary, detail, or an active-turn admission failure proves that a turn may still be active; an in-flight Stop request changes that control to its localized pending state without creating another lifecycle fact.

Runtime failures are classified once at the Redeven projection boundary before
summary, detail, and typed current responses reach Flower. Published Floret
v7.1.0 supplies the canonical terminal `Failure.Code`; Redeven maps that code
once for summary, detail, and live current, then removes the upstream failure
payload before serializing Flower data. Known provider, gateway, control,
canonical-authority, and unknown-effect failures use stable codes and localized
presentation; raw engine wording stays in internal diagnostics. There is no
error-text fallback. Classification never changes canonical messages, replays
an Effect, or creates a client recovery lifecycle.

Every product settings mutation advances `settings_revision` with `max(now,
previous+1)`. A settings PATCH returns the complete thread and current view in
one response. Flower shows the requested permission while that request is in
flight, then accepts or rolls back to the server-confirmed value. A mid-run
permission change applies only to later tool operations; running tools and
already-created approvals are not reconsidered.

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
- `redeven:internal/ai/flower_runtime_current_publisher.go` - Single current-view cadence and structural-boundary publisher.
- `redeven:internal/ai/flower_runtime_current_publisher_test.go` - Deterministic progressive thinking, terminal flush, stale-version, and immutable-routing coverage.
- `redeven:internal/flower_ui/src/liveTransport.ts` - Single connection and epoch fencing.
- `redeven:internal/flower_ui/src/threadCache.ts` - Summary/detail separation and bounded view cache.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Selection, current-view application, and quiet reconnect integration.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Exact item and interaction identity validation with no current-run fallback.
- `redeven:internal/flower_ui/src/flowerLiveProgress.ts` - Single truthful current-turn progress projection for expanded and companion presentation.
- `redeven:internal/flower_ui/src/flowerLiveProgress.test.ts` - Waiting, thinking, tool, output, terminal, and stopped-turn isolation coverage.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Retained Flower product placement across Activity and Workbench hosts.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx` - Workbench host registration without a second Flower instance.
- `redeven:internal/flower_ui/src/FlowerSurface.terminalConvergence.test.ts` - Single receiver and obsolete-path removal checks.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts` - One context adjunct merge rule retains canonical whole-thread usage across partial live frames.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.test.ts` - Covers cache-hit formula, unavailable data, exact 100 percent, and near-perfect rounding.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Cold-load deduplication, latest-revision coalescing, explicit failure, retry, and stale-selection coverage.
- `redeven:internal/flower_ui/src/flowerThreadTitle.ts` - Shared canonical title consumption and legacy first-message derivation.
- `redeven:internal/ai/flower_live_stream_test.go` - Complete baseline, byte-budget, oversized-frame, terminal-state, and reconnect coverage.
