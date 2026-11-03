---
type: AI Persistence Contract
title: Flower thread fork coordination
tags: [ai, threads, persistence, floret]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret owns Fork journal/destination; Redeven authorizes source/endpoint and adopts settings. One stable request may title that exact destination. Invalid/foreign/conflicting/failed requests stop explicitly; no product saga, canonical copy, recovery coordinator or compensating deletion.

# Contract

`ForkThreadWithOptions` validates RWX access, the source ThreadID, endpoint identity, and a stable `client_request_id`. The shared endpoint/thread authority boundary must find a live product settings row for that exact endpoint before any Floret call.

An optional `source_item_id` selects a committed assistant answer on the active path. Floret retains that answer and its preceding history while excluding later items. Answer-level Fork supplies this anchor; thread-list Fork omits it and retains the current full path. Invalid or uncommitted anchors fail explicitly.

Detail recovery retains the created destination and retries loading only.

# Boundaries

Redeven never stores a fork saga, source/destination turn or run identity mapping, Floret fork result, canonical title, or Agent lifecycle snapshot. Product adoption cannot authorize a foreign source, choose a different destination, reconstruct canonical content, or compensate by deleting a valid Floret destination.

# Evidence

- `redeven:internal/ai/threads.go` - Source.
- `redeven:internal/ai/threadstore/orphan_adoption_test.go` - Tests.
