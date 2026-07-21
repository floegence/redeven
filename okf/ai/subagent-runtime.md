---
type: AI Tool Contract
title: Flower subagent runtime
description: Floret-owned child threads, strict spawn input, delegated permission audit, membership, and detail.
tags: [ai, floret, subagents, permissions]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns every SubAgent child thread, parent-child relationship, task metadata, lifecycle, messages, activity, and detail events.
- Outcome: Redeven exposes product tools and UI mappings over Floret public APIs without creating child thread rows or a second child identity.
- Invariants: `ThreadID` is the only public Agent identity; spawn requires explicit `task_name`, `task_description`, `agent_type`, and `message`.
- Failure boundary: missing/invalid spawn fields, title/objective aliases, parent-child mismatch, permission refresh failure, and malformed Floret detail fail explicitly.

# Contract

The `subagents` tool supports `spawn`, `send_input`, `wait`, `list`, `inspect`, `close`, and `close_all`. Spawn accepts one canonical shape: `task_name`, `task_description`, `agent_type`, `message`, and optional `context_mode`. `title` and `objective` are rejected; Redeven does not derive a task name from description, message, objective, role, or agent type. `mission_only` maps to no inherited path and `full_history` maps to the Floret full-path fork mode.

Redeven calls published Floret v0.22.0 `SpawnSubAgent`, `SendSubAgentInput`, `WaitSubAgents`, `ListSubAgents`, `ReadSubAgentDetail`, and `CloseSubAgent`. `close_all` is a Redeven tool action that enumerates canonical children and closes each exact child through the active parent-bound `SubAgentHost`; there is no bulk maintenance API or recovery fallback. Child `ThreadID` is used in model results, Flower `thread.subagents`, activity routing, detail URLs, and Floret approval identity. There is no public or persisted `subagent_id` alias. Floret issues interactive and read capabilities bound to one canonical parent; root thread reads reject child journals, and the unified `ThreadDetailEvent` contract remains the only detail DTO. Redeven maps those canonical facts without a duplicate SubAgent event shape or missing-parent substitute.

Spawn derives the Floret `PublicationID`, child `ThreadID`, and product child-run audit identity deterministically from the exact parent thread, parent turn, and spawning tool call. `send_input` derives `InputRequestID` from the parent thread, canonical child thread, and input tool call. Retrying the same admitted tool operation therefore reuses the same Floret idempotency identity; a different parent, turn, child, or tool call cannot collide.

Because Floret and Redeven use separate stores, spawn uses one narrow publication coordinator. One Redeven transaction writes the provisional permission audit and a pending operation containing the exact Floret request, request hash, host session intent, and model/reasoning selection needed for deterministic replay. The same idempotent `SpawnSubAgent` request is used by the live runtime and startup recovery. After Floret returns the exact canonical child, one Redeven transaction finalizes the permission audit, marks the operation committed, and clears request, session, model, and reasoning payloads. The remaining committed row contains only operation identity and cannot rebuild child messages, status, membership, or lifecycle. A crash before finalization therefore replays known intent rather than scanning canonical children, guessing ownership, or leaving an unusable provisional audit.

Each child provider step and local tool dispatch rebuilds its tool surface from the current parent thread permission. Current permission is read from Redeven settings and must succeed. The exact permission snapshot version 2 is persisted as append-only security audit before execution. Child effect execution first proves canonical parent-child membership and exact finalized child run identity, then binds the parent policy authority and child invocation through the shared lifecycle gate. The audit's original `ParentRunID` records creation lineage only; a durable child remains usable from later turns of the same canonical parent thread. Its executable run requires the gate plus terminal resources bound to the exact child thread; it cannot access the root or a sibling, copy the root host bundle, query arbitrary child process resources, or derive another resource or lifecycle capability. Schema/policy calculation uses a separate non-executable object. These audit ids do not replace Floret `ThreadID`, `TurnID`, or `RunID` and cannot reconstruct child lifecycle.

Parent cancellation and terminal failure close unfinished descendants through Floret lifecycle APIs; data deletion is handled only by the canonical thread delete coordinator. Parent header membership comes from `ListSubAgents`, and parent-scoped detail comes from `ReadSubAgentDetail`. Redeven does not query Floret SQLite, persist child membership, or infer membership from timeline activity.

Model-facing wait/list/inspect results remain bounded summaries. Human detail is a read-only parent-scoped view over Floret detail events and canonical activity. Neither surface injects raw child transcripts, commands, stdout/stderr, local paths, or debug fields into the parent model by default.

# Boundaries

Task names are required labels, not storage identities. Redeven must not accept legacy aliases, guess names, create child `ThreadSettings`, duplicate parent-child rows, or use permission audit as current policy or lifecycle state.

# Evidence

- `redeven:internal/ai/builtin_tool_handlers.go:409` - The tool schema exposes one strict spawn shape.
- `redeven:internal/ai/run_extensions.go:154` - Spawn validation rejects title/objective aliases and requires canonical fields.
- `redeven:internal/ai/subagents_floret.go:1052` - Redeven maps strict spawn input to the Floret public request.
- `redeven:internal/ai/subagents_floret.go:2363` - Spawn identities are deterministic and scoped to exact parent, turn, and tool-call authority.
- `redeven:internal/ai/subagents_floret.go:2375` - Child input request identities are deterministic and scoped to the exact child authority.
- `redeven:internal/ai/threadstore/permission_snapshot.go:179` - Child permission snapshots are append-only audit records with explicit identities.
- `redeven:internal/ai/threadstore/subagent_publication.go:40` - Pending publication intent and permission audit prepare/finalize atomically, then payload is cleared.
- `redeven:internal/ai/subagent_publication_recovery.go:53` - Startup rebuilds only the exact pending request and reuses Floret publication idempotency.
- `redeven:internal/ai/run_host_capabilities.go:82` - Child execution receives exact terminal resource authority and no further derivation capability.
- `redeven:internal/ai/types.go:173` - Public child summaries use `thread_id` without a second Agent id.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:511` - Flower SubAgent contracts use canonical child thread identity.
