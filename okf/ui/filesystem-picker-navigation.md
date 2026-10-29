---
type: UI Contract
title: Absolute filesystem directory selection
tags: [ui, filesystem, flower, spaces, workbench]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Published Floe owns picker navigation, validity and request lifetime; Redeven supplies connection, authoritative path context, localization and form state. Paths are absolute and / means the target filesystem root. Home/Root shortcuts grant no access. Failed navigation preserves intent/form, disables confirmation and offers Retry; execution revalidates current policy.

# Contract

## Absolute paths and runtime authority
DirectoryPicker, DirectoryInput and file pickers share the released core. Invalid context cannot synthesize Home/Root permissions. [Filesystem policy](../security/permission-policy-and-filesystem-scope.md) owns session, filesystem, OS and process access.

## Navigation state and failures
Each picker owns directory, entries, path input, hidden switch and validity. Stale successes/failures cannot replace newer intent. Validation is not authorization; changed policy/files/OS permissions may reject later operations.

## Live language changes
Home/Root resolve from active locale without replacing inputs/drafts/selection or reloading authorization. Desktop and Env App share the adapter.

## Product presentations
Files uses released `parsePickerPath`/`formatPickerPath`; absolute input never gets a Home prefix. Actual viewports carry Workbench local-scroll markers; host/published components retain modal, keyboard and focus ownership.

Files owns its runtime recovery presentation over published Floe controls, icons and semantic colors. A failed navigation retains the last readable directory and shows one compact, dismissible notice with a selectable full path, adjacent copy action and grouped recovery actions. If no readable directory remains, a bounded recovery card replaces the listing. Long paths wrap and whole controls reflow inside Activity and scaled Workbench viewports.

Runtime failures link the path input to the visible recovery description by ID instead of repeating its message under the toolbar. Syntax validation and canceled requests keep their own inline explanation. Editing clears the input's stale invalid state; it does not clear the unresolved navigation notice. Retry retains the same controls, focus and geometry through pending and repeated failure. Navigation, authorization, snapshots and persistence remain owned by the existing runtime controller.

## Shared directory favorites
All pickers use controlled [favorites](directory-favorites.md), which own scoped persistence, refresh and failures. Shortcut views cannot confirm an earlier directory selection.

# Boundaries

The published picker owns navigation and request lifetime. A validated selection represents the current form intent only; the runtime checks authorization again when the product operation executes.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.localization.browser.test.tsx` - All ten locale presentations and live language changes without replacing picker or composer inputs.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Published path parsing and formatting, absolute identity, and localized input recovery.

- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.paths.browser.test.tsx` - Single error description, retained directory, localized light/dark and narrow recovery, selectable paths, retry continuity and explicit recovery destinations.
