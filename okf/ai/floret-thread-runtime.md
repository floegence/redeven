---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Typed Floret v7 thread runtime ownership and Redeven product boundaries.
tags: [ai, floret, threads, runtime]
timestamp: 2026-09-10T00:00:00Z
quality_exception: Cross-boundary ownership contract covering the one typed ThreadService lifecycle, restart safety, product mapping, and live projection invariants.
---
# Summary

Floret v7 `ThreadService` is the sole owner of active and canonical thread lifecycle. Redeven owns endpoint authorization, attachment resource resolution, provider and tool effects, and browser-safe mapping. Every existing-thread mutation proves that the ThreadID belongs to the authenticated endpoint before entering Floret. Send, Respond, Cancel, and Retry return the current typed view without waiting for provider continuation. Canonical journal facts prevent duplicate user, assistant, tool, and interaction records; transient drafts and execution tokens remain in memory.

# Contract

## Typed runtime

Published Floret v7.10.2 applies sanitized tool Activity inside the existing
thread actor using exact thread, turn, run, and tool-call identity. Validated
calls publish description and command while pending; dispatch alone marks
running, and results settle without waiting for output or the full turn.
Canonical loading cannot overwrite newer live tool facts during execution.
Redeven consumes the same current view for HTTP and workspace subscriptions;
it does not cache raw tool arguments or own another tool lifecycle.

One `ThreadRuntime` plus mutex owns each active thread. Provider and tool I/O run outside that mutex and return through a stable execution token; late results for a replaced, canceled, or terminal token are ignored. The public boundary is typed `Create`, `Fork`, `Delete`, `View`, `Send`, `Respond`, `Cancel`, `Retry`, queue mutation, and workspace `Subscribe`. There is no public generic command receipt, event replay cursor, execution handle, or projection delta.

`Send` validates a stable `(thread_id, request_key)` and completes canonical turn acceptance before returning or publishing the user segment. Acceptance failure leaves the in-memory view unchanged; provider work starts asynchronously only after the accepted receipt. The canonical journal is the only durable lifecycle fact source. Unique request, turn, tool-call, effect-attempt, and terminal keys make repeated provider dispatch safe without duplicating the visible timeline. Irreversible effects alone require a minimal durable intent before dispatch. If an effect outcome cannot be confirmed, Floret atomically closes the Turn with `effect_outcome_unknown`; it never replays or exposes that effect for retry.

Queue admission and mutation, `Respond`, and `Cancel` commit their minimum
canonical fact before publishing success. `Respond` resolves the exact pending
interaction, including one atomic Answers batch for Reject All. `Cancel` is
idempotent for every known thread and atomically clears pending interactions,
closes unfinished tool work, and writes one terminal aborted turn before
returning. Late provider, tool, or save-point work cannot reactivate a terminal
turn. `Retry` preserves logical request lineage without appending another user
message. Delete and shutdown fence new effect work, cancel and join the active
subtree, and prevent late output from outranking a tombstone.

Restart hydration restores accepted input, queue items, unresolved interactions,
logical retry input, and canonical outputs, then resumes provider-safe work
from the last canonical boundary. Before the Host becomes available, every
legacy dispatching, retrying, or unknown effect is closed in one terminal failed
Turn. Floret owns the permanent domain migration lineage from v2 through v9.
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

## Redeven adapter

Computer and browser action results use Floret's published tool-result image
contract: Redeven supplies opaque screenshot descriptors and a host resolver,
while Floret owns provider request assembly, replay, and durable descriptor
state. Restart and continuation resolve the same target reference and verify
its digest; neither layer persists screenshot base64 or creates a second
thread lifecycle stream.

Redeven keeps one typed adapter over the published Floret v7 module. HTTP and RPC handlers perform product authorization, ResourceRef and attachment resolution, DTO mapping, and a typed call. They do not wait for provider work, register a legacy run handler, observe a receipt, acquire an authority barrier, or persist a lifecycle projection.

Published Floret v7.5.0 exposes existing `ThreadSummary.TitleGeneration` with
canonical title text and status. Redeven forwards the complete snapshot in HTTP
and live summaries, including child details. No product store owns title state;
no schema migration or title regeneration is required. The UI ordering contract
is documented in [Flower live timeline](../ui/flower-live-timeline.md).

Floret title events are settlement notifications, not a second title source.
The synchronous event sink requests one Service-owned, per-thread coalesced
summary publication and returns without reading `ThreadService`. That publisher
then reads the canonical current view and summary and emits the existing
`summary.batch`. A failed canonical read fences the endpoint's live observers;
reconnection restores the authoritative baseline instead of retrying, polling,
or applying an event-derived title patch.

The product Stop boundary is an idempotent command acknowledgement, not a
thread-read boundary. Redeven invokes typed `Cancel`, discards its returned
current view, and exposes only `{ok: true}`. Canonical workspace subscription
and ordinary detail reads remain the only browser state paths; Stop never
decorates a command response with viewer read state, projects a second detail,
or starts a follow-up read.

Flower explicitly requests `CancelModeGraceful`. Floret records the exact
ThreadID, TurnID, RunID, source, and request time before cancelling execution.
One five-second window lets dispatched tools finish their existing output and
result commits. Confirmed results end the turn as cancelled; unconfirmed
side effects remain `effect_outcome_unknown` and cannot be replayed or retried.
Undispatched tools are cancelled and real tool errors are preserved. Stop never
automatically starts queued input. A new message continues in a new turn.
Summary and detail forward optional canonical `Cancellation` unchanged; active
plus cancellation means stopping. Floret installs terminal lifecycle and
canonical results atomically, including direct View and Send reads. Its schema
11 migration preserves older records without inventing missing Stop provenance.

Redeven resolves one complete `ToolSurface` when it creates the hosted Agent for a new Turn.
Registry tools with nil provider definitions inherit the registry definitions;
a non-nil empty definitions slice intentionally exposes no registry tools. The
current model, reasoning, definitions, System Prompt, adapter, and context
policy are checkpointed by Floret as one immutable Turn surface. Ask User,
ordinary tools, retries, and restart recovery reuse that surface. Idle settings
or product-version changes affect only the next Turn.

Redeven consumes Floret v7.1.4's public ordered `ThreadView.Items`, exact
item and interaction `TurnID` plus `RunID`, exact active `ThreadView.RunID`,
process-local `ThreadView.RunProgress`, and
`ThreadContextReader`. User, thinking, assistant, tool, and independent
interaction segments retain Floret-assigned IDs and ordinals across live
updates, approval settlement, canonical reload, and renderer recovery. Redeven
maps the sequence directly and does not consume the deprecated global draft
fields, infer a historical identity from the active run, infer order from
timestamps or tool identity, or persist a second presentation order.
The Floret thread actor is the only active-run phase owner. Redeven passes the
exact RunID and `preparing`, `waiting_response`, `streaming`, `retrying`,
`finalizing`, or `tool_execution` phase to Flower. It does not derive RunID
from TurnID or maintain a model-I/O event stream, message-content phase
inference, or another lifecycle projection.
Every ordinary Send, queued start, Retry, Ask User continuation, and recovered
execution enters Floret's single Run transition. The transition closes the old
live segment, installs the new Run and logical-request identities, resets
attempt ownership, and publishes `preparing` before provider dispatch. The
RunID fence still rejects late events from the previous execution. Redeven
therefore forwards waiting-response, streaming reasoning, and assistant growth
before terminal settlement without polling or reconstructing missing frames.
At terminal settlement, Floret's canonical ordered items replace temporary
stream text. `TurnResult.Output` remains a run aggregate and is not another
message source. Flower deduplicates exact item IDs only; equal text with
different stable IDs remains visible.

When Floret installs an approval or user-input interaction, the unresolved
interaction and its cleared active progress are published in one transition.
Active summaries without an unresolved interaction retain `run_progress`, so
Redeven never maps a transiently invalid combination while the provider waits.

Canonical terminal failure classification comes from Floret v7.1.4
`ThreadView.Failure` and `ThreadSummary.Failure`. Redeven maps the typed code
once for list, detail, live current, and command responses, then removes the
upstream failure payload from the Flower wire view. There is no error-text or
historical-field classifier. `effect_outcome_unknown` has one product code and
explains that execution stopped to avoid a duplicate operation.

Floret v7.1.4 treats an interaction control call as waiting only when validation
succeeds and `ask_user` contains at least one complete question. A
`control_error` is terminal for both new facts and historical
`waiting + control_error` facts, cannot create pending input, and ignores a
matching late invalid interaction during recovery. Provider history pairs the
failed Assistant control call with one safe error Tool result that contains no
arguments or validation detail, so a later reply never inherits an unmatched
tool call. Redeven consumes this public terminal failure without reading or
repairing Floret storage.

Floret v7 accumulates a tool result into the matching call Activity by stable
`tool_call_id`. Result status and output advance the item without clearing the
call description, command, safe targets, or other presentation facts. The same
merge rule is used during execution and canonical journal reconstruction.

Every public Activity item passes through one host projection before it reaches
current view, timeline pagination, live stream, or historical replay. The
projection removes host paths, working directories, pending handles, and
nested private values while keeping renderer, operation, status, summary,
stable IDs, and display names. Floret v7.1.4 `StructuredActivityPayload.Rows`
is the only generic rich-detail contract: Redeven creates bounded, ordered,
safe display rows before admission, and Flower expands only those rows, a
meaningful summary, or an error. It never rebuilds detail from raw tool JSON.
Flower's payload contract remains the final validation boundary.

Historical tool Activity does not depend on the current registry. Persisted
presentation is authoritative; when it is absent or its renderer is no longer
supported, Flower uses one neutral presentation and drops unknown payload data.
A removed tool is not restored as a compatibility definition.

Before the one `runtime.Open` call, Redeven invokes Floret's published
`storage.MaintainSQLite` boundary with a bounded 30-second startup context.
The public maintenance implementation validates the physical schema and
integrity, converts eligible legacy databases to incremental auto-vacuum, and
reclaims only when the fixed size and ratio thresholds are met. Busy storage,
insufficient disk space, and timeout are observable safe skips; the subsequent
runtime open remains the only final authority for accepting or rejecting the
database. Redeven never reads, copies, replaces, or compacts opaque Floret
records itself.

Redeven reports the `verifying` readiness phase immediately before the single
`runtime.Open` call. Floret v7.1.4 atomically converges the exact legacy
tool-result Raw representation produced before UTF-8 normalization and maps
all remaining session-tree authority failures to public
`runtime.ErrAuthorityCorrupt`. Redeven classifies only that public error; it
does not parse error text or inspect Floret records. Sanitized startup logs
record the phase and class without backend detail or conversation content.

Thread inventory uses one Floret `List` snapshot. Redeven merges each public
`ThreadSummary` with host-owned settings and does not load `ThreadView`,
timeline, context, attachments, or child detail for list rows. Full canonical
projection remains exclusive to the selected-thread detail boundary.

One endpoint/thread authority boundary resolves the product catalog record and
rejects an absent, tombstoned, or foreign thread before every canonical
mutation. A shared endpoint may contain turns from multiple users, so Redeven
persists only the submitting turn's minimum host authorization and audit facts:
endpoint, namespace, channel, user, and request, turn, and thread identities.
Floret remains the owner of canonical input, attachment references, and retry
source. Restart redispatch combines those Floret facts with the matching host
authority record instead of using the thread creator, and never stores a second
transcript or lifecycle projection.

Authority is durable before pending-input import or child-thread Send can admit
canonical input. Retry and child Send then bind the same authority to the TurnID
returned by Floret using a bounded service-owned context, so caller cancellation
after acceptance cannot break restart or a later retry. Child settings preserve
autonomous execution and reviewer readonly permission across restart. SubAgent
detail reads prove parent endpoint ownership before using the process-wide
Floret child list or view.

Flower thread navigation assigns the selection generation synchronously with
the user's rail intent. Deferred presentation work carries that generation,
and an older bootstrap is rejected before it can update `ThreadCache` detail.
Rapid A to B to A navigation therefore keeps the latest selected identity and
transcript even when earlier detail requests settle out of order.

`ThreadContextReader` recovers the
canonical merged compaction operations for detail reads and terminal workspace
updates. A pure `/compact` input supplies one host-owned manual compaction request;
the canonical user message anchors exactly one terminal `compacted` or `noop`
divider after renderer reload. Context reads remain valid when `ask_user` resumes
one turn through a later canonical run. Redeven does not persist a parallel
compaction projection or inspect Floret storage.

Floret also owns the provider prefix lineage. Redeven restores effect work from
`AgentRequest.CanonicalTurnInput`, so an Ask User answer cannot replace the
original user objective. Provider natural stop is the only successful completion
rule; ordinary tools continue and `ask_user` waits before resuming the same Turn.
The provider history keeps that `ask_user` invocation and answer as one typed
Assistant tool call plus Tool result. Provider-context v6 hashes typed facts
without runtime or journal entry identities, so unavailable ordinary-tool
history remains valid in later Turns while its removed definition stays absent.

Floret queue item `id` is the canonical mutation identity for reorder, delete,
and promote. Its `request_key` remains the send idempotency identity used only to
settle the short-lived browser outbox; the two values are not interchangeable.

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
- `redeven:internal/ai/floret_ask_user_integration_test.go` - Covers frozen waiting-turn settings, non-blocking interaction settlement, continuation progress, and natural completion.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Latest-selection generation fence before detail cache mutation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Deterministic out-of-order A to B to A navigation coverage.
