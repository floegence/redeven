---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Canonical Floret v3 identity, admission, recovery, projection, and runtime ownership.
tags: [ai, floret, threads, runtime]
timestamp: 2026-08-01T00:00:00Z
quality_exception: Cross-domain canonical thread authority contract spanning identity, admission, recovery, projection, and runtime ownership.
---
# Summary

- Authority: Floret v3.2.38 owns canonical `ThreadID`, `TurnID`, `RunID`, thread actors, recovery journal state, titles, lifecycle, projections, approvals, todos, tools, SubAgents, artifacts, provider continuation, canonical retry, and schema migrations.
- Outcome: Redeven consumes identity-bound public capabilities and maps validated state into Flower while retaining product settings, authorization, unadmitted work, and saga receipts.
- Invariants: callers never preallocate canonical identity, admission binds only from committed Floret facts, and no product table or UI projection reconstructs Agent state.
- Failure boundary: missing authority, invalid data, conflicting identity, incomplete exact-read recovery, or failed permission proof stops the operation without fallback or guessed state.

# Contract

## Canonical identity and thread operations

Browsers generate a stable, bounded `client_request_id` for each create or fork intent. Redeven persists that product request identity, a fingerprint, and a derived Floret `LogicalRequestID`; it does not call any canonical ID constructor. Create starts with `canonical_thread_id` null, fork starts with `destination_thread_id` null, and upload staging uses a neutral product target.

Floret `CreateThread` and `ForkThread` return canonical thread identities. Redeven compare-and-set binds the result, materializes product settings/resources in its own transaction, applies any explicit title as a separate replayable Floret mutation, then marks the operation complete before success is published. Retry reuses the same request identities and must receive the same canonical result. Cross-database atomicity is represented by durable stages rather than a claimed distributed transaction.

Thread overviews, titles, turn pages, exact turn reads, activity, approvals, todos, pending settlement, attachments, references, and SubAgent state come from validated Floret v3 public contracts. Redeven adds product authorization and browser-safe presentation only. Known-turn reads use exact `ReadTurn` authority; only the typed not-found result proves absence, and other errors never fall back to a history scan.

## Turn admission and recovery

Before admission, a queued command owns a Redeven `queue_id`, frozen input, stable `LogicalRequestID`, product resource claims, and launch settings. Its canonical `turn_id` and `run_id` are empty. Queue admission does not generate either value.

Floret v3.2.38 exposes turn admission as a two-step public contract. Redeven calls `AdmitTurn` once with the frozen canonical command, validates the returned `TurnAdmissionReceipt`, and in one threadstore transaction binds the previously empty canonical IDs, records the committed entry and permission-snapshot evidence, transfers upload ownership, consumes queued work, and advances the followup revision. Only after that product transaction commits does it configure in-memory run identity, publish canonical timeline replacement, mark presentation ready, and call `ExecuteAdmission` with the same receipt plus process-local `ExecutionContext`. Supplemental context and signal projection are supplied only at execution; Redeven neither persists nor resubmits the canonical command as an execution plan.

Every admitted `ThreadTurnSnapshot` carries the optional canonical `logical_request_id` that was accepted for that user-visible lifecycle. The field is the stable association across provider retries and transport recovery; it is not a `TurnID`, `RunID`, `AttemptID`, or authorization key. Exact turn reads, pages, bootstrap, and replay derive it from the same Floret canonical projection. Older turns may omit the field and remain readable with an empty value; downstream hosts must not reconstruct it from prompt text, timestamps, or row position.

Floret v3.2.38 keeps long-running provider and tool execution outside the host-wide mutation lock, while a thread-scoped execution coordinator converges concurrent replay of the same admission. Root-bound approval resolution and queue reads can therefore proceed while the active turn waits for a decision, without allowing duplicate provider or tool execution. The coordinator records an exact process-local thread/turn handoff before durable admission and atomically replaces it with the registered execution lease, so concurrent inventory cannot misclassify the commit-to-registration interval as interrupted. The atomic `ThreadReader.Bootstrap` path uses that same process-local execution registry, so a canonical bootstrap cannot regress an admitted or executing turn to an old recoverable interruption. Provider requests, approval-gated effects, approval settlement, waiting-approval cancellation, and terminal turn writes share the renewable turn lease binding and accept only monotonic heartbeat successors within one acquisition; thread, turn, owner, generation, or acquisition drift remains stale authority. A canceled waiting effect atomically settles its approval batch and canonical turn with the current proof, so the replayable admission does not remain prepared or restart as a failed interruption. A stale final heartbeat is absorbed only after durable terminal commit and local lease cleanup converge, while blocked renewal I/O does not prevent terminal settlement. Waiting for the shared backend transaction fence honors cancellation and deadlines.

The retained Host routes ordered runtime mutation through one mailbox owner per
thread. Accepted mutations on one thread serialize, while provider I/O,
approval waits, and unrelated thread mailboxes do not share that queue. Live
text, thinking, provider timing, subscriber buffers, cursor state, and other
current-process drafts stay in memory. Admission, approval decisions, effect
intent/results, canonical assistant/final/terminal outcomes, and replay rules
cross the compact recovery boundary; irreversible effects require their durable
intent before dispatch. Host shutdown rejects new submissions, drains accepted
mailbox work, checkpoints, and then closes storage.

Each provider dispatch carries the stable logical request identity, an attempt ID,
and a monotonic attempt epoch. Floret activates the newest attempt before live
projection and drops late older stream facts before they can reach the current
draft or canonical assistant commit. Redeven mirrors only the presentation
boundary: a newer activation clears its in-memory assistant draft, while an old
or incomplete stream identity is discarded. Attempt metadata is not a second
lifecycle store and is not checkpointed; canonical assistant, tool, approval,
effect, and terminal ownership remains in Floret.

When a provider continuation fails after durable tool settlement, Redeven calls
the published `TurnExecutor.RetryTurn` capability with a stable mutation
identity derived from the exact failed canonical turn and run. Floret chooses
the latest retryable durable savepoint, allocates the retry turn and run, and
replays duplicate or restart requests idempotently. Redeven does not admit a
new user message, resubmit attachments, resolve approvals, or dispatch tools on
this path. A failed retry may itself become the source of a later retry, while a
running, waiting, or completed retry is accepted as the same operation. The
canonical source activity, including quiet declined and settled tool results,
remains unchanged and appears exactly once.

The Host harness and execution event paths also share one process-local live
projection recorder. A tool-authored presentation observed before approval is
therefore available when requested and approved detail commits arrive through
the harness path. Matching requires the exact thread, turn, run, and tool
identity; approval-only history retains Floret's neutral fallback. Redeven
consumes that authoritative projection and does not cache tool arguments or
reconstruct command presentation from provider data.

Canonical inventory and exact thread reads apply the same monotonic lease
lineage rule. If a durable heartbeat renewal is visible before the matching
process-local execution registry update, the active turn remains `running` and
a new run clears any prior interrupted product error. A missing local
execution after restart, an expired lease, a different owner or generation, or
claimed recovery authority still projects interruption and never receives a
running fallback.

Every failed Floret engine result has an explicit failure origin. Provider,
tool-dispatch, storage, and cancellation failures keep their specific origin;
remaining internal validation failures use the engine-contract origin. The
AgentHarness therefore persists the original failure instead of replacing it
with a secondary missing-classification error. Redeven consumes that canonical
terminal result and does not infer or repair failure ownership.

The eventual execution result rechecks terminal identity and releases execution authority; it is not the first admission boundary. A definite failure before receipt admission releases the in-flight command to an editable retry state and releases applicable staging ownership. A failure after canonical admission must not requeue the admitted user turn. An unknown transport outcome preserves the draft and stable client request identity so the caller can retry the exact operation.

Restart recovery reuses the same `LogicalRequestID`. A replayed committed mutation receipt may bind product state only after an exact canonical read verifies `LogicalRequestID`, thread, turn, run, committed user entry identity and kind, normalized command fingerprint, and permission proof. Recovery invokes the same transactional receipt binder as live admission. Missing fields, a non-replayed receipt, missing canonical state, fingerprint drift, permission mismatch, or partial identity blocks recovery; Redeven never invents IDs or reconstructs the user row from queue, audit, upload, or UI data.

Floret rebuilds runtime actors from the latest compact checkpoint followed by
contiguous checksummed journal frames. A torn final frame is ignored, corruption
inside the retained prefix fails closed, and replay preserves already published
thread/turn/run identities and exactly-once approval/effect decisions. Ephemeral
drafts and attempt diagnostics may disappear on restart; canonical user,
assistant, tool, approval, effect, and terminal facts may not.

## Runtime ownership and presentation

One composition-root `runtime.Host` opens the published Floret v3.2.38 storage source directly and remains the Host retained by that service generation. Startup never opens and closes a disposable Host before creating the retained Host. The upstream open path automatically migrates the released Floret domain schema v2 through v3 to current v4 before the Host becomes available; migration and verification are one backend transaction, and invalid, drifted, or future state fails closed without Redeven inspecting upstream records. The v3-to-v4 edge derives and atomically commits a strict root-thread inventory beside canonical authority. Transient thread handles issue native `ThreadReader`, `ThreadLifecycle`, `TurnExecutor`, `ThreadCompactor`, and `SubAgentManager` capabilities; product adapters retain only the exact native capability they need. Direct-child recovery starts from the parent `ThreadReader` and binds the exact child through `ThreadReader.Child`. Create, inventory, interrupted-turn recovery, and pending-tool recovery remain confined to their existing composition-owned coordinators. `Service`, runs, and tool handlers retain only narrow local interfaces. Removed broad `Thread` methods, removed v2 storage cutover APIs, and compatibility migration paths are absent from production and test integration.

On canonical read, Floret v3.2.38 automatically settles a supported historical requested approval when durable failed or aborted terminal authority and a recovery tool result prove the turn is no longer decisionable. This same-schema compatibility does not rewrite the journal. Redeven consumes the validated projection and never scans, patches, or migrates Floret-owned storage; non-terminal, successful, unknown, drifted, and future state continues to fail closed upstream.

`ThreadReader.Bootstrap` returns the thread, overview, first turn page, approvals, todos, context, pending work, and SubAgents from one canonical backend snapshot and exact revision. Its snapshot projection carries the runtime Host's process-local execution proof: an active admission or execution remains `running`, while a restarted Host without that proof projects the unfinished lease as a recoverable interruption. Redeven consumes bootstrap directly and subscribes after that revision; later history uses `ListTurns`. It does not cache or reconstruct bootstrap. A retained tombstone returns `ErrThreadDeleted`; only absence from live and deleted state returns `ErrThreadNotFound`. Canonical Activity reads retain the revision and provenance from `ReadAuthoritativeProjection`.

Floret v3.2.38 keeps complete-domain polling bounded by comparing the exact
durable envelope bytes inside every backend read transaction. Only a
byte-identical, previously validated envelope reuses the decoded in-process
domain; any external byte change is strictly decoded and validated before use.
Redeven neither owns this cache nor bypasses the public capability boundary,
and corrupt, drifted, or future upstream state still fails closed.

Root inventory uses the v3.2.38 indexed projection, whose items pair a canonical snapshot with an optional latest turn from one bounded view. Redeven pages until every product root is found or authority ends, preserves product order, performs no per-thread bootstrap or complete session-tree reads, and fails closed when a product root is absent. Background listing therefore cannot repeatedly decode full domains or starve approval writes behind the backend fence. `Threads.ListInterruptedTurnRecoveryCandidates` separately scans active turn leases once and returns stable root or direct-parent identities without granting recovery authority; Redeven binds only those identities through exact root or parent-reader child capabilities, so startup does not enumerate every root's SubAgent inventory.

Floret owns canonical todo validity: maximum count, stable non-empty unique IDs, non-empty content, the status set, and one in-progress item. Redeven derives status values in its tool schema, maps typed snapshots to UI DTOs, and keeps only product guidance that control-signal prose is not actionable work. It does not normalize or repair canonical todo state.

Floret assembles canonical journal context and opaque continuation. Redeven supplies current user input, ephemeral supplemental context, typed attachments and references, provider gateway, tools, effect authorization, permission snapshots, and product labels through immutable `runtime.Agent` values. Provider adapters reject invalid typed messages rather than repairing, regrouping, dropping, or synthesizing them.

Redeven's structured `ask_user` projector requires a reason, concrete required
input, valid questions, and an `evidence_refs` array. The array is empty when no
tool evidence exists and otherwise cites relevant tool IDs; invalid control
payloads fail closed before a waiting turn is published.

Structured input returns a canonical continuation receipt over same-origin HTTP,
not the realtime RPC notification stream or a subsequent bootstrap. Flower
validates the exact thread, consumed prompt, turn, and run, clears only that
prompt, and marks the run active while retaining the existing subscription.
Background detail refresh and notification backpressure cannot hold the composer
in its submitting state.

Flower projects the canonical waiting state into one mutually exclusive bottom
surface: ordinary chat, structured input, or approval. Input and approval
surfaces replace the ordinary composer controls and footer; they do not nest a
second composer or synthesize lifecycle state. The input surface keeps per-
question answers in local interaction state while navigating the canonical
question list, and the approval surface exposes only the canonical tool label,
safe command or target summary, required risk note, and reject/allow-once
decision. Draft text, attachments, focus, and scroll remain local UI state and
survive projection, reconnect, and surface-mode changes.

An `active_run_id` change atomically replaces prior run, prompt, model-I/O,
context-usage, and approval transients before reducing events for the new run.
Timeline history and canonical compactions remain intact, so a resumed
control-only run accepts valid status, model-I/O, and input events.

Flower history and replacements preserve Floret turn order, entry identities, and validated projections. A valid terminal turn with no renderable assistant body may produce one typed `turn_projection_unavailable` decoration. Storage, pagination, identity, or validation failures remain errors and do not become invented assistant content. Queued rows use `queue_id` and are non-message product projections; only a canonical Floret user row carries `turn_id` and can replace them after admission.

Effect dispatch rereads current product permission, validates any approval, and binds a one-shot proof to the exact Floret invocation. Pending terminal work retains the exact settlement target and authority barrier. SubAgent execution uses parent-bound v3 capabilities and canonical child `ThreadID`; no `subagent_id`, metadata parser, or product-owned child lifecycle exists.

Startup recovery preserves the ordered owners: pending delete, pending create, root inventory, interrupted root/direct-child turns, pending fork, SubAgent publication, queued admission, then queued wake. Each root reader lists direct children once. Recovery validates closed-child identity and hierarchy but requests child recovery authority only for open or closing children through their exact parent. Runtime authority stays closed until every stage validates.

# Boundaries

Redeven must not import Floret `internal/*`, query Floret tables, persist a second Agent lifecycle, infer one canonical identity from another, parse removed DTO shapes, or recover through metadata, audit, preview, or prompt equality. Local Floret source wiring, `replace`, and Go workspace shortcuts are forbidden.

Redeven product receipts contain only the minimum idempotency, authorization, and cross-store settlement evidence. They cannot become an alternate canonical transcript or turn state machine.

# Evidence

- `redeven:internal/ai/floret_approval_lease_renewal_test.go` - Verifies provider, approval, effect, and terminal convergence across one renewable turn lease lineage.
- `redeven:internal/ai/floret_bootstrap.go` - Opens Floret v3 and issues narrow identity-bound capabilities.
- `redeven:internal/ai/floret_contracts.go` - Defines the product-local interfaces over public v3 contracts.
- `redeven:internal/ai/thread_create_operation.go` - Drives create replay and canonical binding from stable client identity.
- `redeven:internal/ai/thread_fork_operation.go` - Drives fork replay and destination materialization.
- `redeven:internal/ai/send_user_turn.go` - Starts a turn without caller-supplied canonical turn or run identity.
- `redeven:internal/ai/floret_runtime.go` - Binds `TurnAdmissionReceipt` before receipt-only `ExecuteAdmission`.
- `redeven:internal/ai/retry_thread_continuation.go` - Maps one failed canonical continuation to Floret's idempotent retry mutation without user readmission.
- `redeven:internal/ai/floret_runtime_test.go` - Verifies repeated continuation failure can retry again while retaining one canonical user admission.
- `redeven:internal/ai/floret_control_test.go` - Verifies structured waiting signals, including the no-tool-evidence case, and rejects invalid question contracts.
- `redeven:internal/ai/flower_live_projection.go` - Replaces transient live state when canonical active-run identity changes.
- `redeven:internal/ai/realtime_service_test.go` - Verifies that active-run handoff removes prior prompt and approval state and admits new run events.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Applies exact structured-input admission receipts before non-blocking detail reconciliation.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts` - Keeps structured-input admission on the HTTP receipt path without issuing request or subscription RPCs.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.inputAdmission.browser.test.tsx` - Keeps the selected composer live while a post-admission detail read remains blocked.
- `redeven:internal/ai/floret_events.go` - Treats committed-user events as observation, not admission binding.
- `redeven:internal/ai/queued_turns.go` - Implements exact replay and recovery settlement.
- `redeven:internal/ai/queued_turns_exact_read_test.go` - Covers strict mutation-receipt and exact-read recovery evidence.
- `redeven:internal/ai/floret_startup_recovery_test.go` - Covers root inventory reconciliation and real root/direct-child startup recovery authority.
- `redeven:internal/ai/threads_approval_status_test.go` - Verifies batch latest-turn listing, bounded inventory pagination, missing-root rejection, and zero single-thread reads.
- `redeven:internal/ai/floret_thread_projection.go` - Maps validated canonical projections without shadow storage.
- `redeven:internal/ai/subagents_floret.go` - Uses parent-bound canonical child capabilities.
- `redeven:internal/ai/floret_store_maintenance.go` - Opens only the current published Floret storage contract.
- `redeven:go.mod` - Pins the published Floret v3 module.
