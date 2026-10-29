---
type: UI Contract
title: Git browser visual states
tags: [ui, git, files, accessibility, themes]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Git file selection and inline diff inspection share a contained surface with independently owned request state. Floe interaction accent marks selection; semantic Git colors mark repository facts. Checked-out and inspected branches remain distinguishable when they coincide. Layout preserves local scrolling, keyboard actions and a current diff across widths and themes.

# Contract

## State ownership
Navigation, branches, history, summaries and changed files share interaction tokens derived from `ring`, independent of text-selection paint. Neutral hover cannot override selection. Success/warning/danger/info/remote-violet remain on semantic facts, never selection or focus indicators.

## Commit graph layout
One measured owner positions rails, connectors, nodes and columns within available width without displacing summaries or changing selection/actions.

## Inline file inspection
Workspace, commit, branch status/history and comparison entry points reuse retained file/diff navigation. Filtering/removal/section or commit changes retire stale selected objects. Narrow/Workbench viewports remain contained with independent local scrolling.

## Theme and accessibility
Every preset inherits complete interaction roles. Forced colors expose selected borders/indicators, focus and Current-chip boundaries through system colors.

# Boundaries

Inline inspection changes local presentation and file navigation only. Product themes may vary selection hue and surrounding surfaces, but they must not replace interaction roles with Git semantic status colors, inherit a fixed palette from another theme, or make Current a proxy for selection.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/GitCommitLoading.browser.test.tsx - Checks mounted-frame and geometric stability through delayed and superseded commit requests in both entry points at landscape, tall, and narrow sizes.
