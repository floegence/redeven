---
type: UI Contract
title: Git browser visual states
description: Keep Git selection, repository facts, semantic status, hover, and focus visually independent across themes.
tags: [ui, git, files, accessibility, themes]
timestamp: 2026-07-30T00:00:00Z
---
# Summary

Env App's Git browser owns file selection and inline diff inspection. File lists and the selected patch remain in one constrained surface, and late responses cannot replace the current selection. Navigation and inspection selection derive from Floe's theme interaction accent (`ring`), independently of text-selection paint. Git status colors express repository meaning. The checked-out branch is a repository fact and the selected branch is the user's inspection target; both remain visible when they coincide. Commit graph topology adapts to sidebar width without displacing the summary. A layout that obscures selection, prevents local scrolling, or retains an obsolete diff fails the interaction contract.

# Contract

## State ownership

Selected navigation, branch rows, history rows, status summaries, and changed-file rows share the Git selection accent, background, border, and indicator tokens. List-like selections use a filled surface plus a solid left indicator. Compact segmented tabs and Files/Git mode buttons use the primary/primary-foreground selection contract owned by [Shared surface material](surface-material.md). They update the actual selected button immediately, retain both button instances, and do not adopt list indicators. Hover uses a lower-emphasis neutral surface and never overrides an active selection. Keyboard focus uses a distinct outline that remains visible on selected and unselected controls.

The Current branch chip is independent of selection styling. It always uses the current-branch chip tokens, including when the current branch is selected. Git change and health tones such as success, warning, danger, info, and remote-branch violet remain on semantic icons, badges, paths, and values; they must not determine a selection indicator or focus ring.

## Commit graph layout

The history sidebar has one measured geometry owner for static rails, row connectors, nodes, and row columns. Simple histories retain the natural 16-pixel lane spacing. When topology is wider than the sidebar budget, the graph uses at most 45% of the commit row and compresses lane spacing, nodes, and strokes together while preserving every lane and connection. The commit summary keeps the remaining width, with a 128-pixel target where the sidebar can provide it; subject and author truncate within their own cells while hash and time remain visible. Sidebar resizing recomputes this geometry directly and does not create horizontal scrolling, rewrite the persisted sidebar width, or select a second compact layout.

The selected row surface and the main commit detail are the selection presentation. The history summary does not add a competing inline `Selected` label. Complex topology cannot change commit selection, detail loading, context actions, or keyboard behavior.

## Inline file inspection

Workspace changes, graph commit details, branch worktree status, branch commit details, and branch comparisons keep the file list alongside the selected diff. Selecting a file does not create a diff dialog or hide the list. Branch comparison retains its existing comparison dialog, with both files and diff inside it. Saved-stash review remains a separate floating-window workflow.

The active page or commit owns the available files. Selection resolves against that current inventory and defaults to its first file; directory rows continue to navigate the workspace scope. Filtering, removing a file, changing sections, or switching commits cannot leave a detached old file object as the displayed diff. Stage, unstage, discard, pagination, and context menus retain their existing authority and confirmation behavior. Arrow Up/Down and Home/End navigate within the focused file rail; nested action buttons keep their own keyboard semantics.

The file rail and patch have independent constrained scroll viewports. At container widths of 680 CSS pixels or less, the file rail moves above the diff; this decision uses the actual component width, including a narrow Workbench widget. Patch scrolling and text selection use the existing Workbench ownership contracts. Selecting another file resets patch scroll position and expansion state without resetting file-list scroll.

One shared diff panel owns preview and full-context requests for both inline inspection and the remaining dialog adapter. Preview loading starts when an inline panel mounts. Full context loads only on explicit selection of that mode. A changed source, file, or refreshed file summary invalidates prior request ownership, including a refresh at the same path; disposal invalidates outstanding results. Binary, directory, unavailable, truncated, and failed diff states remain explicit. Commit first-parent presentation comes from the existing runtime contract.

## Theme and accessibility

Every built-in light and dark shell preset inherits the complete Git interaction token set. Themes, including Classic Dark, derive selected surfaces from Floe's published `ring` interaction role and derive selection indicators and focus rings from the theme `ring`, with a small foreground mixture in dark themes where needed to preserve adjacent-color contrast. This keeps warm, green, violet, neutral, and blue themes within their own interaction identity. Light themes use a restrained selection mixture over the panel; dark themes use a stronger mixture so selection does not disappear into dark panels, while Classic Dark keeps a quieter surface mixture suited to its elevated panels. Classic Light and Porcelain Light use a stronger blend of their muted theme accent to remain distinct from neutral hover. No preset retains a fixed blue interaction override; blue text selection, links, and Git fact colors remain independent. Selected text, branch metadata, table headers, and current-chip text meet a 4.5:1 contrast target. Browser titles and table headers keep opaque semantic text. Studio limits its neutral selection fill to retain readable metadata; Solarized Light slightly strengthens Git control and shared Tag ink without changing semantic status hues. Selection indicators and focus rings meet a 3:1 adjacent-color target, while selected, hover, and idle surfaces retain measurable perceptual separation. Forced-colors mode exposes selected borders, indicators, focus outlines, and current-chip boundaries through system colors.

# Boundaries

Inline inspection changes local presentation and file navigation only. It does not alter Git mutations, workspace generation, sidebar-width persistence, or Files decoration. Product themes may vary selection hue and surrounding surfaces, but they must not replace interaction roles with Git semantic status colors, inherit a fixed palette from another theme, or make Current a proxy for selection.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffSplit.browser.test.tsx - Verifies responsive containment, independent scrolling, keyboard selection, and removal of the selected file in a real browser.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffPanel.test.tsx - Verifies initial loading, late-response isolation, and fresh content after a same-path inventory refresh.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitHistoryBrowser.e2e.test.tsx - Verifies commit navigation clears obsolete diff ownership and preserves commit actions.
- redeven:internal/envapp/ui_src/src/styles/redeven.css - Defines the shared light, dark, and forced-colors Git interaction tokens and state classes.
- redeven:internal/envapp/ui_src/src/styles/gitBrowserSelectionVisual.browser.test.tsx - Verifies computed contrast and perceptual separation across all built-in shell themes.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitChrome.ts - Centralizes selectable row, navigation, secondary text, selection chip, and current-branch helpers.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitCommitGraph.tsx - Owns topology construction and the single width-bounded graph geometry.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitCommitGraph.browser.test.tsx - Verifies complex topology containment, summary visibility, resizing, and rail-to-node alignment in a real browser.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitWorkbenchSidebar.e2e.test.tsx - Covers independent current and selected branch combinations.
