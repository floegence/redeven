---
type: AI Persistence Contract
title: Flower thread fork coordination
description: Redeven authorizes a source thread, calls Floret's typed fork, and adopts product settings for the returned canonical destination.
tags: [ai, threads, persistence, floret]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Floret owns the forked journal and canonical destination identity; Redeven owns endpoint authorization and the destination's product settings.
- Outcome: one stable client request forks the authorized source, adopts settings for the returned destination, and optionally sets an explicit title.
- Invariants: source ownership is proven before Floret mutation, the returned destination is the only product adoption target, and the product stores no fork receipt, saga, or canonical lifecycle copy.
- Failure boundary: invalid request identity, foreign source authority, Floret failure, or conflicting destination settings fails explicitly without a recovery coordinator or compensating canonical delete.

# Contract

`ForkThreadWithOptions` validates RWX access, the source ThreadID, endpoint identity, and a stable `client_request_id`. The shared endpoint/thread authority boundary must find a live product settings row for that exact endpoint before any Floret call.

Detail recovery retains the created destination and retries loading only.

# Boundaries

Redeven never stores a fork saga, source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. Product adoption cannot authorize a foreign source, choose a different destination, reconstruct canonical content, or compensate by deleting a valid Floret destination.

# Evidence

- `redeven:internal/ai/threads.go` - Authorizes the source, calls typed Floret Fork, adopts returned product settings, and applies an optional title.

- `redeven:internal/ai/threadstore/orphan_adoption.go` - Inserts exact canonical-root settings idempotently and rejects conflicting settings.

- `redeven:internal/ai/threadstore/orphan_adoption_test.go` - Covers exact adoption and conflict handling.
