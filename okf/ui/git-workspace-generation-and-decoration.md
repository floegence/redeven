---
type: UI Contract
title: Git workspace generation and Files decoration
description: Keep Git views and Files decorations revision-consistent through capability gating, generation ownership, and monotonic invalidation.
tags: [ui, git, files, state, interaction]
timestamp: 2026-07-28T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App treats each visible Git workspace projection as a revision-bound generation owned by one protocol client and repository. Git Changes, Branch status, and Files decorations have independent owners but share a provider-level monotonic invalidation bus. Files navigation never waits for Git, never downloads a complete workspace inventory, and preserves the last committed decoration while one bounded replacement generation is built. A stale or invalidated response cannot restore old state after navigation, remount, capability probing, or an effect with an unknown outcome.

# Contract

## Capability and generation
Git workspace-v1 behavior starts only after `git.getCapabilities` confirms revision, path-status, directory-scope, and stash-section support for the exact protocol client object. Replacing the protocol client discards the old capability state, generation state, and late responses; old Agents never trigger a fallback to the unbounded legacy workspace call for Files decoration.

Moving from a Files-owned revision to the main Workspace opens a fresh Workspace generation before applying the requested section and directory scope; it cannot splice Files revision data into an older Workspace owner.

## Loading and recovery
The Git shell and both navigation controls remain mounted and interactive while a Git read is pending. Changes, Branches, and History own their initial loading and error presentation inside the active panel; the shell must not add a second blocking curtain or overlay.

Diff-content applies this rule to both its request envelope and nested file reference so commit, workspace, compare, and stash patch previews reach the JSON-only session transport and settle normally.

## Invalidation
The stable protocol provider owns `GitWorkspaceInvalidationBus`.

Once an effect has been dispatched, its `finally` path publishes invalidation whether the result is success, an application error, or transport-unknown. Preview and pure validation requests do not publish mutation invalidation.

## Files decoration
Files renders filesystem results immediately and owns directory navigation independently of Git. Git repository detection runs only for the stable committed Files path, and its context is keyed by that path and repository identity so a previous directory cannot display its repo information in the next one.

The same section identity distinguishes duplicate stash or workspace rows, so staged, unstaged, untracked, and conflicted actions remain addressable without ambiguous row keys.

# Boundaries

Workspace revisions provide read consistency, not mutation authorization. UI cancellation is an ownership optimization, not proof that a dispatched effect did not run; invalidation remains mandatory for unknown outcomes.

Non-Git Flowersec outbound allocation is outside this feature's transport budget and must not be presented as fixed by UI batching.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts` - Assigns the capability and path-status RPC type identifiers.

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/contract.ts` - Exposes the revision-aware production RPC codec.

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/sdk/git.ts` - Defines capability, revision, path-status, aggregate, and stash-section DTOs.
