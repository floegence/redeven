---
type: AI Runtime Contract
title: Floret Redeven adapter and projection
description: Map authorized Redeven requests and Floret typed views without creating a second thread lifecycle.
tags: [ai, floret, adapter, projection]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Cross-boundary adapter contract spanning authorization, live projections, Activity sanitization, recovery, and browser ordering.
---
# Summary

Redeven's adapter is a thin typed boundary over published Floret. It authorizes endpoint and thread ownership, resolves resources, sanitizes Activity, maps typed views and failures, and projects live summaries. Floret remains the only lifecycle, persistence, migration, cancellation, and provider-state owner; Redeven never waits on provider work or mirrors a receipt, authority barrier, transcript, or execution projection.

# Contract

Computer and browser action results use Floret's published tool-result image
contract: Redeven supplies opaque screenshot descriptors and a host resolver,
while Floret owns provider request assembly, replay, and durable descriptor
state. Restart and continuation resolve the same target reference and verify
its digest; neither layer persists screenshot base64 or creates a second
thread lifecycle stream.

Redeven keeps one typed adapter over the published Floret v7 module. HTTP and RPC handlers perform product authorization, ResourceRef and attachment resolution, DTO mapping, and a typed call. They do not wait for provider work, register a legacy run handler, observe a receipt, acquire an authority barrier, or persist a lifecycle projection.

Published Floret v7.25.2 exposes existing `ThreadSummary.TitleGeneration` with
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

Input response retries are adjudicated by Floret Respond, including resolved
interactions: the same answer succeeds, a different answer returns conflict
(HTTP and RPC 409). Authorization remains mandatory. Redeven persists execution
authority and reobserves computer control only for an unresolved interaction;
replaying an accepted answer never repeats these preconditions. Approval batches
forward the caller's exact ID set in one Respond with no host-side partial
execution. See [Flower interactions](../ui/flower-approval-context.md) for the
browser submission, compatibility, and draft contracts.

The product Stop boundary is an idempotent command acknowledgement, not a
thread-read boundary. Redeven invokes typed `Cancel`, discards its returned
current view, and exposes only `{ok: true}`. Canonical workspace subscription
and ordinary detail reads remain the only browser state paths; Stop never
decorates a command response with viewer read state, projects a second detail,
or starts a follow-up read.

Flower explicitly requests `CancelModeGraceful` with `IncludeDescendants` through
published Floret v7.25.2. Stop therefore includes active child threads, while
independent roots and queued inputs remain untouched. Each thread publishes its
own stopping and terminal views. Floret records the exact
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

Redeven resolves a complete `ToolSurface` at provider and tool-dispatch boundaries. Nil provider definitions inherit registry definitions; an explicit empty slice exposes none. Floret fixes model, reasoning and context policy for a Turn and keeps each provider checkpoint immutable. Published v7.25.2 lets Redeven refresh current permission instructions and local tools on every request. The detached `InitialProviderSurface` preserves unrelated hosted search definitions from the first checkpoint. Pending invocations retain their authorization snapshot. Ask User, retries and restart use current thread permission without rewriting history. Unrelated profile changes retain their new-Turn boundary.

Redeven consumes Floret v7.25.2's public ordered `ThreadView.Items`, exact
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

Canonical terminal failure classification comes from Floret v7.25.2
`ThreadView.Failure` and `ThreadSummary.Failure`. Redeven maps the typed code
once for list, detail, live current, and command responses, then removes the
upstream failure payload from the Flower wire view. There is no error-text or
historical-field classifier. `effect_outcome_unknown` has one product code and
explains that execution stopped to avoid a duplicate operation.

Floret v7.25.2 treats an interaction control call as waiting only when validation
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
stable IDs, and display names. Floret v7.25.2 `StructuredActivityPayload.Rows`
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
`runtime.Open` call. Floret v7.25.2 atomically converges the exact legacy
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

The adapter may add product authorization, resource resolution, DTO mapping, and browser-safe presentation. It must not import Floret internals, read or migrate Floret storage, create a legacy run handler, infer lifecycle from error text or timestamps, or introduce a second event/retry/replay state machine. Product migrations may import retired queued inputs once, then remove staging rows.

# Evidence

- `redeven:internal/ai/floret_runtime.go` - Composes the published typed runtime.
- `redeven:internal/ai/threads.go` - Enforces endpoint/thread ownership and summary-only inventory mapping.
- `redeven:internal/ai/activity_file_actions.go` - Sanitizes public Activity before every projection path.
- `redeven:internal/ai/stop_thread.go` - Maps typed cancellation to one idempotent command acknowledgement.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Applies selection-generation fences before detail cache mutation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Covers out-of-order navigation recovery.
