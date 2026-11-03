---
type: Runtime Contract
title: Git workspace inventory lifecycle
tags: [architecture, git, runtime, filesystem, transport]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Git queries expose bounded immutable snapshots with revision-bound paging. Git/Files mutations coordinate topology and invalidate snapshots around effects; display grants no authority. Oversized/stale/malformed/exhausted reads return bounded typed errors without losing Flowersec session.

# Contract

- Incrementally read NUL-delimited porcelain v2 and reserve token/record/path/heap/process/capture/cache capacity before growth. Filesystem identity prevents recreated paths inheriting old coordination or revisions.
- `git.getCapabilities` advertises revisioned pages, path/directory status and stash-section diff. `git.listWorkspacePathStatuses` accepts bounded known paths and returns rows or directory counts without descendant arrays.
- One Agent Git runtime coordinates cancellable topology, active worktrees, canonical lock order, fair per-repository reads/writes, epochs, process admission, snapshots and destructive scans. Escaped process-group descendants never justify unbounded handlers/pipes.
- Linked-worktree previews expose summaries. Exclude the root Git control entry only after verifying type, applicable exact content, canonical target and filesystem identity against the resolved Git directory.

# Boundaries

Git remains authoritative; snapshots are read models. Hostile external writers and nonportable metadata (ACLs, xattrs, resource forks, alternate streams) remain non-transactional limits. Published Flowersec owns transport-wide lifecycle; this contract cannot bound non-Git RPCs/notifications or control escaped OS processes, Floret or ReDevPlugin internals.

# Evidence

- `redeven:internal/gitrepo/workspace.go` - Source.
- `redeven:internal/gitrepo/service.go` - Source.
