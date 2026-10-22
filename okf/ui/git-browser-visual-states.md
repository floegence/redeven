---
type: UI Contract
title: Git browser visual states
description: Keep Git selection, repository facts, semantic status, hover, and focus visually independent across themes.
tags: [ui, git, files, accessibility, themes]
timestamp: 2026-10-18T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App's Git browser owns file selection and inline diff inspection. File lists and the selected patch remain in one constrained surface, and late responses cannot replace the current selection. Navigation and inspection selection derive from Floe's theme interaction accent (`ring`), independently of text-selection paint. Git status colors express repository meaning. The checked-out branch is a repository fact and the selected branch is the user's inspection target; both remain visible when they coincide. Commit graph topology adapts to sidebar width without displacing the summary. A layout that obscures selection, prevents local scrolling, or retains an obsolete diff fails the interaction contract.

# Contract

## State ownership
Selected navigation, branch rows, history rows, status summaries, and changed-file rows share the Git selection accent, background, border, and indicator tokens. Hover uses a lower-emphasis neutral surface and never overrides an active selection.

Git change and health tones such as success, warning, danger, info, and remote-branch violet remain on semantic icons, badges, paths, and values; they must not determine a selection indicator or focus ring.

## Commit graph layout
The history sidebar has one measured geometry owner for static rails, row connectors, nodes, and row columns.

Complex topology cannot change commit selection, detail loading, context actions, or keyboard behavior.

## Inline file inspection
Workspace changes, graph commit details, branch worktree status, branch commit details, and branch comparisons use one retained file/diff navigation surface.

Filtering, removing a file, changing sections, or switching commits cannot leave a detached old file object as the displayed diff.

The viewport remains contained at narrow widths and under Workbench projection.

## Theme and accessibility
Every built-in light and dark shell preset inherits the complete Git interaction token set. Forced-colors mode exposes selected borders, indicators, focus outlines, and current-chip boundaries through system colors.

# Boundaries

Inline inspection changes local presentation and file navigation only. Product themes may vary selection hue and surrounding surfaces, but they must not replace interaction roles with Git semantic status colors, inherit a fixed palette from another theme, or make Current a proxy for selection.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/GitCommitLoading.browser.test.tsx - Checks mounted-frame and geometric stability through delayed and superseded commit requests in both entry points at landscape, tall, and narrow sizes.

- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffSplit.browser.test.tsx - Verifies row density, stable commit-file navigation, responsive containment, independent scrolling, keyboard selection, removal of the selected file, and a persistent scrollbar with synchronized seeking, resizing, and scaled pointer dragging in a real browser.

- redeven:internal/envapp/ui_src/src/ui/widgets/GitHistoryBrowser.e2e.test.tsx - Verifies commit navigation clears obsolete diff ownership and preserves commit actions.
