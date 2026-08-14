---
type: AI Persistence Contract
title: Flower thread fork coordination
description: Floret forks canonical Agent state first, then Redeven materializes a fixed host-settings and thread-resource snapshot.
tags: [ai, threads, persistence, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns the forked journal, title, lifecycle, turns, projections, todos, context, and SubAgent state; Redeven owns copied host settings, thread-level upload ownership, and product routing.
- Outcome: one replayable operation creates one fixed destination without copying or persisting a Floret rewrite result.
- Invariants: product materialization uses the prepared snapshot, not live source state; a pending fork claims both source and destination against product writes and competing create/fork intent; upload ownership is copied at thread scope only.
- Failure boundary: identity conflicts fail explicitly; transient Floret or product commit errors remain replayable under the same operation id.

# Contract

`PrepareForkOperation` runs under the source thread lifecycle gate. Before preparation, Redeven exhaustively keyset-pages queued commands and exact-reads only rows that already carry Floret-assigned TurnID values. An admitted command settles; typed not-found leaves the unadmitted command unchanged; any other canonical read or host settlement failure aborts without creating a new fork operation. It then rejects active runs, finalization, and idle compaction, validates source settings, and persists an immutable snapshot in `ai_thread_fork_operations`, keyed by a stable product operation id and `client_request_id`. The snapshot contains source `ThreadSettings`, thread-owned upload refs, product routing, explicit title intent, and host audit identity. The canonical destination is empty at preparation time. Product routing is limited to home runtime, runtime kind, origin environment, primary target, active target ids, and update time. It contains no Agent owner, parent, action, context, conversation, title copy, turn/run state, projection, approval, todo, provider state, tool lifecycle, or Floret result.

Snapshot replay accepts only the strict first-release snapshot shape. It verifies operation-row identity, `client_request_id`, source settings identity, request fingerprint, and a second fingerprint over the complete immutable snapshot before calling Floret or materializing settings. Unknown fields, trailing JSON values, empty payloads, identity drift, request drift, and any source-settings/resource/routing payload drift fail closed. There is no legacy snapshot migration or compatibility parser. Once preparation succeeds, the source rejects settings, queue, admission, upload-ownership, permission-audit, and product-routing writes until the operation commits. After Floret binds the canonical destination, that destination rejects competing settings or lifecycle writes. Replay of the same request remains idempotent.

Redeven calls Floret v4 typed `Fork` with the source ThreadID and stable request key. Floret assigns and canonically records the destination child identity; Redeven then materializes only its product catalog row and resource ownership for that exact returned thread. A repeated request returns the same canonical destination without creating another thread.

After canonical fork succeeds, one Redeven transaction materializes destination settings from the fixed snapshot, copies thread-level upload ownership to the destination thread, copies product routing, and advances the product stage. The independent title stage then converges through its own LogicalRequestID before the operation becomes completed. No source reread can change a pending operation. Restart replay uses the same request identities, verifies the same Floret destination, and resumes only the incomplete saga stage.

Committed source and destination summary publication is separately acknowledged and may be retried. Each summary must still resolve current host settings plus public Floret canonical state before broadcast.

# Boundaries

Redeven never stores a source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. It does not create conversation rows, infer a title from preview text, silently omit malformed resources, compensate by deleting a valid Floret destination, treat an unrelated existing destination as recovery success, or let source product state mutate around a pending snapshot.

# Evidence

- `redeven:internal/ai/threadstore/fork_operation.go` - The fork receipt stores stable product and Floret request identities, a nullable canonical destination, immutable host snapshot, and saga stages.
- `redeven:internal/ai/threadstore/fork_operation.go:392` - Snapshot capture selects only thread-owned uploads.
- `redeven:internal/ai/thread_fork_operation.go:41` - Replay forks Floret and applies explicit title before product commit.
- `redeven:internal/ai/threadstore/fork_operation.go:488` - Product materialization uses the immutable snapshot and persists no Floret result.
- `redeven:internal/ai/thread_fork_operation_test.go:91` - Restart tests recover canonical-first fork boundaries.
- `redeven:internal/ai/thread_lifecycle_gate_test.go:215` - Deterministic tests cover operation-first lifecycle serialization.
- `redeven:internal/ai/thread_lifecycle_gate_test.go:254` - Deterministic tests cover admission-first lifecycle serialization.
- `redeven:internal/ai/thread_lifecycle_gate_test.go:309` - Deterministic tests prove failed settlement keeps exclusive lifecycle work blocked.
