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

`ForkThreadWithOptions` validates RWX access, the source ThreadID, endpoint identity, and a stable `client_request_id`. The shared endpoint/thread authority boundary must find a live product settings row for that exact endpoint before any Floret call. Redeven then reads the source's current product settings and invokes published Floret v4 `Fork` with the source ThreadID and client request key.

Floret returns the canonical destination. Redeven copies only product-owned settings into a new root settings value, preserves the source endpoint, namespace, model, reasoning selection, permission, and working directory, clears pin state, and records the current requesting user as the destination creator/updater. `AdoptCanonicalRootSettings` inserts that exact destination or accepts an identical existing record; a conflicting record fails closed. A non-empty requested title is then sent through typed `SetTitle` with a derived stable key.

The response is rebuilt from the returned Floret current view plus the adopted product settings. There is no durable fork operation table, immutable resource snapshot, lifecycle gate, stage replay, upload-copy protocol, summary acknowledgement receipt, or fork recovery coordinator. Product settings adoption is deliberately small; canonical fork idempotency remains owned by Floret's request key.

# Boundaries

Redeven never stores a fork saga, source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. Product adoption cannot authorize a foreign source, choose a different destination, reconstruct canonical content, or compensate by deleting a valid Floret destination.

# Evidence

- `redeven:internal/ai/threads.go:807` - Authorizes the source, calls typed Floret Fork, adopts returned product settings, and applies an optional title.
- `redeven:internal/ai/threadstore/orphan_adoption.go` - Inserts exact canonical-root settings idempotently and rejects conflicting settings.
- `redeven:internal/ai/threadstore/orphan_adoption_test.go` - Covers exact adoption and conflict handling.
- `redeven:internal/ai/thread_authority_boundary_test.go` - Proves foreign endpoint ThreadIDs fail before canonical mutation.
- `redeven:internal/session/floret_v4_dependency_contract_test.go` - Enforces the released typed v4 dependency boundary.
