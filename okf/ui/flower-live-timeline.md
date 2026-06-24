---
type: UI Contract
title: Flower live timeline
description: Flower renders Redeven's canonical thread timeline from live bootstrap and timeline replacement events.
tags: [ui, flower, ai, live]
timestamp: 2026-06-19T00:00:00Z
---

Flower is a reusable chat surface over a Redeven-owned product timeline. Redeven owns thread persistence, turn anchoring, live drafts, and message ordering; Flower renders the ordered messages that Redeven projects for the selected thread.

# Mechanism

The Flower live bootstrap includes `timeline_messages` as the only ordered message source for a thread snapshot. Redeven builds those messages from persisted transcript rows, conversation turn anchors, and live assistant drafts. Turn anchors order each user message beside its assistant message, while live drafts can replace the matching assistant message before the final assistant transcript row is committed.

Live streaming uses small message updates only when the target message id is already present. If a block update, block set, activity update, or commit references a missing message, the Flower reducer asks for a resync instead of creating a local row. When the canonical ordering changes, Redeven emits `timeline.replaced`; the reducer replaces the full message array with the event payload. `message.started` is therefore a lifecycle signal, not permission for the UI to invent a row.

Subagent presentation is also derived from the canonical timeline. The parent thread records delegation tool activity through Floret `ActivityTimeline` payloads for `subagents`; child lifecycle sync refreshes that parent activity timeline from the latest Floret snapshots, so asynchronous child completion updates the parent Sub Agents dropdown without an extra UI state source. The Flower surface projects the dropdown from those payloads, merges child items by child thread id, and shows active and settled counts in the selected parent thread header. The dropdown is a header-triggered floating surface, not a page or side panel: it uses the shared Floe surface floating layer, named Flower layer tokens, an opaque popover surface, and the same running loader language as inline tool activity rows. Selecting a child never selects or navigates to the child thread; it loads parent-scoped detail through the surface adapter and opens a read-only Floe `FloatingWindow` over the current parent conversation. The detail window reuses the same timeline/message/activity renderers as the main thread, adds a bottom live status lane, tails active child detail incrementally, auto-follows only while the user is at the bottom, and exposes a scroll-to-latest affordance when the user reviews earlier output. Detail tailing continues while the child is queued, running, or waiting for input even when the current page reports `has_more=false`; terminal child status stops the tail, and transient tail errors stay in the detail dock with a longer retry interval. The detail tail and full child execution timeline are human UI state only; they are never injected into the parent model context by default. The overlay can render child user/assistant messages, tool calls, tool results, approvals, turn markers, compactions, errors, and generic custom rows from the child detail timeline. Legacy transcript-local `subagent` blocks and legacy `snapshots`, `snapshots_by_id`, or free-form `subagents` collection payloads are not part of the live timeline contract.

Active cursor ownership belongs to Redeven's live projection. The projection marks at most one live assistant draft with `active_cursor` while the selected thread is running, and canceled, completed, idle, background, or merely streaming-shaped messages are not treated as active unless the projection marks them active. The visible model status affordance is a localized bottom dock lane driven by `model_io.updated`, not by `active_cursor` or thread running status. `model_io` is derived from Floret provider lifecycle and stream observations: provider request maps to waiting for model response; assistant, reasoning, and model tool-call stream observations map to thinking; provider retry maps to retrying; provider finish maps to finalizing. The indicator is not a timeline message and does not depend on a visible assistant block. The indicator's readable text is the base rendered text; shimmer is a decorative overlay and must not be the only mechanism that makes the label visible.

Context usage and compaction state share that presentation lane and canonical projection model. Redeven stores the latest `context_usage` plus historical `context_compactions` and `timeline_decorations` in Flower live materialized state. `context.usage.updated` updates the compact context meter beside the model status. `context.compaction.updated` upserts a `context_compaction` timeline decoration keyed by `operation_id`; the UI renders it as a non-interactive divider such as compression in progress, compressed, or failed. The divider is not a transcript message and does not affect message ordering, copying, read state, or model-visible history.

Selected-thread live polling treats `model_io.updated` as a presentation boundary. Even when one live-events response contains a short provider stream followed by finalizing or clearing events, Flower commits the model status lane and yields a render frame at each model I/O boundary. This keeps brief but real provider streaming phases visible to the user without inventing timeline rows, fallback timers, or thread-status heuristics.

Thread read state is a user-scoped appserver projection over the Redeven thread snapshot. Live bootstrap returns the current `read_status`, and live `thread.patched` events returned through appserver carry the current `read_status` when thread metadata changes. A selected running thread that completes while the user keeps it selected is therefore marked read from the final snapshot by the Flower surface; background completions remain unread until selected.

# Boundaries

Flower does not sort messages, infer insertion points from timestamps, pair recent user messages with assistant drafts, or synthesize visible pending user or assistant rows. A local pending state may keep the transcript from falling back to an empty or warmup presentation while a turn launch request is in flight, and the selected thread may show a bottom model status lane while a matching active run has `model_io`, but every rendered chat message must come from the current thread timeline.

Flower does not infer read snapshots from run status or timestamps. It applies `read_status` delivered by bootstrap/list/patch payloads and only persists read state for the currently selected thread.

Flower does not parse provider request metadata, database rows, or transcript text to estimate context pressure. It renders context usage and compaction only from typed live/bootstrap fields projected by Redeven from structured Floret observations.

Flower does not synthesize Sub Agents dropdown state from audit tables, provider-adapter side effects, child assistant text, or a separate transcript block type. The parent ActivityTimeline item payload and child thread id are the summary display contract, while full child execution detail belongs to the parent-scoped subagent detail API and is never injected into the parent model context by default. Subagent detail live tailing is a UI-only read path with request identity guards; it must not become a model-facing wait result, a second chat composer, or an alternate thread navigation target. Read-only child projection threads are identified with structured `owner_kind=subagent_projection` metadata for internal projection and cleanup, but they are excluded from normal thread-list/sidebar results and must not become the main Flower navigation target.

Redeven may publish `timeline.replaced` after run start, assistant commit, stop materialization, and resync recovery. Desktop and Env App adapters both refresh the live bootstrap after thread-level stop operations, so the surface receives the same canonical timeline after a stop-only or stop+send interaction.

# Citations

[1] redeven:internal/ai/flower_live_projection.go:79 - Live bootstrap builds `timeline_messages` before returning the thread snapshot.
[2] redeven:internal/ai/flower_live_projection.go:173 - The server-side timeline builder combines persisted messages, turn anchors, and live drafts.
[3] redeven:internal/ai/flower_live_projection.go:276 - Active cursor ownership is derived from active live run state.
[4] redeven:internal/ai/flower_live_projection.go:882 - `streamEventModelIOStatus` projects into `model_io.updated`.
[5] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:385 - The shared Flower live bootstrap contract exposes `timeline_messages`.
[6] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:456 - `timeline.replaced` carries a full replacement message array.
[7] redeven:internal/flower_ui/src/flowerLiveReducer.ts:109 - Bootstrap projection uses `timeline_messages` as the thread message array.
[8] redeven:internal/flower_ui/src/flowerLiveReducer.ts:166 - Strict live message updates require the target message to already exist.
[9] redeven:internal/flower_ui/src/flowerLiveReducer.ts:262 - Missing committed messages require resync instead of local row creation.
[10] redeven:internal/flower_ui/src/flowerLiveReducer.ts:347 - `model_io.updated` is applied as thread presentation state rather than a timeline message.
[11] redeven:internal/ai/flower_live_projection.go:998 - Context usage updates live materialized state.
[12] redeven:internal/ai/flower_live_projection.go:1010 - Context compaction updates upsert timeline decorations.
[13] redeven:internal/flower_ui/src/flowerLiveReducer.ts:407 - `context.usage.updated` is applied as thread presentation state.
[14] redeven:internal/flower_ui/src/flowerLiveReducer.ts:410 - `context.compaction.updated` upserts context compactions and decorations.
[15] redeven:internal/flower_ui/src/flowerTimelineProjection.ts:140 - Context compaction decorations become timeline divider entries, not messages.
[16] redeven:internal/flower_ui/src/FlowerSurface.tsx:1046 - Local pending state is limited to the turn launch request.
[17] redeven:internal/flower_ui/src/FlowerSurface.tsx:1225 - Visible timeline entries are built from the selected thread snapshot.
[18] redeven:internal/flower_ui/src/FlowerSurface.tsx:1388 - The visible model status lane reads `model_io_status` and localized model status copy rather than synthesizing a timeline message.
[19] redeven:internal/flower_ui/src/FlowerSurface.tsx:128 - Flower recognizes `model_io.updated` as a model-status presentation boundary.
[20] redeven:internal/flower_ui/src/FlowerSurface.tsx:994 - Selected-thread live polling commits and yields at model I/O presentation boundaries.
[21] redeven:internal/codeapp/appserver/thread_read_state.go:156 - Appserver decorates live events with user-scoped Flower read status.
[22] redeven:internal/flower_ui/src/FlowerSurface.tsx:873 - Selected-thread live events drive read persistence for unread snapshots.
[23] redeven:internal/flower_ui/src/flowerLiveReducer.ts:84 - Thread patches update the thread read status delivered by appserver.
[24] redeven:internal/flower_ui/src/flowerSubagentProjection.ts:228 - Subagent dropdown entries are projected from parent activity timeline items.
[25] redeven:internal/flower_ui/src/flowerSubagentProjection.ts:143 - The projection accepts only the current subagent envelope shapes.
[26] redeven:internal/flower_ui/src/FlowerSurface.tsx:1555 - Opening a subagent loads parent-scoped detail without selecting the child thread.
[27] redeven:internal/flower_ui/src/FlowerSurface.tsx:3340 - The selected parent thread header renders the Sub Agents dropdown.
[28] redeven:internal/flower_ui/src/FlowerSurface.tsx:3420 - Subagent execution detail renders in a floating overlay on the parent thread.
[29] redeven:internal/flower_ui/src/FlowerSurface.tsx:1844 - Active subagent detail tailing is limited to queued/running/waiting-input states.
[30] redeven:internal/flower_ui/src/FlowerSurface.tsx:1923 - Detail tail errors use a longer retry interval and remain scoped to the detail dock.
[31] redeven:internal/ai/threadstore/store.go:357 - Normal thread-list queries exclude `subagent_projection` rows.
[32] redeven:internal/codeapp/appserver/server.go:3737 - Appserver exposes the parent-scoped subagent detail route.
