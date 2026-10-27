---
type: Runtime Contract
title: Git workspace inventory lifecycle
description: Bound Git workspace capture, immutable revisions, resource admission, mutation coordination, and destructive linked-worktree removal.
tags: [architecture, git, runtime, filesystem, transport]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Git workspace queries produce bounded immutable process-local snapshots; paged/path reads bind exact revisions. Git and Files mutations share repository/topology coordination and invalidate affected snapshots before and after effects. Display state never authorizes mutation. Oversized, stale, malformed or exhausted requests return small typed errors while the Flowersec session remains usable.

# Contract

- Incrementally read NUL-delimited porcelain v2 and reserve token/record/path/heap/process/capture/cache capacity before growth. Filesystem identity prevents recreated paths inheriting old coordination or revisions.
- `git.getCapabilities` advertises revisioned pages, path/directory status and stash-section diff. `git.listWorkspacePathStatuses` accepts bounded known paths and returns rows or directory counts without descendant arrays.
- One Agent Git runtime coordinates cancellable topology, active worktrees, canonical lock order, fair per-repository reads/writes, epochs, process admission, snapshots and destructive scans. Escaped process-group descendants never justify unbounded handlers/pipes.
- Linked-worktree previews expose summaries. Exclude the root Git control entry only after verifying type, applicable exact content, canonical target and filesystem identity against the resolved Git directory.

# Boundaries

Git remains authoritative; snapshots are read models. Hostile external writers and nonportable metadata (ACLs, xattrs, resource forks, alternate streams) remain non-transactional limits. Published Flowersec owns transport-wide lifecycle; this contract cannot bound non-Git RPCs/notifications or control escaped OS processes, Floret or ReDevPlugin internals.

# Evidence

- `redeven:internal/gitrepo/workspace.go` - Captures workspace state and projects revision-bound pages.

- `redeven:internal/gitrepo/service.go` - Registers Git RPC handlers, capabilities, errors, and mutation entrypoints.
