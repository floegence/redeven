---
type: UI Contract
title: Absolute filesystem directory selection
tags: [ui, filesystem, flower, spaces, workbench]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Published Floe owns picker navigation, validity and request lifetime; Redeven supplies connection, authoritative path context, localization and form state. Paths are absolute and / means the target filesystem root. Home/Root shortcuts grant no access. Failed navigation preserves intent/form, disables confirmation and offers Retry; execution revalidates current policy.

# Contract

## Absolute paths and runtime authority
Released Floe DirectoryPicker/DirectoryInput/file pickers own navigation/validity/request lifetime. Redeven supplies connection, authoritative path context, i18n/form state. [Filesystem policy](../security/permission-policy-and-filesystem-scope.md) reauthorizes operations; Home/Root/context never invent grants.

## Navigation state and failures
Each picker owns directory/entries/input/hidden switch/validity. Fence stale success/failure by current intent; validation is no later authorization. Files uses released parsePickerPath/formatPickerPath without Home-prefixing absolute paths. Real viewports declare Workbench local-scroll; host/Floe retain modal/focus/keyboard.

## Live language changes
Translate Home/Root in place without replacing drafts/selection or reloading authority; Desktop/Env App share the adapter.

## Product presentations
A failed Files navigation retains its last readable listing and one dismissible notice:selectable full path, copy, recovery actions. Without a readable listing use a bounded recovery card. Paths wrap/controls reflow inside scaled/narrow views. Link input to this notice by ID; syntax/cancellation retain own explanation. Editing clears stale invalid-input state, not unresolved navigation. Retry keeps focus/geometry through pending/repeated failure.

Existing browse/cache owner shows only visited target's snapshot while verifying. Uncached targets preserve readable listing with separate pending intent. Current clicks do not reload; pending duplicates share a request. Unverified cached destinations still verify/commit. Superseded reads release queue immediately and cannot alter content/persistence/recovery. Manual/hidden-path changes verify first.

Reveal each changed tree destination once per visible container; revalidation cannot repeat scrollIntoView or undo user scroll. Pointer navigation keeps row anchor; selection typography/geometry never transitions.

## Creating a child directory
Released picker owns New folder and nonmodal anchored popup:parent, name, actions, focus, Enter/Escape, pending/stale-request handling. No extra backdrop/resize. Escape/Cancel/outside idle closes popup only. Failure retains name/local error. One authenticated callback serves Flower, DirectoryInput/Env adapters. Names are one child, not traversal/nested paths. Success refreshes parent; enter/confirm remain explicit. Canceling picker preserves draft and cannot undo submitted work.

Env App uses nonrecursive filesystem RPC/invalidation; Desktop exact POST /_redeven_proxy/api/fs/mkdir. Both share filesystem/scope/Git mutation owners. Require session write, strict fields, existing parent and preserve existing entries. No recursive creation, synthetic list or automatic retry. Unknown effects require inspection. All ten locales translate errors. Compatibility epoch 70 requires the Desktop resource; older peers upgrade. Gateway/Floret/schema unchanged.

## Shared directory favorites
[Favorites](directory-favorites.md) owns scoped persistence/refresh/failures; shortcut views cannot confirm an old selection.

# Boundaries

The published picker owns navigation and request lifetime. A validated selection represents the current form intent only; the runtime checks authorization again when the product operation executes.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.localization.browser.test.tsx` - Ten-locale live translation preserves picker/composer inputs.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Published absolute-path parsing and localized recovery.

- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.paths.browser.test.tsx` - Localized/narrow navigation recovery, retained listings, paths, cache, cancellation and permissions.

- redeven:internal/codeapp/appserver/server_fs_mkdir_test.go — actual creation, duplicate preservation, strict requests, outside-scope and session write rejection.
- redeven:internal/envapp/ui_src/src/ui/FlowerSurface.directoryPicker.test.shared.tsx — creation, explicit confirmation, failed-name retention and canceled draft preservation.
- redeven:internal/envapp/ui_src/src/ui/FlowerSurface.localization.browser.test.tsx — all shipped locales across light/dark and narrow/desktop layouts.
