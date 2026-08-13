---
type: Runtime Contract
title: Git workspace inventory lifecycle
description: Bound Git workspace capture, immutable revisions, resource admission, mutation coordination, and destructive linked-worktree removal.
tags: [architecture, git, runtime, filesystem, transport]
timestamp: 2026-07-28T00:00:00Z
---
# Summary

Redeven exposes Git workspace state as bounded, immutable, process-local inventory snapshots. Fresh queries stream Git porcelain output into an admitted snapshot; paged and path-scoped reads bind an exact revision. Git and Files mutations coordinate against the same repository and topology authority, invalidate all affected snapshots before and after effects, and never use display state to authorize a mutation. Oversized, stale, malformed, or resource-exhausted work fails closed with a small typed Git error while the Flowersec session remains usable.

# Contract

## Inventory

Workspace capture reads NUL-delimited porcelain v2 incrementally. It does not recursively walk untracked directories, buffer an unbounded command response, or enrich every item with patch statistics. Token, record, canonical-path, retained-heap, subprocess, capture, and published-cache limits are admitted before retained capacity grows beyond its reservation. Cancellation, parser failure, Git failure, or any limit violation terminates and reaps the command and publishes no partial snapshot.

Git-relative paths preserve canonical Git slash and byte semantics through parsing, sorting, DTOs, literal pathspecs, diffs, and mutations. Empty, non-UTF-8, absolute, parent-escaping, or otherwise unrepresentable wire paths fail closed. Directory markers, nested repositories, linked worktrees, and symlinks are boundaries rather than implicit recursive inventory roots.

Each successful capture produces a content-derived `workspace_revision`. A request without an expected revision starts a fresh generation; a request with `expected_workspace_revision` reads only that exact snapshot. Missing, expired, invalidated, or identity-mismatched revisions return the snapshot-stale code and never fall through to a newer snapshot. Session-local LRU and TTL limits, the Agent-wide published-snapshot budget, capture reservations, and active pins bound retained memory while preventing eviction during an accepted page or batch.

Repository identity separates the common Git directory from the worktree root and per-worktree Git directory. Common-repository identity coordinates shared refs and invalidation; worktree identity keys snapshots so linked worktrees cannot exchange index or workspace state. Stable filesystem identity prevents a deleted and recreated path from inheriting an older coordinator or revision.

## Query and wire

`git.getCapabilities` advertises revisioned workspace pages, path-scoped status, directory scope, and stash-section diff support. `git.listWorkspacePage` returns one section and directory scope at a time. `git.listWorkspacePathStatuses` accepts only a bounded set of already-known paths and returns file rows or aggregate directory counts without descendant arrays. Both APIs return the bound revision. The legacy full-workspace method remains registered for compatibility but rejects inventories that require pagination before enrichment or response construction.

Every Git request passes raw payload and structural admission before JSON DTO decoding. Every Git response, including errors and mutation output, passes a Git-domain envelope budget using the production envelope shape. Response encoding checks and emits JSON incrementally within the payload cap, so high-escape strings cannot allocate an oversized encoded buffer before rejection. Large parsers and command runners enforce byte and record limits while reading rather than constructing an oversized business object first. Stable numeric errors distinguish stale snapshots, inventory limits, response budgets, pagination requirements, destructive-scan limits, process resources, request budgets, and path encoding.

The current Flowersec v2.3.9 integration admits at most four direct RPC streams and fixes each stream's request and notification scheduler limits before serving it. The reservation covers Flowersec-owned inbound frames and queues plus bounded Git outbound payload and final-marshal allowance. It does not claim a general bound for non-Git outbound responses or notifications; transport-wide lifecycle remains owned by the published Flowersec v2.3.9 release.

## Mutation coordination

The Agent owns one Git runtime shared by direct sessions. A cancellable topology gate, active-worktree registry, canonical repository lock order, per-repository fair read/write coordination, epochs, process admissions, snapshot storage, and destructive-scan admission form one lifecycle. Capture holds shared topology and repository leases through status completion, epoch revalidation, and snapshot publication. Git mutations hold the repository exclusively from current-state planning through effect outcome and final invalidation.

Files write, create, copy, rename, and delete effects use the same coordination boundary. Effects discover overlap with each admitted worktree root, common Git directory, and per-worktree Git directory, acquire all affected repositories in canonical order, and revalidate identities. Scope validation resolves the effect paths before coordination, and the callback executes against that same canonical path set instead of resolving the original logical paths again; a symlink retarget while waiting for the topology lease cannot redirect the effect into a repository that was not locked and invalidated. Every Files-owned write takes the topology-exclusive path because Git metadata may live in an arbitrary `--separate-git-dir`; filename-based detection cannot prove that a target is ordinary content. Topology-changing effects fail closed when registry completeness or resource admission cannot prove the overlap set. Every dispatched effect invalidates before and after completion, including partial failures and unknown transport outcomes. Preview and validation-only calls do not invalidate.

Git commands use a bounded runner. On cancellation, parser failure, or output overflow, POSIX implementations signal the process group, apply the bounded termination sequence, close local pipe ends, and wait for the direct process and readers before releasing admission. The direct leader and pipe readers are observed concurrently; if the leader exits while an escaped descendant retains a pipe, the runner allows only a short drain window, closes its pipe ends, returns an unknown outcome, and releases admission. Process-group operations are serialized before leader reaping. Descendants that deliberately escape the process group remain an explicit operating-system boundary; their existence does not permit an unbounded handler or retained pipe.

## Linked worktree removal

Linked-worktree lists and previews expose summary state rather than full file arrays. Forced removal requires a separate content-sensitive destructive fingerprint generated by a single admitted, streaming, no-follow scan. The scan hashes the portable pathname tree, kinds, modes, sizes, regular-file content, and symlink targets while checking identity and metadata stability. The root Git control entry is excluded only after its type, exact contents when applicable, canonical target, and filesystem identity match the already resolved Git directory.

Unsupported file kinds, unreadable entries, topology changes, identity drift, deadline checks, or entry, path, heap, and content limits block deletion. Execution holds the exclusive topology and repository leases from identity revalidation through a second scan, fingerprint comparison, final root verification, and `git worktree remove --force`. This prevents Redeven-owned writers from entering between verification and removal. Hostile external writers and metadata outside the portable fingerprint, including ACLs, extended attributes, resource forks, and alternate data streams, are explicit non-transactional boundaries.

# Boundaries

Git remains authoritative for repository and workspace state; snapshots are process-local read models and never authorize mutations. Redeven coordinates only effects dispatched through its Git and Files services. Concurrent external filesystem or Git writers may invalidate an operation and cause it to fail closed, but Redeven does not claim transactional control over them. Floret, ReDevPlugin, Flowersec transport internals, non-Git outbound RPC allocation, and operating-system processes that deliberately escape the supervised process group remain outside this runtime's ownership.

# Evidence

- `redeven:internal/gitrepo/workspace.go` - Captures workspace state and projects revision-bound pages.
- `redeven:internal/gitrepo/workspace_paths.go` - Serves bounded path-scoped status and directory aggregates.
- `redeven:internal/gitrepo/service.go` - Registers Git RPC handlers, capabilities, errors, and mutation entrypoints.
- `redeven:internal/gitrepo/delete_branch_review.go` - Builds linked-worktree summaries and content-sensitive delete plans.
- `redeven:internal/gitrepo/destructive_workspace_fingerprint.go` - Performs the admitted no-follow destructive scan.
- `redeven:internal/gitrepo/rpc_contract.go` - Applies raw request admission and response-envelope guards to the closed Git RPC set.
- `redeven:internal/gitrepo/workspace_snapshot.go` - Owns immutable snapshot publication, pins, TTL sweep, invalidation, and resource release.
- `redeven:internal/gitruntime` - Owns topology and repository coordination, process containment, bounded waits, registry refs, and Agent-wide admissions.
- `redeven:internal/agent/agent.go` - Injects the shared runtime and drains accepted direct-session streams before service teardown.
- `redeven:internal/fs/service.go` - Coordinates filesystem effects with Git repository mutation ownership.
