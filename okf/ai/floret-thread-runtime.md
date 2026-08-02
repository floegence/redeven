---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Canonical Floret v3 identity, admission, recovery, projection, and runtime ownership.
tags: [ai, floret, threads, runtime]
timestamp: 2026-08-01T00:00:00Z
---
# Summary

- Authority: published Floret v3.2.2 owns canonical `ThreadID`, `TurnID`, `RunID`, journal state, titles, lifecycle, projections, approvals, todos, tools, SubAgents, artifacts, and provider continuation.
- Outcome: Redeven uses narrow identity-bound public capabilities and maps validated Floret state into Flower while retaining only product settings, resources, authorization, unadmitted work, and durable saga receipts.
- Invariants: callers never preallocate canonical identity, admission binds only from committed Floret facts, and no product table or UI projection reconstructs Agent state.
- Failure boundary: missing authority, invalid public data, conflicting identity, incomplete exact-read recovery, or failed permission proof stops the operation without fallback or guessed state.

# Contract

## Canonical identity and thread operations

Browsers generate a stable, bounded `client_request_id` for each create or fork intent. Redeven persists that product request identity, a fingerprint, and a derived Floret `LogicalRequestID`; it does not call any canonical ID constructor. Create starts with `canonical_thread_id` null, fork starts with `destination_thread_id` null, and upload staging uses a neutral product target.

Floret `CreateThread` and `ForkThread` return canonical thread identities. Redeven compare-and-set binds the result, materializes product settings/resources in its own transaction, applies any explicit title as a separate replayable Floret mutation, then marks the operation complete before success is published. Retry reuses the same request identities and must receive the same canonical result. Cross-database atomicity is represented by durable stages rather than a claimed distributed transaction.

Thread overviews, titles, turn pages, exact turn reads, activity, approvals, todos, pending settlement, attachments, references, and SubAgent state come from validated Floret v3 public contracts. Redeven adds product authorization and browser-safe presentation only. Known-turn reads use exact `ReadTurn` authority; only the typed not-found result proves absence, and other errors never fall back to a history scan.

## Turn admission and recovery

Before admission, a queued command owns a Redeven `queue_id`, frozen input, stable `LogicalRequestID`, product resource claims, and launch settings. Its canonical `turn_id` and `run_id` are empty. Queue admission does not generate either value.

Floret v3.2.2 exposes turn admission as a two-step public contract. Redeven calls `AdmitTurn` once with the frozen canonical command, validates the returned `TurnAdmissionReceipt`, and in one threadstore transaction binds the previously empty canonical IDs, records the committed entry and permission-snapshot evidence, transfers upload ownership, consumes queued work, and advances the followup revision. Only after that product transaction commits does it configure in-memory run identity, publish canonical timeline replacement, mark presentation ready, and call `ExecuteAdmission` with the same receipt plus process-local `ExecutionContext`. Supplemental context and signal projection are supplied only at execution; Redeven neither persists nor resubmits the canonical command as an execution plan.

Floret v3.2.2 keeps long-running provider and tool execution outside the host-wide mutation lock, while a thread-scoped execution coordinator converges concurrent replay of the same admission. Root-bound approval resolution and queue reads can therefore proceed while the active turn waits for a decision, without allowing duplicate provider or tool execution. Waiting for the shared backend transaction fence honors cancellation and deadlines.

The eventual execution result rechecks terminal identity and releases execution authority; it is not the first admission boundary. A definite failure before receipt admission releases the in-flight command to an editable retry state and releases applicable staging ownership. A failure after canonical admission must not requeue the admitted user turn. An unknown transport outcome preserves the draft and stable client request identity so the caller can retry the exact operation.

Restart recovery reuses the same `LogicalRequestID`. A replayed committed mutation receipt may bind product state only after an exact canonical read verifies `LogicalRequestID`, thread, turn, run, committed user entry identity and kind, normalized command fingerprint, and permission proof. Recovery invokes the same transactional receipt binder as live admission. Missing fields, a non-replayed receipt, missing canonical state, fingerprint drift, permission mismatch, or partial identity blocks recovery; Redeven never invents IDs or reconstructs the user row from queue, audit, upload, or UI data.

## Runtime ownership and presentation

One composition-root `runtime.Host` opens the published Floret v3.2.2 storage source directly. Transient thread handles issue native `ThreadReader`, `ThreadLifecycle`, `TurnExecutor`, `ThreadCompactor`, and `SubAgentManager` capabilities; product adapters retain only the exact native capability they need. Direct-child recovery starts from the parent `ThreadReader` and binds the exact child through `ThreadReader.Child`. Create, inventory, interrupted-turn recovery, and pending-tool recovery remain confined to their existing composition-owned coordinators. `Service`, runs, and tool handlers retain only narrow local interfaces. Removed broad `Thread` methods, removed v2 storage cutover APIs, and compatibility migration paths are absent from production and test integration.

On canonical read, Floret v3.2.2 automatically settles a supported historical requested approval when durable failed or aborted terminal authority and a recovery tool result prove the turn is no longer decisionable. This same-schema compatibility does not rewrite the journal. Redeven consumes the validated projection and never scans, patches, or migrates Floret-owned storage; non-terminal, successful, unknown, drifted, and future state continues to fail closed upstream.

Initial thread state is read through `ThreadReader.Bootstrap`, which returns the thread, overview, first turn page, approvals, todos, context, pending work, and SubAgents from one revision. Any direct Floret subscription must continue from that revision; later history pagination remains an explicit `ListTurns` read. Canonical Activity reads use `ReadAuthoritativeProjection` and retain its Floret revision/provenance distinction before Redeven maps the enclosed projection into Flower.

Floret owns canonical todo validity: maximum count, stable non-empty unique IDs, non-empty content, the status set, and one in-progress item. Redeven derives status values in its tool schema, maps typed snapshots to UI DTOs, and keeps only product guidance that control-signal prose is not actionable work. It does not normalize or repair canonical todo state.

Floret assembles canonical journal context and opaque continuation. Redeven supplies current user input, ephemeral supplemental context, typed attachments and references, provider gateway, tools, effect authorization, permission snapshots, and product labels through immutable `runtime.Agent` values. Provider adapters reject invalid typed messages rather than repairing, regrouping, dropping, or synthesizing them.

Flower history and replacements preserve Floret turn order, entry identities, and validated projections. A valid terminal turn with no renderable assistant body may produce one typed `turn_projection_unavailable` decoration. Storage, pagination, identity, or validation failures remain errors and do not become invented assistant content. Queued rows use `queue_id` and are non-message product projections; only a canonical Floret user row carries `turn_id` and can replace them after admission.

Effect dispatch rereads current product permission, validates any approval, and binds a one-shot proof to the exact Floret invocation. Pending terminal work retains the exact settlement target and authority barrier. SubAgent execution uses parent-bound v3 capabilities and canonical child `ThreadID`; no `subagent_id`, metadata parser, or product-owned child lifecycle exists.

Startup recovery preserves the ordered owners: pending delete, pending create, canonical root inventory, interrupted root/child turns, pending fork, SubAgent publication, queued admission, then queued wake. Runtime authority stays closed until every required stage validates.

# Boundaries

Redeven must not import Floret `internal/*`, query Floret tables, persist a second Agent lifecycle, infer one canonical identity from another, parse removed DTO shapes, or recover through metadata, audit, preview, or prompt equality. Local Floret source wiring, `replace`, and Go workspace shortcuts are forbidden.

Redeven product receipts contain only the minimum idempotency, authorization, and cross-store settlement evidence. They cannot become an alternate canonical transcript or turn state machine.

# Evidence

- `redeven:internal/ai/floret_bootstrap.go` - Opens Floret v3 and issues narrow identity-bound capabilities.
- `redeven:internal/ai/floret_contracts.go` - Defines the product-local interfaces over public v3 contracts.
- `redeven:internal/ai/thread_create_operation.go` - Drives create replay and canonical binding from stable client identity.
- `redeven:internal/ai/thread_fork_operation.go` - Drives fork replay and destination materialization.
- `redeven:internal/ai/send_user_turn.go` - Starts a turn without caller-supplied canonical turn or run identity.
- `redeven:internal/ai/floret_runtime.go` - Binds `TurnAdmissionReceipt` before receipt-only `ExecuteAdmission`.
- `redeven:internal/ai/floret_events.go` - Treats committed-user events as observation, not admission binding.
- `redeven:internal/ai/queued_turns.go` - Implements exact replay and recovery settlement.
- `redeven:internal/ai/queued_turns_exact_read_test.go` - Covers strict mutation-receipt and exact-read recovery evidence.
- `redeven:internal/ai/floret_thread_projection.go` - Maps validated canonical projections without shadow storage.
- `redeven:internal/ai/subagents_floret.go` - Uses parent-bound canonical child capabilities.
- `redeven:internal/ai/floret_store_maintenance.go` - Opens only the current published Floret storage contract.
- `redeven:go.mod` - Pins the published Floret v3 module.
