---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Turn admission, timeline, deletion, control signals, store, and published Floret ownership.
tags: [ai, floret, threads, runtime]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Floret is the durable authority for admitted conversation entries, turn/run identity, canonical ordering, projections, control signals, todos, and provider state. Redeven stores only product metadata and pre-admission coordination, maps validated Floret snapshots into Flower, and performs deletion or maintenance through public Floret hosts. Builds and tests consume published Floret releases only and never query Floret-managed tables directly.

# Contract

## Mechanism

User-turn admission has two explicit phases. Before admission, Redeven may persist a `pending_turn_command` with pre-generated opaque `TurnID` and `RunID`, prompt text, product resource references, and launch options. A validated Floret `thread_entry_committed` user-entry event atomically transfers queued product upload references to opaque turn references and deletes the pending prompt for that exact command/turn identity. If the process stops between Floret commit and local cleanup, restart reconciliation calls `ListThreadTurns` and deletes the command only when that exact `TurnID` exists; it never infers admission from local run state, audit events, or timestamps. The transaction is idempotent, and an identity mismatch leaves both prompt and queued references unchanged. Once admitted, the user input, user entry ID, run lifecycle, assistant projection, waiting state, failure, and ordinal exist only in Floret. Secret answers are never persisted in plaintext by either threadstore or Floret and travel only through short-lived memory or a vault reference.

Thread deletion is a data-lifecycle transaction, while forced cancellation remains an immediate execution-lifecycle response. Redeven can detach and cancel a stuck in-memory run, then atomically delete product rows while persisting the immutable cleanup operation that removes files, the Floret thread tree, and Flower read state. Late product writes verify their parent thread inside the same transaction. Floret journal, tool, context, and provider state are deleted together only through Floret's public thread deletion contract.

Flower timeline history is a direct mapping of Floret `ListThreadTurns`, whose pages are already ordered by canonical turn ordinal. For each `ThreadTurnSnapshot`, Redeven emits the Floret `UserEntryID` user row, then maps that turn's validated `ThreadTurnProjection` to the assistant row and product decorations. `ReadThread` supplies canonical thread status, latest run, update time, and through ordinal for thread summaries. Redeven does not sort by timestamp or ID, correlate separate rows, read Floret SQLite, or synthesize assistant content from run errors, audit data, provider deltas, previews, or drafts. `turn_projection_unavailable` is emitted only when a valid public turn snapshot cannot be rendered. A live draft exists only in memory and is keyed by the exact `ThreadID`/`TurnID`/`RunID`; it may replace only the assistant slot of that canonical turn, is deleted when the terminal projection arrives, and any identity or ordinal mismatch requests resynchronization instead of appending the draft at the tail. The Flower reducer replaces its message array in server order and performs no client message sorting.

Published Floret v0.11.4 exposes provider-free `ReadThread`, `ReadLatestThreadTurn`, and before/after/tail `ListThreadTurns` together with projection availability, context, pending approval, and typed Agent todo contracts. Marker-only turns remain outside public turn reads unless their canonical user entry is committed, while the thread through ordinal still covers the complete read boundary. `TurnResult.Validate()`, `PendingToolSettlementResult.Validate()`, `CompactThreadResult.Validate()`, `Event.Validate()`, `ThreadSnapshot.Validate()`, `PendingApprovals.Validate()`, `PendingApproval.Validate()`, and turn-page validation own lifecycle, identity, nested observation, projection, control signal, approval, and ordering consistency. Redeven consumes those contracts and adds only product identity checks and presentation mapping. Floret's todo read and compare-and-swap update APIs are the sole `write_todos` state path, including version and updating turn/run/tool identity; thread fork and delete carry todo state inside Floret. Redeven has no todo, thread-state, memory, or open-goal database representation.

Floret control signals are canonical lifecycle facts rather than ordinary tool calls. `ask_user`, `task_complete`, and custom control signals never receive synthetic tool results; Redeven maps a validated waiting signal payload to the in-memory Flower interaction surface and keeps only the product policy that decides whether confirmation is required. Redeven has no task-completion validity gate and does not persist waiting-prompt or task-completion lifecycle.

Flower execution uses the published Floret runtime package through `runFloretHostedTurn` and `flruntime.Host`. One SQLite Floret Store is opened per Service and shared by ordinary turns, idle compaction, subagents, and maintenance hosts; those facades never close it, and `Service.Close` releases running resources before closing the Store once. Every production host sets `ThreadTitleModeHostOwned`. Redeven passes current input, `RunTurnRequest.SupplementalContext` containing typed `TurnSupplementalContextItem` values such as `attachment_metadata`, tool/control contracts, the direct wire adapter, gateway identity, and loop limits; it does not pass provider-visible history or previous provider state. Floret loads continuation internally and supplies it to the adapter through `ModelRequest.PreviousState`.

# Boundaries

Redeven must consume published Floret releases. Repository builds, tests, Desktop runs, and release validation must not depend on a sibling checkout, Go workspace, local replace directive, or package-manager local link. The runtime boundary depends on published `github.com/floegence/floret` v0.11.4, including shared Store ownership, canonical thread and latest-turn timeline reads, typed approval validation, typed todo CAS, validated control signals, context, pending settlement, explicit thread/turn/run identity, subagent lifecycle, replayable `ForkThread`, and cascading thread deletion. Redeven must not import Floret `internal/`, query Floret-managed tables, or persist mapped conversation, run, projection, control, approval, todo, context, provider, or tool state.

# Evidence

- `redeven:internal/ai/builtin_tool_handlers.go:18` - Tool success summaries are normalized by builtin name or semantic activity category.
- `redeven:internal/ai/run.go:2833` - Explicit target policy forwards eligible tools through the target executor.
- `redeven:internal/ai/floret_events.go:42` - Flower applies streaming, committed thread-entry, and source observations from Floret runtime events.
- `redeven:internal/ai/floret_thread_projection.go:12` - Flower assistant blocks are mapped from Floret `ThreadTurnProjection` segments.
- `redeven:internal/ai/floret_runtime.go:207` - Completed Floret turns apply `TurnResult.Projection` before final lifecycle projection.
- `redeven:internal/ai/floret_control.go:36` - Floret core control signals are projected only for `task_complete` and `ask_user`.
- `redeven:go.mod:9` - Redeven depends on the published Floret module version.
- `redeven:internal/ai/threadstore/fork_operation.go:176` - Fork preparation captures and persists the fixed product snapshot before Floret execution.
- `redeven:internal/ai/thread_fork_operation.go:130` - Background maintenance replays pending fork operations with their durable operation identities.
- `redeven:internal/ai/threadstore/store.go:3219` - Run writes verify the parent product thread in the same transaction.
- `redeven:internal/ai/threads_hard_cancel_test.go:60` - Force deletion is tested against a blocked run that resumes late persistence after deletion.
- `redeven:internal/ai/service.go:394` - The service caches a thread-scoped Floret subagent runtime and attaches each new parent run to it.
- `redeven:internal/ai/subagents_floret.go:129` - The Redeven subagent runtime dispatches validated actions to the Floret host lifecycle.
- `redeven:internal/flower_ui/src/flowerSubagentProjection.ts:180` - The shared UI projection derives sorted subagent dropdown items only from `thread.subagents`.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:6433` - The selected parent thread header renders the grouped Sub Agents dropdown.
- `redeven:internal/ai/threadstore/schema.go:12` - The product-only threadstore schema migrates known ai_threadstore_canonical shapes transactionally, removes Agent shadow tables and columns, and rejects unknown kinds or future versions.
- `redeven:internal/ai/run_extensions.go:82` - Subagent tool dispatch passes the invoking Floret tool call id into the subagent runtime.
- `redeven:internal/ai/thread_actor.go:659` - Active runs and stop-finalizing guards queue the next user turn instead of starting immediately.
- `redeven:internal/ai/subagent_task_name.go:36` - Redeven resolves current and legacy subagent name inputs into one bounded human-facing English task name before Floret spawn.
- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts:165` - The Env adapter maps the environment profile and an exposed Desktop catalog into the same settings snapshot.
