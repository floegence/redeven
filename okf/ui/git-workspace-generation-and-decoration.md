---
type: UI Contract
title: Git workspace generations, diffs and visual state
tags: [ui, git, files, state, interaction]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Exact client capabilities and monotonic generations fence Git inventory, diffs and filesystem decoration. Dispatched effects invalidate even on unknown outcomes; preview never grants authority. Retained inspection and theme roles preserve selection and local scrolling without treating layout as content freshness.

# Contract

## Workspace generations
Use workspace-v1 only after the exact client confirms revision/path-status/directory-scope/stash-section capabilities. Client replacement retires old capabilities/generations and late replies. Files never uses unbounded legacy reads; Files→Workspace opens a fresh generation before section/scope.

Keep Git shell/navigation mounted with local panel loading/errors, no second curtain. Diff requests/nested file references obey JSON-only transport. One monotonic protocol `GitWorkspaceInvalidationBus` invalidates every dispatched effect in `finally`: success, application failure or unknown transport outcome; preview/validation cannot invalidate.

Filesystem navigation never waits for Git. Committed path/repository identity fences detection; old directories cannot leak facts. Bound replacement generations while preserving committed decoration. Section identity distinguishes staged/unstaged/untracked/conflicted and stash rows.

## Diff requests
Inline/Activity/Workbench/dialog share one owner. Caller patch snapshots are previews; refresh or authoritative empty/failure cannot revive them. Runtime owns first-parent meaning.

Persisted Workbench widgets store placement targets, never Git summaries. Equal target fields preserve in-flight work, patches/full context, expansion and both scroll axes across unrelated snapshots. Other inspections retain same-path fresh-summary behavior. Connection absence is not missing-file failure; successful no-file settles empty without old patches/perpetual overlay, failures retain recovery.

## Visual state
Navigation/branches/history/summaries/files use `ring`-derived interaction tokens independent of text selection. Neutral hover cannot override selection; success/warning/danger/info/remote-violet describe facts, never selection/focus.

One measured owner lays out graph rails/connectors/nodes/columns within available width without moving summaries or changing actions/selection. Workspace/commit/branch status/history/comparison reuse retained file/diff navigation; filtering/removal/section/commit changes retire stale selections. Narrow/Workbench views remain contained with independent scrolling.

Every preset has complete interaction roles. Forced colors expose selection/focus/Current-chip boundaries through system colors.

# Boundaries

Revisions grant read consistency, never mutation authority. UI cancellation cannot prove an effect did not run; unknown outcomes still invalidate. Non-Git Flowersec outbound allocation remains outside this transport budget and cannot be claimed fixed by batching.

Layout persistence proves no content freshness. Workbench target stability cannot change inline/Activity/Stash fresh-summary semantics. Themes may vary selection hue/surfaces, never replace interaction roles with Git status colors, inherit another theme's fixed palette or use Current as selection.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/contract.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/sdk/git.ts` - Source.

- `redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffPanel.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.tsx` - Source.

- `redeven:internal/envapp/ui_src/src/ui/widgets/GitCommitLoading.browser.test.tsx` - Tests.
