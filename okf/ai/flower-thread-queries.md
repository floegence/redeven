---
type: Integration Contract
title: Flower canonical thread queries
description: Authorize canonical active-path search, counts and bounded content reads through released Floret tools.
tags: [flower, floret, tools, authorization, queries]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret v7.32.0 owns the canonical journal and its derived in-memory index.
Redeven exposes `threads.query`, `threads.read` and `threads.aggregate` as
read-only mappings to optional `runtime.ThreadQueryReader`. Every invocation
rebuilds the current readable scope before search, sorting, counting or reading.
References never grant access. Expired or invalidated cursors fail explicitly;
the model can narrow its query or start again.

# Contract

## Authorization owner
Authenticated session authority supplies read permission, user, endpoint and namespace identity. These fields plus user identity bind the upstream scope; tool schemas cannot accept model-authored authority. Redeven never reads Floret SQL, canonical records or internal packages, and offers no arbitrary SQL tool.

## Query and content boundary
The upstream public `threadquery` types define objects, filters, sorting, aggregation and pagination.

Schema-invalid keys enter its bounded correction path before tool dispatch and do not create visible failed Activity rows.

Historical results remain readable after restart even when original query refs have expired.

## Index and snapshots
The canonical log owner rebuilds its derived index after startup verification and updates it only after successful canonical commits.

A new query uses current authority and never silently expands the old scope.

# Boundaries

Only published Floret contracts can supply canonical content. This capability adds no product persistence or runtime lifecycle.

# Evidence

- [Released dependency pin](../../go.mod) and [dependency gate](../../scripts/check_floret_dependency_boundary.sh).

- [Typed query tools](../../internal/ai/thread_query_tools.go), [exact run capabilities](../../internal/ai/run_host_capabilities.go) and [product metadata scope](../../internal/ai/threadstore/store.go).

- [Authorization and frozen replay tests](../../internal/ai/thread_reference_query_test.go).
