---
type: Runtime Contract
title: Git workspace inventory lifecycle
tags: [architecture, git, runtime, filesystem, transport]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Git queries expose bounded immutable snapshots with revision-bound paging. Git/Files mutations coordinate topology and invalidate snapshots around effects; display grants no authority. Oversized/stale/malformed/exhausted reads return bounded typed errors without losing Flowersec session.

# Contract

- Incrementally read NUL-delimited porcelain v2 and reserve token/record/path/heap/process/capture/cache capacity before growth. Filesystem identity prevents recreated paths inheriting old coordination or revisions.
- `git.getCapabilities` advertises revisioned pages, path/directory status and stash-section diff. `git.listWorkspacePathStatuses` accepts bounded known paths and returns rows or directory counts without descendant arrays.
- One Agent Git runtime coordinates cancellable topology, active worktrees, canonical lock order, fair per-repository reads/writes, epochs, process admission, snapshots and destructive scans. Escaped process-group descendants never justify unbounded handlers/pipes.
- Linked-worktree deletion reviews fingerprint the complete tree, including ignored build output, using no-follow filesystem identity, type/mode, size, mtime and kernel ctime instead of reading file contents. A same-size rewrite with restored mtime or inode replacement invalidates consent; atime changes do not. Directory memory is released after traversal. Bound each scan to 1,000,000 entries, 256 MiB cumulative path bytes, 32 MiB live retained entries and 30 seconds; file byte size alone never blocks review. No ignored subtree is silently skipped.
- Linked-worktree previews expose summaries. Exclude the root Git control entry only after verifying type, applicable exact content, canonical target and filesystem identity against the resolved Git directory.

## Mutation scope and branch removal

- Stage/unstage resolve the requested section, directory and literal paths first. Execute only those resolved paths through a private NUL-delimited pathspec file; a changes action cannot stage conflicts, and unstaging cannot clear conflict stages outside its selection.
- Branch origin and the directory where `git worktree add` ran do not decide removability. A linked worktree created from the primary `main` directory, including below that directory, can be removed with its branch after review. The primary worktree remains non-removable even after switching it to a feature branch; switch that directory to another branch before deleting its old branch.
- Delete review rejects inaccessible or changed repository identity, primary worktrees, locked worktrees, and targets containing another registered worktree (including detached worktrees). Block both safe and force actions and return a stable `blocking_code` for localized UI. Lock/topology changes invalidate the reviewed fingerprint.
- Worktree removal and discarding local content are separate authorizations. Both safe and force modes require explicit discard consent for tracked, untracked or ignored files. Force branch deletion only relaxes the merged-commit check; it does not imply permission to discard local work. Never unlock worktrees automatically.

# Boundaries

Git remains authoritative; snapshots are read models. The metadata review is not a content checksum: it relies on filesystem identity and kernel change timestamps, not privileged or timestamp-forging writers. Hostile external writers and nonportable metadata (ACLs, xattrs, resource forks, alternate streams) remain non-transactional limits. Published Flowersec owns transport-wide lifecycle; this contract cannot bound non-Git RPCs/notifications or control escaped OS processes, Floret or ReDevPlugin internals.

# Evidence

- `redeven:internal/gitrepo/workspace.go`, `mutations.go`, `delete_branch_review.go` - Inventory and mutation implementation.
- `redeven:internal/gitrepo/workspace_mutation_scope_test.go`, `delete_branch_topology_test.go` - Real Git section isolation, primary/linked/locked/nested topology, stale reviews and discard consent.
- `redeven:internal/gitrepo/service_e2e_test.go` - Encrypted RPC deletion from the primary directory and rejection of primary-worktree removal.

- `redeven:internal/gitrepo/delete_branch_large_worktree_test.go` - Large ignored artifacts, stale same-size rewrites, file replacement, bounded retained memory and explicit discard authorization.
