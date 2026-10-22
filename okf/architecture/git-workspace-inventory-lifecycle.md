---
type: Runtime Contract
title: Git workspace inventory lifecycle
description: Bound Git workspace capture, immutable revisions, resource admission, mutation coordination, and destructive linked-worktree removal.
tags: [architecture, git, runtime, filesystem, transport]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven exposes Git workspace state as bounded, immutable, process-local inventory snapshots. Fresh queries stream Git porcelain output into an admitted snapshot; paged and path-scoped reads bind an exact revision. Git and Files mutations coordinate against the same repository and topology authority, invalidate all affected snapshots before and after effects, and never use display state to authorize a mutation. Oversized, stale, malformed, or resource-exhausted work fails closed with a small typed Git error while the Flowersec session remains usable.

# Contract

## Inventory
Workspace capture reads NUL-delimited porcelain v2 incrementally. Token, record, canonical-path, retained-heap, subprocess, capture, and published-cache limits are admitted before retained capacity grows beyond its reservation.

Stable filesystem identity prevents a deleted and recreated path from inheriting an older coordinator or revision.

## Query and wire
`git.getCapabilities` advertises revisioned workspace pages, path-scoped status, directory scope, and stash-section diff support. `git.listWorkspacePathStatuses` accepts only a bounded set of already-known paths and returns file rows or aggregate directory counts without descendant arrays.

It does not claim a general bound for non-Git outbound responses or notifications; transport-wide lifecycle remains owned by the published Flowersec v5.10.3 release.

## Mutation coordination
The Agent owns one Git runtime shared by direct sessions. A cancellable topology gate, active-worktree registry, canonical repository lock order, per-repository fair read/write coordination, epochs, process admissions, snapshot storage, and destructive-scan admission form one lifecycle.

Descendants that deliberately escape the process group remain an explicit operating-system boundary; their existence does not permit an unbounded handler or retained pipe.

## Linked worktree removal
Linked-worktree lists and previews expose summary state rather than full file arrays. The root Git control entry is excluded only after its type, exact contents when applicable, canonical target, and filesystem identity match the already resolved Git directory.

Hostile external writers and metadata outside the portable fingerprint, including ACLs, extended attributes, resource forks, and alternate data streams, are explicit non-transactional boundaries.

# Boundaries

Git remains authoritative for repository and workspace state; snapshots are process-local read models and never authorize mutations. Floret, ReDevPlugin, Flowersec transport internals, non-Git outbound RPC allocation, and operating-system processes that deliberately escape the supervised process group remain outside this runtime's ownership.

# Evidence

- `redeven:internal/gitrepo/workspace.go` - Captures workspace state and projects revision-bound pages.

- `redeven:internal/gitrepo/workspace_paths.go` - Serves bounded path-scoped status and directory aggregates.

- `redeven:internal/gitrepo/service.go` - Registers Git RPC handlers, capabilities, errors, and mutation entrypoints.
