---
type: AI Persistence Contract
title: Flower thread fork coordination
description: Floret forks canonical Agent state first, then Redeven materializes a fixed host-settings and thread-resource snapshot.
tags: [ai, threads, persistence, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns the forked journal, title, lifecycle, turns, projections, todos, context, and SubAgent state; Redeven owns copied host settings, thread-level upload ownership, and Flower routing metadata.
- Outcome: one replayable operation creates one fixed destination without copying or persisting a Floret rewrite result.
- Invariants: product materialization uses the prepared snapshot, not live source state; a pending fork claims both source and destination against product writes and competing create/fork intent; upload ownership is copied at thread scope only.
- Failure boundary: identity conflicts fail explicitly; transient Floret or product commit errors remain replayable under the same operation id.

# Contract

`PrepareForkOperation` runs under the source thread lifecycle gate. Before preparation, Redeven lists the canonical Floret turns once and settles every queued command whose exact `TurnID` is already admitted; any canonical read or host settlement failure aborts without creating a new fork operation. It then rejects active runs, finalization, and idle compaction, validates source settings and the unused destination, and persists snapshot schema v2 in `ai_thread_fork_operations`, keyed by the stable `ForkOperationID`. Run and compaction admission use the same gate and must recheck source writability before registering, so a pending fork cannot race with a newly admitted canonical turn. The snapshot contains source `ThreadSettings`, thread-owned upload refs, Flower routing metadata, destination identity, explicit title intent, and host audit identity. It contains no conversation, title copy, turn/run state, projection, approval, todo, context, provider state, tool lifecycle, or Floret result.

Snapshot replay accepts only strict schema-v2 JSON. It verifies operation-row identities, source settings identity, the request fingerprint, and a second fingerprint over the complete immutable snapshot before calling Floret or materializing settings. Unknown fields, trailing JSON values, empty payloads, identity drift, request drift, and any source-settings/resource/routing payload drift fail closed. Once preparation succeeds, the source rejects settings, queue, admission, upload-ownership, permission-audit, and Flower routing writes until the operation commits. The destination rejects settings creation and other writes, and a pending create rejects a fork targeting the same destination. Replay of the same request remains idempotent.

Replay calls Floret `ForkThread` first with the stable operation id and planned destination. The returned result is checked only for operation and destination identity; Redeven does not consume or persist turn/run rewrite maps because admitted attachments use thread-level ownership. If the user supplied a destination title, Redeven calls Floret `SetThreadTitle`; otherwise the canonical Floret fork title remains unchanged.

After canonical fork and optional title succeed, one Redeven transaction materializes destination settings from the fixed snapshot, copies thread-level upload ownership to the destination thread, updates Flower routing metadata, clears the snapshot payload, and marks the operation committed. No source reread can change a pending operation. Restart replay calls Floret again with the same operation id and then retries the same product commit.

Committed source and destination summary publication is separately acknowledged and may be retried. Each summary must still resolve current host settings plus public Floret canonical state before broadcast.

# Boundaries

Redeven never stores a source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. It does not create conversation rows, infer a title from preview text, silently omit malformed resources, compensate by deleting a valid Floret destination, treat an unrelated existing destination as recovery success, or let source product state mutate around a pending snapshot.

# Evidence

- `redeven:internal/ai/threadstore/fork_operation.go:57` - Snapshot schema v2 contains host settings, thread upload refs, routing metadata, and user intent only.
- `redeven:internal/ai/threadstore/fork_operation.go:342` - Snapshot capture selects only thread-owned uploads.
- `redeven:internal/ai/thread_fork_operation.go:16` - Replay forks Floret and applies explicit title before product commit.
- `redeven:internal/ai/threadstore/fork_operation.go:148` - Product materialization uses the immutable snapshot and persists no Floret result.
- `redeven:internal/ai/thread_fork_operation_test.go:14` - Restart tests recover canonical-first fork boundaries.
- `redeven:internal/ai/thread_lifecycle_gate_test.go:54` - Deterministic tests cover operation-first, admission-first, and failed-settlement serialization.
