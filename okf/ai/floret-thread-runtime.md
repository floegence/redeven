---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Typed Floret v7 thread runtime ownership and Redeven product boundaries.
tags: [ai, floret, threads, runtime]
timestamp: 2026-10-07T00:00:00Z
quality_exception: Typed Floret ThreadService lifecycle and restart contract covering canonical journal ownership, idempotent effects, and migration safety.
---
# Summary

Floret v7 `ThreadService` is the sole owner of active and canonical thread lifecycle. Redeven owns endpoint authorization, attachment resource resolution, provider and tool effects, and browser-safe mapping. Every existing-thread mutation proves that the ThreadID belongs to the authenticated endpoint before entering Floret. Send, Respond, Cancel, and Retry return the current typed view without waiting for provider continuation. Canonical journal facts prevent duplicate user, assistant, tool, and interaction records; transient drafts and execution tokens remain in memory.

# Contract

## Typed runtime

Redeven consumes published Floret v7.18.4, preserving graceful-stop ownership
when a projection write is canceled. The stop owner settles pending approvals,
tool results, and the terminal together; a canceled write must not enter competing
failure finalization. Genuine storage and unknown-effect failures retain their
existing classification. The dependency gate requires the released dynamic tool surface
and preservation of its initial provider surface; live permission ownership is
defined in [Tool permission runtime](tool-permission-runtime.md).

Published Floret v7.16.2 retains every ordinary/control call in a mixed model
response and pairs each with its result in provider order. Valid ordinary tools
execute once; mixed controls receive bounded correction to submit separately
after the ordinary results. Only a later valid independent control opens an
interaction. Correction feedback is hidden only from presentation, never from
canonical model history. Floret owns identical live and final persistence and
resumes native reasoning/search state from the exact waiting run after Respond
or restart. Strict DeepSeek history checks remain enabled; Redeven does not
clear provider state, reconstruct history, or retry uncertain effects.
Redeven derives continuation support from the restored request protocol, not
from newly edited settings; a pending native-search Turn keeps its frozen
Responses transport across restart. No second capability cache is retained.

Published Floret v7.14.0 applies sanitized tool Activity inside the existing
thread actor using exact thread, turn, run, and tool-call identity. Validated
calls publish description and command while pending; dispatch alone marks
running, and results settle without waiting for output or the full turn.
Canonical loading cannot overwrite newer live tool facts during execution.
Redeven consumes the same current view for HTTP and workspace subscriptions;
it does not cache raw tool arguments or own another tool lifecycle. Pagination
row identifiers are untrusted 64-bit values: Redeven bounds them against the
current item count before narrowing to an index, including exhausted and
negative cursor inputs.

Ask User presentation preserves optional headers, placeholders, declared choice
exhaustiveness, and rich choices across live views, summaries, restart, and
history. Each rich choice retains its original identifier and established answer
value. Redeven maps the explicit mode and submits that value; old string-only
options remain valid. The existing control-signal projection owns these facts,
without new tables or host journal access. [Decision presentation](../ui/flower-approval-context.md)
owns layout and semantic copy. Prompt guidance requests concise, non-duplicated
content in the user's language. Choice labels stay concise; examples, supporting
context, and real differences belong in the optional description field, which is
omitted when a choice is already self-explanatory. The prompt forbids invented
details and repeated labels; the UI renders the supplied fields without
splitting or rewriting model text.

A completed tool may request non-secret input through published
`tools.Result.InputRequired`. Floret settles the batch and persists the input
interaction before another provider request. Redeven uses this for Computer Use
safety pauses; [the takeover contract](computer-use-takeover.md) owns host control
and re-observation requirements. Restart preserves the same wait and never
replays its completed tool. Version 12 appends the upstream-owned migration for
this contract; Redeven does not inspect or migrate Floret storage.

The published gateway boundary preserves overflow classification for both
direct errors and streamed errors. HTTP 413 retains safe transport diagnostics
and enters Floret's existing bounded context compaction; Redeven must not start
a new thread, resize screenshots, or replay completed tools to recover. The
production Service regression uses the model catalog and full tool registry,
forces accumulated image output to overflow with both short and long preceding
observations, and verifies exact action counts. Floret overflow recovery retains
the latest complete interaction plus protected user anchors, rather than using
a text-only tail budget to bound image transport. Ordinary compaction policy
and the single provider retry remain unchanged.

One `ThreadRuntime` plus mutex owns each active thread. Provider and tool I/O run outside that mutex and return through a stable execution token; late results for a replaced, canceled, or terminal token are ignored. The public boundary is typed `Create`, `Fork`, `Delete`, `View`, `Send`, `Respond`, `Cancel`, `Retry`, queue mutation, and workspace `Subscribe`. There is no public generic command receipt, event replay cursor, execution handle, or projection delta.

`Send` validates a stable `(thread_id, request_key)` and completes canonical turn acceptance before returning or publishing the user segment. Acceptance failure leaves the in-memory view unchanged; provider work starts asynchronously only after the accepted receipt. The canonical journal is the only durable lifecycle fact source. Unique request, turn, tool-call, effect-attempt, and terminal keys make repeated provider dispatch safe without duplicating the visible timeline. Irreversible effects alone require a minimal durable intent before dispatch. If an effect outcome cannot be confirmed, Floret atomically closes the Turn with `effect_outcome_unknown`; it never replays or exposes that effect for retry.

Transport retries read the original admitted input through Floret's published
`ThreadSendReader.LookupSend`. Redeven checks submitted text, ordered upload
identities, references, and submitted context before acknowledging a replay.
Conflicting content is rejected even when the first request is still being
admitted. Runtime context is not refreshed and claimed uploads are not resolved
again. Queue edits, promotion, removal, and restart preserve the original send
identity; replaying a removed input never re-enqueues it. The canonical journal
remains the only durable source for this comparison.

Pending text can be edited through `PATCH /_redeven_proxy/api/ai/threads/:id/queue/:queueID`.
The request carries `client_request_id`, `expected_text` and `text`; authorization
precedes Floret's optional `ThreadQueueController.EditQueued`. A stale or already
admitted item returns HTTP 409, without reconstructing attachments or context.
`POST .../queue/:queueID/send-now` calls `SendQueuedNow`: it gracefully ends the
current response and starts that chosen input in a new turn, preserving confirmed
work and unknown-effect boundaries. This is explicit stop-and-send, not injection
into a current provider request. Existing idle-only `promote` semantics remain.
The runtime owns the bounded transition after Stop acceptance; a lost client
connection cannot cancel it. A Host shutdown leaves unadmitted messages queued.

Queue admission and mutation, `Respond`, and `Cancel` commit their minimum
canonical fact before publishing success. `Respond` resolves the exact pending
interaction, including one atomic Answers batch for Reject All. `Cancel` is
idempotent for every known thread and atomically clears pending interactions,
closes unfinished tool work, and writes one terminal aborted turn before
returning. Late provider, tool, or save-point work cannot reactivate a terminal
turn. Published Floret v7.23.0 retries a failed turn from its latest existing
save point so confirmed tool results remain in provider context across repeated
failures and restart. Thread-level queue facts may interleave a pending question
without corrupting its canonical turn. `Retry` preserves logical request lineage without appending another user
message. Delete and shutdown fence new effect work, cancel and join the active
subtree, and prevent late output from outranking a tombstone. Graceful Host
shutdown resolves approvals owned by cancelled in-memory executions, so stale
approvals cannot resume them after restart. Durable Ask User waits and queued
inputs survive; dispatched effects with unknown outcomes remain failed and are
never replayed. Floret v7.25.2 reuses an existing cancellation for the exact
Turn/Run when Stop overlaps shutdown or another settlement path, preserving
the original stop source, mode, and timestamp without a duplicate cancel fact.
Floret owns this atomic settlement.

Restart hydration restores accepted input, queue items, unresolved interactions,
logical retry input, and canonical outputs, then resumes provider-safe work
from the last canonical boundary. Before the Host becomes available, every
legacy dispatching, retrying, or unknown effect is closed in one terminal failed
Turn. Floret owns the permanent domain migration lineage from v2 through v12.
Version 6 stores the manifest, root index, threads, entries, artifacts, and
supporting records separately, so one child admission writes only affected
records. Version 7 restores RunID, converges unknown effects, and drops
verified terminal fork effect authority. Version 8 classifies Engine
continuations. Version 9 makes the context entry the only persisted execution
identity and repairs only ancestor-proven fork copies.
Each migration is atomic; normal execution has no old-format dual-read path.

Child agents are ordinary child threads with parent identity and independent runtime ownership. No product-owned SubAgent lifecycle, recovery handle, or publication state may become a second authority.

The Subagent tool maps each mutation once. `spawn` uses the task name supplied
to Floret as the canonical child title, persists host authority, and returns the
typed `Send` view immediately after admission. `send_input`, `close`, and
`close_all` resolve ownership before the effect and build their result from the
returned view plus known request metadata. None performs a post-effect `List`,
`View`, title mutation, or parent summary refresh. Read-only list, inspect, and
wait operations use the parent-scoped summary inventory; wait timeout is a
normal typed result and does not fail the parent turn.

The first accepted canonical user message and its fallback title commit in the
same Floret boundary. Pending or failed automatic-title work keeps that
fallback; provider success or an explicit host rename is the only replacement.
Fallback title truncation remains whitespace-normalized and trim-stable at the
canonical length boundary, so a long first message cannot invalidate otherwise
healthy session-tree authority.
Redeven sends Floret's tool-free `thread_title` provider request through the
run lifetime admission without requiring the main turn's canonical permission
owner, because the title request cannot dispatch tools. Ordinary provider
requests, including any request with tool definitions, still require the
canonical permission snapshot before model dispatch.


Redeven-specific authorization, DTO mapping, live projection, and adapter ownership are specified in [Floret Redeven adapter and projection](floret-redeven-adapter-and-projection.md).
# Boundaries

Redeven never imports Floret internals, reads Floret storage, copies canonical lifecycle into product SQL, or uses sibling source wiring in formal validation. Product migrations may import retired queued inputs once into the typed runtime and then delete their staging rows.

# Evidence

- `redeven:go.mod` - Pins the released Floret v7.1.4 typed runtime without local replacement.
- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces exact published-v7 adoption and rejects retired imports.
- `redeven:internal/ai/floret_runtime.go` - Published runtime composition.
- `redeven:internal/ai/floret_store_maintenance.go` - One bounded pre-open SQLite maintenance policy and sanitized diagnostics.
- `redeven:internal/ai/floret_thread_context.go` - Canonical compaction mapping and timeline anchoring.
- `redeven:internal/ai/send_user_turn.go` - Thin product send mapping into typed Floret state.
- `redeven:internal/ai/activity_file_actions.go` - Shared public Activity sanitizer for all projection paths.
- `redeven:internal/ai/activity_timeline.go` - Applies Activity sanitization to typed timeline blocks.
- `redeven:internal/ai/threads.go` - Summary-only root inventory mapping and the single endpoint/thread ownership boundary before canonical mutation.
- `redeven:internal/ai/subagents_floret.go` - Single Subagent mutation/read adapter and parent-scoped summary inventory projection.
- `redeven:internal/ai/flower_runtime_current_routing.go` - Persisted root-versus-child live routing.
- `redeven:internal/ai/execution_authority.go` - Current submitting-user authority capture for restart recovery.
- `redeven:internal/ai/threadstore/execution_authority.go` - Minimal host authorization facts for restart redispatch.
- `redeven:internal/ai/execution_authority_continuity_test.go` - Retry and SubAgent authority continuity across accepted turns and restart.
- `redeven:internal/ai/stop_thread.go` - Idempotent typed cancellation without handler lookup.
- `redeven:internal/ai/send_user_turn_flow_test.go` - Covers typed canonical send and queue behavior through the published runtime.
- `redeven:internal/ai/prompt_builder.go` - Owns Ask User wording and the label-versus-description instruction.
- `redeven:internal/ai/floret_ask_user_integration_test.go` - Verifies choice copy guidance reaches the provider and covers frozen waiting-turn settings, non-blocking interaction settlement, continuation progress, and natural completion.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Latest-selection generation fence before detail cache mutation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Deterministic out-of-order A to B to A navigation coverage.

- `redeven:internal/ai/computer_takeover_integration_test.go` - Resolved control-response replay avoids repeat observations across restart.
