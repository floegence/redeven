---
type: AI Persistence Contract
title: Flower thread fork coordination
description: Redeven authorizes a source thread, calls Floret's typed fork, and adopts product settings for the returned canonical destination.
tags: [ai, threads, persistence, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: Floret owns the forked journal and canonical destination identity; Redeven owns endpoint authorization and the destination's product settings.
- Outcome: one stable client request forks the authorized source, adopts settings for the returned destination, and optionally sets an explicit title.
- Invariants: source ownership is proven before Floret mutation, the returned destination is the only product adoption target, and the product stores no fork receipt, saga, or canonical lifecycle copy.
- Failure boundary: invalid request identity, foreign source authority, Floret failure, or conflicting destination settings fails explicitly without a recovery coordinator or compensating canonical delete.

# Contract

`ForkThreadWithOptions` validates RWX access, the source ThreadID, endpoint identity, and a stable `client_request_id`. The shared endpoint/thread authority boundary must find a live product settings row for that exact endpoint before any Floret call. Redeven then reads the source's current product settings and invokes published Floret v7 `Fork` with the source ThreadID and client request key.

Floret returns the canonical destination. Redeven copies only product-owned settings into a new root settings value, preserves the source endpoint, namespace, model, reasoning selection, permission, and working directory, clears pin state, and records the current requesting user as the destination creator/updater. `AdoptCanonicalRootSettings` inserts that exact destination or accepts an identical existing record; a conflicting record fails closed. A non-empty requested title is then sent through typed `SetTitle` with a derived stable key.

The response is rebuilt from the returned Floret current view plus the adopted product settings. There is no durable fork operation table, immutable resource snapshot, lifecycle gate, stage replay, upload-copy protocol, summary acknowledgement receipt, or fork recovery coordinator. Product settings adoption is deliberately small; canonical fork idempotency remains owned by Floret's request key.

The shared Flower UI freezes the client request identity and localized branch
title together until creation is acknowledged. It reserves room for the branch
suffix within Floret's 200-rune title limit and sends the title through the
existing fork request. After settings adoption and title assignment, the
service schedules the canonical summary publisher so other windows see the
destination without polling.

Creation returns a summary independently of detail loading. Flower inserts and
selects that summary immediately and announces success. A failed detail read
keeps the destination available and retries only detail, never the fork command.
Untitled persisted threads use a localized display label plus a short ThreadID;
that label is presentation only and never replaces the canonical title. Existing
forks are not deleted or rewritten. New forks receive canonical fallback titles
from published Floret v7.3.4 even when a caller omits an explicit product title.

Published Floret v7.3.4 also owns canonical tool-call persistence across hosted
search boundaries. Engine execution and live projection use the same complete
call message and assistant fragment boundaries. Redeven consumes this upstream
correction without cleaning history, synthesizing results, or weakening tool
validation. Source threads and ordinary or nested forks created from corrected
history can continue after restart; existing corrupt histories are unchanged.

# Boundaries

Redeven never stores a fork saga, source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. Product adoption cannot authorize a foreign source, choose a different destination, reconstruct canonical content, or compensate by deleting a valid Floret destination.

# Evidence

- `redeven:internal/ai/threads.go:807` - Authorizes the source, calls typed Floret Fork, adopts returned product settings, and applies an optional title.
- `redeven:internal/ai/threadstore/orphan_adoption.go` - Inserts exact canonical-root settings idempotently and rejects conflicting settings.
- `redeven:internal/ai/threadstore/orphan_adoption_test.go` - Covers exact adoption and conflict handling.
- `redeven:internal/ai/thread_authority_boundary_test.go` - Proves foreign endpoint ThreadIDs fail before canonical mutation.
- `redeven:internal/session/floret_v7_dependency_contract_test.go` - Enforces the released typed v7 dependency boundary.
- `redeven:internal/ai/thread_fork_tool_history_test.go` - Exercises hosted search, two local calls, fork, restart, and continuation through the product service and published DeepSeek gateway.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.fork.test.shared.tsx` - Checks fork selection, continued input, completed replies, refresh, and live-stream reconnection in the shared UI.
