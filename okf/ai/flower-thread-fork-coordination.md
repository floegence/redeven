---
type: AI Persistence Contract
title: Flower thread fork coordination
description: Redeven authorizes a source thread, selects a full-thread or answer-anchored Floret fork, and adopts settings for the canonical destination.
tags: [ai, threads, persistence, floret]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-21"
---
# Summary

Floret owns journal/destination identity; Redeven authorizes endpoint/source and adopts destination settings. One stable request optionally titles that returned destination only. No product fork receipt/saga/canonical copy. Invalid request, foreign source, Floret failure or conflicting settings fails explicitly, without a recovery coordinator or compensating canonical deletion.

# Contract

`ForkThreadWithOptions` validates RWX access, the source ThreadID, endpoint identity, and a stable `client_request_id`. The shared endpoint/thread authority boundary must find a live product settings row for that exact endpoint before any Floret call.

An optional `source_item_id` selects a committed assistant answer on the active path. Floret retains that answer and its preceding history while excluding later items. Answer-level Fork supplies this anchor; thread-list Fork omits it and retains the current full path. Invalid or uncommitted anchors fail explicitly.

Detail recovery retains the created destination and retries loading only.

# Boundaries

Redeven never stores a fork saga, source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. Product adoption cannot authorize a foreign source, choose a different destination, reconstruct canonical content, or compensate by deleting a valid Floret destination.

# Evidence

- `redeven:internal/ai/threads.go` - Authorizes the source, calls typed Floret Fork, adopts returned product settings, and applies an optional title.

- `redeven:internal/ai/threadstore/orphan_adoption_test.go` - Covers exact adoption and conflict handling.
