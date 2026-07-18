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
- Invariants: product materialization uses the prepared snapshot, not live source state, and upload ownership is copied at thread scope only.
- Failure boundary: identity conflicts fail explicitly; transient Floret or product commit errors remain replayable under the same operation id.

# Contract

`PrepareForkOperation` validates the source settings and unused destination, fingerprints the request, and persists snapshot schema v2 in `ai_thread_fork_operations`, keyed by the stable `ForkOperationID`. The snapshot contains the source `ThreadSettings`, thread-owned upload refs, Flower routing metadata, destination identity, explicit title intent, and host audit identity. It contains no conversation, title copy, turn/run state, projection, approval, todo, context, provider state, tool lifecycle, or Floret result.

Replay calls Floret `ForkThread` first with the stable operation id and planned destination. The returned result is checked only for operation and destination identity; Redeven does not consume or persist turn/run rewrite maps because admitted attachments use thread-level ownership. If the user supplied a destination title, Redeven calls Floret `SetThreadTitle`; otherwise the canonical Floret fork title remains unchanged.

After canonical fork and optional title succeed, one Redeven transaction materializes destination settings from the fixed snapshot, copies thread-level upload ownership to the destination thread, updates Flower routing metadata, clears the snapshot payload, and marks the operation committed. No source reread can change a pending operation. Restart replay calls Floret again with the same operation id and then retries the same product commit.

Committed source and destination summary publication is separately acknowledged and may be retried. Each summary must still resolve current host settings plus public Floret canonical state before broadcast.

# Boundaries

Redeven never stores a `ForkedTurnRef`, Floret fork result, canonical title, or Agent lifecycle snapshot. It does not create conversation rows, infer a title from preview text, silently omit malformed resources, compensate by deleting a valid Floret destination, or treat an unrelated existing destination as recovery success.

# Evidence

- `redeven:internal/ai/threadstore/fork_operation.go:57` - Snapshot schema v2 contains host settings, thread upload refs, routing metadata, and user intent only.
- `redeven:internal/ai/threadstore/fork_operation.go:342` - Snapshot capture selects only thread-owned uploads.
- `redeven:internal/ai/thread_fork_operation.go:16` - Replay forks Floret and applies explicit title before product commit.
- `redeven:internal/ai/threadstore/fork_operation.go:148` - Product materialization uses the immutable snapshot and persists no Floret result.
- `redeven:internal/ai/thread_fork_operation_test.go:14` - Restart tests recover canonical-first fork boundaries.
