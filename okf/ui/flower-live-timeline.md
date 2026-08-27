---
type: UI Contract
title: Flower live current state
description: One workspace stream, typed current views, and bounded browser caches.
tags: [ui, flower, live, threads]
timestamp: 2026-08-18T00:00:00Z
---
# Summary

Flower uses one workspace SSE for every thread. The stream carries a baseline of summaries, summary replacements, active-thread current views, and viewer read state. Selecting a thread changes only `ThreadCache.selectedId`; it never reconnects transport or cancels background execution. A selected summary that advances beyond cached detail starts bounded detail revalidation without cursor replay or polling.

Env App retains one `EnvAIPage` and one `FlowerSurface` after access becomes
available. Activity companion, Activity full page, and the selected Workbench
Flower widget provide placement hosts for that same DOM tree. Moving between
hosts does not create another adapter, thread cache, list request, or workspace
stream.

# Contract

`ThreadCache` owns selected ID, summary map, and a bounded LRU of typed detail views. Summary updates are stripped of messages and interaction detail and can never overwrite a cached view. HTTP detail, action responses, and `LiveCurrent` all use one receiver. Floret's monotonic `view_version` orders runtime content; Redeven's activity revision orders update and read metadata; Redeven's monotonic `settings_revision` orders product settings. The receiver merges those three authorities independently, so an unchanged runtime view cannot discard newer product metadata.

A valid current view independently confirms any outbox entry with the same canonical request key, even when its runtime detail is unchanged or older than the cached view. Request identity proves admission; it does not order runtime content. For a New Chat send, that same confirmation settles the submitted draft, moves its scope to the canonical thread, selects the canonical thread when the original selection intent is still current, and replaces the optimistic row in one UI batch. A later navigation invalidates only the selection transfer, not admission or cache convergence. Only accepted runtime content may move the transcript, clear runtime errors, or update status presentation.

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

The baseline list is built from one Floret root-inventory `List` projection.
Redeven does not call `View` for each row; timeline, attachment, context, and
SubAgent detail load only for the selected thread. Until the first list request
succeeds, the rail shows a loading skeleton. The empty-conversation copy is
valid only after an authoritative empty list response.

Canonical terminal updates and reconnect baselines converge the current view. Background running, waiting_user, waiting_approval, and completed summaries update without pointer or focus events. When a selected summary is ahead, Flower issues a fresh detail request instead of reusing an older in-flight request. One recovery request runs per thread, tracks newer summary targets, and uses finite 100/300/900 ms retries for transient failure. Recovery succeeds when the summary/detail invariant is satisfied, including when only newer activity metadata was accepted or an unchanged response proves the cache is already current. Only a remaining mismatch or request failure advances the retry budget. Exhaustion preserves cached content and exposes an explicit retry action.

Context pressure and whole-thread usage remain separate projections. The context circle uses the latest request pressure, while its tooltip displays the canonical cumulative cache-hit rate supplied by Floret v5.0.5. A live context frame may omit cumulative totals; the single merge helper then retains the last confirmed totals instead of clearing them. The client never sums stream samples, and a zero input denominator is displayed as unavailable.

Summary runtime state only triggers revalidation. Product settings revisions do not enter that signature and cannot start runtime recovery. Exhausted finite recovery remains stopped until a newer runtime signature or an explicit user reload arrives. Summary never creates, merges, or replaces timeline messages. While a terminal summary is ahead of active detail, Flower hides stale thinking and shows that the latest reply is syncing. Stop remains available while summary, detail, an active-turn admission failure, or an in-flight Stop request proves that a turn may still be active.

Runtime failures are classified once at the Redeven projection boundary before
summary, detail, and typed current responses reach Flower. Published Floret
v5.0.7 supplies the canonical terminal `Failure.Code`; Redeven maps that code
once and removes the upstream failure payload before serializing Flower data.
Only historical failures without the typed field use the legacy text
classifier. Known provider, gateway, control, and canonical-authority failures
use stable codes and localized presentation; raw engine wording stays in
internal diagnostics.
Classification never changes canonical messages, retries an Effect, or creates
a client recovery lifecycle.

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
- `redeven:internal/flower_ui/src/liveTransport.ts` - Single connection and epoch fencing.
- `redeven:internal/flower_ui/src/threadCache.ts` - Summary/detail separation and bounded view cache.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Selection, current-view application, and quiet reconnect integration.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Retained Flower product placement across Activity and Workbench hosts.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx` - Workbench host registration without a second Flower instance.
- `redeven:internal/flower_ui/src/FlowerSurface.terminalConvergence.test.ts` - Single receiver and obsolete-path removal checks.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts` - One context adjunct merge rule retains canonical whole-thread usage across partial live frames.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.test.ts` - Covers cache-hit formula, unavailable data, exact 100 percent, and near-perfect rounding.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.finalArchitecture.browser.test.tsx` - Terminal loss, stale request, bounded retry, and first-load fixtures.
- `redeven:internal/flower_ui/src/flowerThreadTitle.ts` - Shared canonical title consumption and legacy first-message derivation.
- `redeven:internal/ai/flower_live_stream_test.go` - Complete baseline, byte-budget, oversized-frame, terminal-state, and reconnect coverage.
