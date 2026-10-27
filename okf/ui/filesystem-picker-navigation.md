---
type: UI Contract
title: Absolute filesystem directory selection
description: Select authorized directories through one navigation core in Flower, Spaces, and other filesystem pickers.
tags: [ui, filesystem, flower, spaces, workbench]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
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

## Shared directory favorites
All pickers use controlled [favorites](directory-favorites.md), which own scoped persistence, refresh and failures. Shortcut views cannot confirm an earlier directory selection.

# Boundaries

The published picker owns navigation and request lifetime. A validated selection represents the current form intent only; the runtime checks authorization again when the product operation executes.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.localization.browser.test.tsx` - All ten locale presentations and live language changes without replacing picker or composer inputs.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Published path parsing and formatting, absolute identity, and localized input recovery.
