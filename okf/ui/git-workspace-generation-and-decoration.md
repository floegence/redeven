---
type: UI Contract
title: Git workspace generation and Files decoration
description: Keep Git views and Files decorations revision-consistent through capability gating, generation ownership, and monotonic invalidation.
tags: [ui, git, files, state, interaction]
timestamp: 2026-07-28T00:00:00Z
---
# Summary

Env App treats each visible Git workspace projection as a revision-bound generation owned by one protocol client and repository. Git Changes, Branch status, and Files decorations have independent owners but share a provider-level monotonic invalidation bus. Files navigation never waits for Git, never downloads a complete workspace inventory, and preserves the last committed decoration while one bounded replacement generation is built. A stale or invalidated response cannot restore old state after navigation, remount, capability probing, or an effect with an unknown outcome.

# Contract

## Capability and generation

Git workspace-v1 behavior starts only after `git.getCapabilities` confirms revision, path-status, directory-scope, and stash-section support for the exact protocol client object. Only a capability-method 404 is cached as an old Agent. Other probe failures are transient and retry on an explicit refresh or later mount. Replacing the protocol client discards the old capability state, generation state, and late responses; old Agents never trigger a fallback to the unbounded legacy workspace call for Files decoration.

Every owner starts with a fresh response that establishes its `workspace_revision`. Its later page, section, directory, or path batches carry `expected_workspace_revision`. Response commit checks the client identity, repository, owner generation, requested scope, revision, and invalidation watermark. Snapshot-stale invalidates the whole owner and permits at most one automatic fresh restart for that operation. A new-capability response that omits the promised revision fails closed rather than silently switching to legacy semantics.

Changes, staged, and conflicted directory scopes remain explicit. Directory rows are aggregates, not representative descendants, and menu routing uses a deterministic priority: pending changes first, then conflicted, then staged. Moving from a Files-owned revision to the main Workspace opens a fresh Workspace generation before applying the requested section and directory scope; it cannot splice Files revision data into an older Workspace owner.

## Loading and recovery

The Git shell and both navigation controls remain mounted and interactive while a Git read is pending. Changes, Branches, and History own their initial loading and error presentation inside the active panel; the shell must not add a second blocking curtain or overlay. A silent request is background refresh only when the panel already has a committed snapshot. Without one, it enters the same loading state as an explicit first request, and every failure settles loading to a retryable error state. Read-only Git subprocesses have a bounded runtime deadline and process-group cleanup so an inaccessible worktree or slow filesystem cannot leave the UI request pending indefinitely.

The initial branch snapshot has one request owner per repository and shares an in-flight request with concurrent activations. A branch status failure is terminal for that panel until an explicit refresh or branch-context change; it must not immediately retry, reconcile the selected branch, or disable Git mode, Files mode, the Git view tabs, or the global activity bar. Optional fields in workspace-page, path-status, and commit-list RPC requests are omitted from the wire object rather than encoded as JavaScript `undefined`, so a valid local workspace can reach the runtime and settle normally.

## Invalidation

The stable protocol provider owns `GitWorkspaceInvalidationBus`. Each client identity has a monotonically increasing global watermark and per-repository watermarks. A repository event advances that repository; an event without a reliable repository advances the client-global watermark. Other protocol clients are isolated.

Mounted Files, Workbench, Activity, launcher, and preview owners subscribe for live invalidation. Unmount removes the subscription but the provider retains watermarks for the client lifetime. Bootstrap, remount, capability transition, fresh dispatch, and response commit compare the current maximum of the global and repository watermarks. Persisted or retained generations carry their commit watermark and are discarded on remount when older than the provider watermark. This closes the unmount, capability-probe, and response-commit races without keeping view-local shadow authorities.

All Files and Git effects use one `executeWorkspaceEffect` boundary. Once an effect has been dispatched, its `finally` path publishes invalidation whether the result is success, an application error, or transport-unknown. Create, save, mkdir, copy, rename, duplicate, delete, stage, unstage, discard, commit, stash, checkout, pull, merge, and related effects cannot bypass this boundary. Preview and pure validation requests do not publish mutation invalidation.

## Files decoration

Files renders filesystem results immediately. Git decoration runs in the background only for paths already loaded by the current Files scope; it never expands filesystem pages or traverses workspace pages to discover more paths. At most one decoration request is active for an owner, and rapid navigation records only the latest pending scope. Late work from another client, repository, directory, generation, or watermark is ignored.

Before dispatch, path-status requests are split by all three production limits: at most 64 paths, at most 128 KiB of path UTF-8 bytes, and at most 736 KiB for the complete request encoded by the production codec. Escaped control characters, the repository path, revision, field names, punctuation, and JSON framing count toward the codec limit. Request-budget and response-budget errors may trigger bounded binary subdivision. The first successful child establishes the revision for siblings. A single path that still exceeds the contract degrades only that path and leaves Files and the connection usable.

Decoration is double-buffered. Loading and transient failures retain the committed markers, directory aggregates, tooltips, and menus. A complete successful replacement atomically removes markers for paths that became clean. Background errors use existing localized generic and truncated-content messages; server error text is never shown directly. The same section identity distinguishes duplicate stash or workspace rows, so staged, unstaged, untracked, and conflicted actions remain addressable without ambiguous row keys.

# Boundaries

Workspace revisions provide read consistency, not mutation authorization. The server rebuilds mutation guards from current Git state. UI cancellation is an ownership optimization, not proof that a dispatched effect did not run; invalidation remains mandatory for unknown outcomes. Provider watermarks are process-local UI coordination state and are released with the protocol client, not persisted as repository truth.

Files without the new capability remains fully usable as a filesystem browser, but has no Git decoration. Non-Git Flowersec outbound allocation is outside this feature's transport budget and must not be presented as fixed by UI batching.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts` - Assigns the capability and path-status RPC type identifiers.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/contract.ts` - Exposes the revision-aware production RPC codec.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/sdk/git.ts` - Defines capability, revision, path-status, aggregate, and stash-section DTOs.
- `redeven:internal/envapp/ui_src/src/ui/services/gitWorkspaceRuntime.ts` - Owns protocol-client capability and monotonic invalidation watermarks.
- `redeven:internal/envapp/ui_src/src/ui/services/gitWorkspacePathStatus.ts` - Splits path-status work by path, UTF-8, and production-codec budgets.
- `redeven:internal/envapp/ui_src/src/ui/services/workspaceEffects.ts` - Publishes invalidation after every dispatched workspace effect outcome.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.tsx` - Projects background Git status over loaded Files paths and routes directory actions.
- `redeven:internal/envapp/ui_src/src/ui/widgets/GitBranchesPanel.tsx` - Owns revision-bound Branch status sections, pagination, and directory scopes.
- `redeven:internal/envapp/ui_src/src/ui/widgets/GitWorkspace.tsx` - Keeps the Git shell and navigation independent from panel loading presentation.
- `redeven:internal/gitruntime/runner.go` - Applies bounded read execution and process-group cleanup.
