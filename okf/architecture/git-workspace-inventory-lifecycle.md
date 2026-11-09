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
- One Agent Git runtime coordinates cancellable topology, active worktrees, canonical lock order, fair per-repository reads/writes, epochs, process admission and snapshots. Escaped process-group descendants never justify unbounded handlers/pipes.
- Linked-worktree deletion reviews fingerprint removal risks: branch/base commits, merge eligibility, repository/worktree identity, staged/unstaged/untracked/conflicted paths and status classes, ignored path summaries, blockers and required authorizations. Preview and execution use the same risk definition; execution rereads current Git status before comparing the reviewed fingerprint.
- Use bounded Git status and `ls-files --others --ignored --exclude-standard --directory --no-empty-directory -z`. Collapse ignored directories such as `DerivedData/`; do not add a recursive filesystem inventory, per-file metadata fingerprint or content checksum. Ignored content still requires explicit discard consent. Changes within an already-reviewed ignored directory or content-only edits to an already-reviewed dirty path do not invalidate consent; changed path/status sets or repository/worktree identity do.

Repository summaries expose optional whole-index staged additions/deletions from a budgeted, cancellable Git shortstat read. Directory paging never narrows those totals. Binary-only and pure rename changes have zero text-line deltas; failed reads omit statistics. External index writers remain non-transactional.

## Mutation scope and branch removal

- Stage/unstage resolve the requested section, directory and literal paths first. Execute only those resolved paths through a private NUL-delimited pathspec file; a changes action cannot stage conflicts, and unstaging cannot clear conflict stages outside its selection.
- Branch origin and the directory where `git worktree add` ran do not decide removability. A linked worktree created from the primary `main` directory, including below that directory, can be removed with its branch after review. The primary worktree remains non-removable even after switching it to a feature branch; switch that directory to another branch before deleting its old branch.
- Delete review rejects inaccessible or changed repository identity, primary worktrees, locked worktrees, and targets containing another registered worktree (including detached worktrees). Block both safe and force actions and return a stable `blocking_code` for localized UI. Lock/topology changes invalidate the reviewed fingerprint.
- Worktree removal and discarding local content are separate authorizations. Both safe and force modes require explicit discard consent for tracked, untracked or ignored files. Force branch deletion only relaxes the merged-commit check; it does not imply permission to discard local work. Never unlock worktrees automatically.

# Boundaries

Git remains authoritative; snapshots are read models. Discard consent covers the reviewed removal risk, not an exact version of every file's bytes. Git may perform its normal content checks when computing status; Redeven does not add a whole-tree scan. External writers remain a non-transactional limit. Published Flowersec owns transport-wide lifecycle; this contract cannot bound non-Git RPCs/notifications or control escaped OS processes, Floret or ReDevPlugin internals.

# Evidence

- `redeven:internal/gitrepo/workspace.go`, `mutations.go`, `delete_branch_review.go` - Inventory and mutation implementation.
- `redeven:internal/gitrepo/workspace_mutation_scope_test.go`, `delete_branch_topology_test.go` - Real Git section isolation, primary/linked/locked/nested topology, stale reviews and discard consent.
- `redeven:internal/gitrepo/service_e2e_test.go` - RPC/router deletion from the primary directory and rejection of primary-worktree removal.
- `redeven:internal/gitrepo/delete_branch_large_worktree_test.go` - Large ignored artifacts, stable consent across content-only/build changes, rejection of changed path sets or replaced worktrees, and explicit discard authorization.
