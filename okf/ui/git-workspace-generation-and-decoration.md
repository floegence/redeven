---
type: UI Contract
title: Git workspace generation and Files decoration
description: Keep Git views and Files decorations revision-consistent through capability gating, generation ownership, and monotonic invalidation.
tags: [ui, git, files, state, interaction]
timestamp: 2026-07-28T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Each Git projection belongs to one protocol client, repository and revision generation. Changes, Branches and Files have separate owners sharing monotonic invalidation. Files renders immediately and keeps committed decorations while a bounded replacement loads. Stale or invalidated responses cannot restore old state, including after unknown effects.

# Contract

## Capability and generation
Use workspace-v1 only after the exact client confirms revision, path-status, directory-scope and stash-section capabilities. Client replacement discards old capability/generation state and late responses. Files never falls back to unbounded legacy workspace reads. Moving from Files into Workspace opens a fresh generation before applying section/scope.

## Loading and recovery
Git shell/navigation stay mounted; each panel owns initial loading/errors without a second curtain. Diff requests and nested file references must satisfy the JSON-only transport contract.

## Invalidation
One protocol-level `GitWorkspaceInvalidationBus` advances monotonically. Every dispatched effect invalidates in `finally` for success, application failure or unknown transport result; preview/validation does not.

## Files decoration
Filesystem navigation never waits for Git. Detection uses the committed path and repository identity; prior directories cannot leak repo facts. Replacement generations are bounded and preserve committed decoration. Section identity disambiguates staged/unstaged/untracked/conflicted and stash rows.

# Boundaries

Workspace revisions provide read consistency, not mutation authorization. UI cancellation is an ownership optimization, not proof that a dispatched effect did not run; invalidation remains mandatory for unknown outcomes.

Non-Git Flowersec outbound allocation is outside this feature's transport budget and must not be presented as fixed by UI batching.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts` - Assigns the capability and path-status RPC type identifiers.

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/contract.ts` - Exposes the revision-aware production RPC codec.

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/sdk/git.ts` - Defines capability, revision, path-status, aggregate, and stash-section DTOs.
