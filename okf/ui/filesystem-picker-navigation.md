---
type: UI Contract
title: Absolute filesystem directory selection
description: Select authorized directories through one navigation core in Flower, Spaces, and other filesystem pickers.
tags: [ui, filesystem, flower, spaces, workbench]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe Webapp owns directory navigation, validation state, and asynchronous
request lifetime. Redeven supplies the target runtime connection, authoritative
path context, localized copy, and product form state. All picker paths are
absolute; `/` always means the target environment's filesystem root. Home and
Root are navigation shortcuts and cannot grant access. Failed navigation retains
the requested path and form, disables selection, and offers an explicit retry.
The runtime revalidates every create or execution request against current policy.

# Contract

## Absolute paths and runtime authority
DirectoryPicker, DirectoryInput, and file pickers consume the same released navigation core. A failed or malformed context cannot be replaced by synthesized Home or Root permissions.

Session, filesystem, OS, and process authorization remain governed by [permission policy and filesystem scope](../security/permission-policy-and-filesystem-scope.md).

## Navigation state and failures
Every mounted picker owns its current directory, loaded entries, path input, hidden-item switch, and validity.

Earlier successes or failures cannot overwrite newer input, navigation, error, or selection state.

A cached or previously validated selection is never an authorization token: creation and later operations can fail if policy, filesystem contents, or OS permissions change.

## Live language changes
Host-supplied Home and Root labels resolve through the active locale accessor. The change retains the current path, input element, pending selection, composer draft, and runtime authorization; it never reloads context solely to translate a label. Both Desktop Flower and Env App use this shared product adapter.

## Product presentations
Files uses the same released `parsePickerPath` and `formatPickerPath` functions for its path editor. An entered `/...` path never acquires a Home prefix, regardless of the currently selected root.

Its actual scroll viewports carry Workbench local-scroll markers; existing modal, keyboard, and focus ownership remains with the host and published presentation components.

## Shared directory favorites
All Env App and Desktop directory and file pickers receive the published controlled favorites contract. Shortcut views cannot confirm an earlier selected directory.

See [directory favorites](directory-favorites.md) for authentication, persistence, refresh and failure contracts.

# Boundaries

The published picker owns navigation and request lifetime. A validated selection represents the current form intent only; the runtime checks authorization again when the product operation executes.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.localization.browser.test.tsx` - All ten locale presentations and live language changes without replacing picker or composer inputs.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Published path parsing and formatting, absolute identity, and localized input recovery.

- `redeven:internal/envapp/ui_src/src/ui/pages/FileBrowserPageLoading.tsx` - Shared workspace presentation before the Files module is ready.
