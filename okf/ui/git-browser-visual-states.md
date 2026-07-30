---
type: UI Contract
title: Git browser visual states
description: Keep Git selection, repository facts, semantic status, hover, and focus visually independent across themes.
tags: [ui, git, files, accessibility, themes]
timestamp: 2026-07-30T00:00:00Z
---
# Summary

Env App's Git browser uses each Floe theme's native selection and focus roles for selected navigation and rows, while Classic Light and Classic Dark retain Redeven's established blue interaction system and Git status colors remain reserved for repository meaning. The currently checked-out branch is a repository fact and the selected branch is the user's inspection target; either may exist without the other, and both remain visible when they coincide. Hover and keyboard focus provide separate transient feedback. If a theme cannot preserve these distinctions and readable text, the visual contract fails rather than falling back to an unrelated fixed palette or ambiguous neutral styling.

# Contract

## State ownership

Selected navigation, branch rows, history rows, status summaries, and changed-file rows share the Git selection accent, background, border, and indicator tokens. List-like selections use a filled surface plus a solid left indicator. Segmented tabs keep their contained active-item presentation and do not adopt list indicators. Hover uses a lower-emphasis neutral surface and never overrides an active selection. Keyboard focus uses a distinct outline that remains visible on selected and unselected controls.

The Current branch chip is independent of selection styling. It always uses the current-branch chip tokens, including when the current branch is selected. Git change and health tones such as success, warning, danger, info, and remote-branch violet remain on semantic icons, badges, paths, and values; they must not determine a selection indicator or focus ring.

## Theme and accessibility

Every built-in light and dark shell preset inherits the complete Git interaction token set. Non-Classic themes derive selected surfaces from Floe's published `selection-bg` and derive selection indicators and focus rings from the theme `ring`, with a small foreground mixture in dark themes where needed to preserve adjacent-color contrast. This keeps warm, green, violet, neutral, and blue themes within their own interaction identity. Light themes use a restrained selection mixture over the panel; dark themes use a stronger mixture so selection does not disappear into dark panels. Classic Light and Classic Dark explicitly override those sources with Redeven's validated blue roles. Selected text and current-chip text meet a 4.5:1 contrast target. Selection indicators and focus rings meet a 3:1 adjacent-color target, while selected, hover, and idle surfaces retain measurable perceptual separation. Forced-colors mode exposes selected borders, indicators, focus outlines, and current-chip boundaries through system colors.

# Boundaries

This contract changes presentation only. It does not alter Git state, selection ownership, keyboard navigation, ARIA state, workspace generation, or Files decoration. Product themes may vary selection hue and surrounding surfaces, but they must not replace interaction roles with Git semantic status colors, inherit a fixed palette from another theme, or make Current a proxy for selection.

# Evidence

- redeven:internal/envapp/ui_src/src/styles/redeven.css - Defines the shared light, dark, and forced-colors Git interaction tokens and state classes.
- redeven:internal/envapp/ui_src/src/styles/gitBrowserSelectionVisual.browser.test.tsx - Verifies computed contrast and perceptual separation across all built-in shell themes.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitChrome.ts - Centralizes selectable row, navigation, secondary text, selection chip, and current-branch helpers.
- redeven:internal/envapp/ui_src/src/ui/widgets/GitWorkbenchSidebar.e2e.test.tsx - Covers independent current and selected branch combinations.
