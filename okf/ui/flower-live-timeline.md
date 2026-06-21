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

Active cursor ownership belongs to Redeven's live projection. The projection marks at most one live assistant draft with `active_cursor` while the selected thread is running, and canceled, completed, idle, background, or merely streaming-shaped messages are not treated as active unless the projection marks them active. The visible running affordance is a localized bottom "thinking" indicator rendered after the canonical timeline entries whenever the selected thread status is `running`; it is not a timeline message and does not depend on a visible assistant block.

Thread read state is a user-scoped appserver projection over the Redeven thread snapshot. Live bootstrap returns the current `read_status`, and live `thread.patched` events returned through appserver carry the current `read_status` when thread metadata changes. A selected running thread that completes while the user keeps it selected is therefore marked read from the final snapshot by the Flower surface; background completions remain unread until selected.

# Boundaries

Flower does not sort messages, infer insertion points from timestamps, pair recent user messages with assistant drafts, or synthesize visible pending user or assistant rows. A local pending state may keep the transcript from falling back to an empty or warmup presentation while a turn launch request is in flight, and the selected running thread may show a bottom thinking indicator, but every rendered chat message must come from the current thread timeline.

Flower does not infer read snapshots from run status or timestamps. It applies `read_status` delivered by bootstrap/list/patch payloads and only persists read state for the currently selected thread.

Redeven may publish `timeline.replaced` after run start, assistant commit, stop materialization, and resync recovery. Desktop and Env App adapters both refresh the live bootstrap after thread-level stop operations, so the surface receives the same canonical timeline after a stop-only or stop+send interaction.

# Citations

[1] redeven:internal/ai/flower_live_projection.go:79 - Live bootstrap builds `timeline_messages` before returning the thread snapshot.
[2] redeven:internal/ai/flower_live_projection.go:173 - The server-side timeline builder combines persisted messages, turn anchors, and live drafts.
[3] redeven:internal/ai/flower_live_projection.go:253 - Active cursor ownership is derived from active live run state.
[4] redeven:internal/ai/flower_live_projection.go:634 - Redeven builds canonical `timeline.replaced` events from the same timeline projection.
[5] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:385 - The shared Flower live bootstrap contract exposes `timeline_messages`.
[6] redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:456 - `timeline.replaced` carries a full replacement message array.
[7] redeven:internal/flower_ui/src/flowerLiveReducer.ts:109 - Bootstrap projection uses `timeline_messages` as the thread message array.
[8] redeven:internal/flower_ui/src/flowerLiveReducer.ts:166 - Strict live message updates require the target message to already exist.
[9] redeven:internal/flower_ui/src/flowerLiveReducer.ts:262 - Missing committed messages require resync instead of local row creation.
[10] redeven:internal/flower_ui/src/flowerLiveReducer.ts:298 - `timeline.replaced` replaces the thread message array.
[11] redeven:internal/flower_ui/src/FlowerSurface.tsx:1046 - Local pending state is limited to the turn launch request.
[12] redeven:internal/flower_ui/src/FlowerSurface.tsx:1225 - Visible timeline entries are built from the selected thread snapshot.
[13] redeven:internal/flower_ui/src/FlowerSurface.tsx:1387 - The visible running indicator uses localized thinking copy rather than synthesizing a timeline message.
[14] redeven:internal/codeapp/appserver/thread_read_state.go:156 - Appserver decorates live events with user-scoped Flower read status.
[15] redeven:internal/flower_ui/src/FlowerSurface.tsx:873 - Selected-thread live events drive read persistence for unread snapshots.
[16] redeven:internal/flower_ui/src/flowerLiveReducer.ts:84 - Thread patches update the thread read status delivered by appserver.
