---
type: UI Contract
title: Absolute filesystem directory selection
description: Select authorized directories through one navigation core in Flower, Spaces, and other filesystem pickers.
tags: [ui, filesystem, flower, spaces, workbench]
timestamp: 2026-09-21T00:00:00Z
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

DirectoryPicker, DirectoryInput, and file pickers consume the same released
navigation core. Context comes from `fs.getPathContext()` or the equivalent
Desktop Local API. The runtime declares roots, their filesystem policy read/write
flags, the default root ID, and a display-only Home path. A failed or malformed
context cannot be replaced by synthesized Home or Root permissions.

The initial location is the caller's current absolute directory, otherwise the
runtime's declared default root. Home, Root, custom roots, breadcrumbs, directory
rows, and entered paths all use one direct directory-list operation. Navigation
does not enumerate ancestors first. Inputs accept absolute paths, `~`, and
`~/...`; relative paths are rejected rather than rebased to Home. Home formatting
may display `~` only at an exact path boundary. Entry paths, request paths, and
selection results keep absolute semantics through the product adapter.

The filesystem service resolves real paths and symlinks. A directory readable
under current policy may be selected even when its root has write disabled.
Selection neither changes policy nor promises a sandbox for code-server or other
processes. Session, filesystem, OS, and process authorization remain governed by
[permission policy and filesystem scope](../security/permission-policy-and-filesystem-scope.md).

## Navigation state and failures

Every mounted picker owns its current directory, loaded entries, path input,
hidden-item switch, and validity. Files uses the same runtime authority but keeps
its own navigation state. Redeven has no picker directory cache or Home-relative
tree. Upstream deduplicates only in-flight loads within one open session.

Each open refreshes path context. Environment/session changes, closing, and
unmounting invalidate pending work. Editing a path invalidates selection; only a
successful load for the current intent can make it selectable. Earlier successes
or failures cannot overwrite newer input, navigation, error, or selection state.
An error does not become an empty-directory success or trigger a Home fallback.

Runtime errors distinguish missing paths, non-directories, scope denial, session
read denial, host filesystem denial, invalid paths, and connection failure. The
path remains visible with localized recovery. A cached or previously validated
selection is never an authorization token: creation and later operations can fail
if policy, filesystem contents, or OS permissions change.

## Product presentations

Files uses the same released `parsePickerPath` and `formatPickerPath` functions
for its path editor. An entered `/...` path never acquires a Home prefix,
regardless of the currently selected root. Home expands only `~` and `~/...`;
the `/` breadcrumb is labeled Root. Invalid input and unavailable Home have
localized, actionable feedback. Files retains its existing directory request,
cache, cancellation, and commit owner rather than mounting a picker navigation
controller. File items, identifiers, menu callbacks, drag targets, and reveal
requests pass through the workspace with their original absolute paths and
identity. There is no Home-relative display tree or reverse path conversion.

Files uses the actual workspace chrome throughout module loading, path discovery,
and first directory loading. Before a successful snapshot exists, the published
Floe list or grid renders structural placeholders using its actual columns, row
or tile dimensions, icon slots, and saved view mode. The status bar reserves its
normal height without showing an unconfirmed count or path. Redeven path segments
and root/directory placeholders share the real breadcrumb and tree geometry. A
plain loading message in an otherwise empty body is not a matching skeleton. An
uninitialized empty array must not claim an empty directory, Root location, or
item count. Module and data loading use the same workspace. Ordinary refresh
and same-environment session replacement keep the last successful directory,
including an empty result, and only animate the refresh icon. Reconciliation by
absolute file identifier preserves surviving rows across refreshed metadata and
Git decorations. Environment changes cancel directory work and invalidate pending
path-context responses before they can update the new view.

[Document reload presentation](document-reload-presentation.md) owns Files' full
reload bridge. It persists anonymous layout geometry, not directory snapshots.

Files treats a failed directory load as a settled outcome in its existing view
state. A deleted saved location, unmounted volume, denied directory, or connection
failure cannot restart hydration merely because no snapshot is available. The
content scroll viewport displays a compact recovery composition when no snapshot
is available. The folder name identifies the target above the explanation and full
selectable path, with inline copy feedback. Parent navigation is emphasized when
available; scope administrators can open access management, and other failures
emphasize Retry. Retry and Home remain explicit alternatives. Pending recovery
stays in place, prevents duplicate retry activation,
and preserves keyboard focus across failure without a blocking curtain. Unavailable
contents show neither an empty-folder message nor an item count; roots and path
controls remain available. A retained snapshot uses a compact, dismissible notice
above its contents, including during a transient connection failure.

Files never probes ancestors or rewrites a failed target to Home automatically.
Retry, navigation, or a new runtime session may initiate a new request. The latest
successful response alone commits path callbacks and persistence; optimistic
cache display does neither. A deterministic failure invalidates the affected
cached subtree. Recovery uses the same request, cancellation, and commit owner,
without a notification loop, retry timer, or separate recovery controller.

Flower opens a directory modal at the draft directory and commits only on
confirmation. Its default Recently used tab sits beside the root tabs and shares
their content area; choosing a suggestion opens directory browsing with path-input
focus. Suggestions derive from current workspace root conversation summaries,
sorted by latest update and deduplicated by absolute
path; pinned order does not change recency. The list contains at most three
directories and disappears when empty. No separate browser history or cross-host
path store is introduced. The published picker's `suggestedPaths` entry points
display directory names and full-path hints, and navigate through the same
loader as typed paths. A deleted or denied recent directory stays unconfirmed
with normal recovery; historical use grants no access. Canceling leaves the
composer draft unchanged. A created
conversation keeps its immutable runtime-normalized directory. The default shown
for a new conversation and its creation request use the declared default root;
a context from an earlier runtime session cannot supply that default.
[Working-directory navigation](flower-working-directory-navigation.md) owns
subsequent Files and Terminal actions for existing conversations.

Spaces keeps directory navigation inline in its creation form, with name and
description editable alongside it. Successful navigation fills the final path
segment as the name, or the localized Root label for `/`. Each metadata field
stops following directory defaults as soon as the user edits that field. Creation
requires a validated directory. A create failure retains all form data; closing
resets the draft. Spaces and Flower store the backend-normalized absolute path
without a new protocol or database schema.

Terminal groups, managed services, container mounts, Compose file selection, and
archive extraction retain their own initial positions, file-type constraints,
selection counts, and operation authorization. Extraction still checks destination
write permission. The shared picker owns navigation only. Its actual scroll
viewports carry Workbench local-scroll markers; existing modal, keyboard, and
focus ownership remains with the host and published presentation components.

# Boundaries

The published picker owns navigation and request lifetime. Redeven supplies
runtime context and maps metadata without creating an alternate cache,
navigation state machine, or permission grant. A validated selection represents
the current form intent only; the runtime checks authorization again when the
product operation executes.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Published path parsing and formatting, absolute identity, and localized input recovery.
- `redeven:internal/envapp/ui_src/src/ui/pages/FileBrowserPageLoading.tsx` - Shared workspace presentation before the Files module is ready.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserRecoveryView.tsx` - Responsive unavailable-folder presentation and local copy feedback over existing navigation state.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.paths.browser.test.tsx` - Real Files input through runtime directory requests, root selection, persistence, failure, and cancellation.
- `redeven:internal/envapp/ui_src/src/ui/services/filesystemPicker.ts` - Runtime and Workbench adapter without independent navigation state.
- `redeven:internal/flower_ui/src/filePicker/filesystemPicker.ts` - Absolute entries, declared roots, and shared runtime failure classification.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Draft selection, runtime-scoped default, and creation intent.
- `redeven:internal/envapp/ui_src/src/ui/pages/CreateCodespaceDialog.tsx` - Inline form, field edit ownership, and validated submit.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.directoryPicker.test.shared.tsx` - Published modal integration exercised in DOM and Chromium.
- `redeven:internal/envapp/ui_src/src/ui/pages/CreateCodespaceDialog.test.shared.tsx` - Absolute selection, request races, failure recovery, and metadata preservation.
- `redeven:internal/ai/threads_working_dir_test.go` - Canonical external directory storage and revoked grants.
- `redeven:internal/codeapp/backend_test.go` - Canonical Space storage and symlink scope rejection.
