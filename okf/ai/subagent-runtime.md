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

Redeven calls published Floret `SpawnSubAgent`, `SendSubAgentInput`, `WaitSubAgents`, `ListSubAgents`, `ReadSubAgentDetail`, `CloseSubAgent`, and `CloseSubAgents`. Child `ThreadID` is used in model results, Flower `thread.subagents`, activity routing, detail URLs, and delegated approval ownership. There is no public or persisted `subagent_id` alias. Floret v0.12.0 detail events use the same `ThreadDetailEvent` contract as ordinary thread detail; Redeven maps that canonical data without a duplicate SubAgent event DTO.

Each child provider step and local tool dispatch rebuilds its tool surface from the current parent thread permission. Current permission is read from Redeven settings and must succeed. The exact permission snapshot version 2 is persisted as append-only security audit before execution; child spawn first writes a provisional snapshot keyed by the real parent tool call id and finalizes it only after Floret returns the child thread and the explicit product child-run audit identity. These audit ids do not replace Floret `ThreadID`, `TurnID`, or `RunID` and cannot reconstruct child lifecycle.

Parent cancellation and terminal failure close unfinished descendants through Floret lifecycle APIs; data deletion is handled only by the canonical thread delete coordinator. Parent header membership comes from `ListSubAgents`, and parent-scoped detail comes from `ReadSubAgentDetail`. Redeven does not query Floret SQLite, persist child membership, or infer membership from timeline activity.

Model-facing wait/list/inspect results remain bounded summaries. Human detail is a read-only parent-scoped view over Floret detail events and canonical activity. Neither surface injects raw child transcripts, commands, stdout/stderr, local paths, or debug fields into the parent model by default.

# Boundaries

Task names are required labels, not storage identities. Redeven must not accept legacy aliases, guess names, create child `ThreadSettings`, duplicate parent-child rows, or use permission audit as current policy or lifecycle state.

# Evidence

- `redeven:internal/ai/builtin_tool_handlers.go:407` - The tool schema exposes one strict spawn shape.
- `redeven:internal/ai/run_extensions.go:153` - Spawn validation rejects title/objective aliases and requires canonical fields.
- `redeven:internal/ai/subagents_floret.go:894` - Redeven maps strict spawn input to the Floret public request.
- `redeven:internal/ai/permission_snapshot.go:94` - Child permission snapshots are append-only audit with explicit identities.
- `redeven:internal/ai/types.go:172` - Public child summaries use `thread_id` without a second Agent id.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:486` - Flower SubAgent contracts use canonical child thread identity.
