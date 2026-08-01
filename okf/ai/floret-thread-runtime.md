---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Canonical Floret v3 identity, admission, recovery, projection, and runtime ownership.
tags: [ai, floret, threads, runtime]
timestamp: 2026-07-31T00:00:00Z
---
# Summary

- Authority: published Floret v3.0.3 owns canonical `ThreadID`, `TurnID`, `RunID`, journal state, titles, lifecycle, projections, approvals, todos, tools, SubAgents, artifacts, and provider continuation.
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

Floret v3.0.3 exposes turn admission as a two-step public contract. Redeven calls `AdmitTurn` with the frozen command, validates the returned `TurnAdmissionReceipt`, and in one threadstore transaction binds the previously empty canonical IDs, records the committed entry and permission-snapshot evidence, transfers upload ownership, consumes queued work, and advances the followup revision. Only after that product transaction commits does it configure in-memory run identity, publish canonical timeline replacement, mark presentation ready, and call `ExecuteAdmittedTurn` with the same receipt and command.

The eventual execution result rechecks terminal identity and releases execution authority; it is not the first admission boundary. A definite failure before receipt admission releases the in-flight command to an editable retry state and releases applicable staging ownership. A failure after canonical admission must not requeue the admitted user turn. An unknown transport outcome preserves the draft and stable client request identity so the caller can retry the exact operation.

Restart recovery reuses the same `LogicalRequestID`. A replayed committed mutation receipt may bind product state only after an exact canonical read verifies `LogicalRequestID`, thread, turn, run, committed user entry identity and kind, normalized command fingerprint, and permission proof. Recovery invokes the same transactional receipt binder as live admission. Missing fields, a non-replayed receipt, missing canonical state, fingerprint drift, permission mismatch, or partial identity blocks recovery; Redeven never invents IDs or reconstructs the user row from queue, audit, upload, or UI data.

## Runtime ownership and presentation

One composition-root `runtime.Host` opens the published Floret v3.0.3 storage source directly. It issues responsibility-specific create, title, fork, delete, read, turn, approval, todo, SubAgent, inventory, interrupted-turn recovery, and pending-tool recovery capabilities. `Service`, runs, and tool handlers retain only narrow local interfaces. Removed v2 storage cutover APIs and compatibility migration paths are absent.

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
- `redeven:internal/ai/floret_runtime.go` - Binds `TurnAdmissionReceipt` before `ExecuteAdmittedTurn`.
- `redeven:internal/ai/floret_events.go` - Treats committed-user events as observation, not admission binding.
- `redeven:internal/ai/queued_turns.go` - Implements exact replay and recovery settlement.
- `redeven:internal/ai/queued_turns_exact_read_test.go` - Covers strict mutation-receipt and exact-read recovery evidence.
- `redeven:internal/ai/floret_thread_projection.go` - Maps validated canonical projections without shadow storage.
- `redeven:internal/ai/subagents_floret.go` - Uses parent-bound canonical child capabilities.
- `redeven:internal/ai/floret_store_maintenance.go` - Opens only the current published Floret storage contract.
- `redeven:go.mod` - Pins the published Floret v3 module.
