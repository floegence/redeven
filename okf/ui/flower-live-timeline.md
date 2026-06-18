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

The cursor belongs to Redeven's live projection. A message renders a streaming cursor only when the selected thread is running, the message is an assistant message, and `active_cursor` is true. Canceled, completed, idle, background, or merely streaming-shaped messages do not get a cursor unless the live projection marks them active.

# Boundaries

Flower does not sort messages, infer insertion points from timestamps, pair recent user messages with assistant drafts, or synthesize visible pending user or assistant rows. A local pending state may keep the transcript from falling back to an empty or warmup presentation while a turn launch request is in flight, but every rendered chat message must come from the current thread timeline.

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
[13] redeven:internal/flower_ui/src/FlowerSurface.tsx:2308 - Cursor rendering is gated by selected running thread state and `active_cursor`.
