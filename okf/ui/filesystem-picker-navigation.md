---
type: UI Contract
title: Absolute filesystem directory selection
description: Select authorized directories through one navigation core in Flower, Spaces, and other filesystem pickers.
tags: [ui, filesystem, flower, spaces, workbench]
timestamp: 2026-09-08T00:00:00Z
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

Flower opens a directory modal at the draft directory and commits only on
confirmation. Canceling leaves the composer draft unchanged. A created
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

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/filesystemPicker.ts` - Runtime and Workbench adapter without independent navigation state.
- `redeven:internal/flower_ui/src/filePicker/filesystemPicker.ts` - Absolute entries, declared roots, and shared runtime failure classification.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Draft selection, runtime-scoped default, and creation intent.
- `redeven:internal/envapp/ui_src/src/ui/pages/CreateCodespaceDialog.tsx` - Inline form, field edit ownership, and validated submit.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.directoryPicker.test.shared.tsx` - Published modal integration exercised in DOM and Chromium.
- `redeven:internal/envapp/ui_src/src/ui/pages/CreateCodespaceDialog.test.shared.tsx` - Absolute selection, request races, failure recovery, and metadata preservation.
- `redeven:internal/ai/threads_working_dir_test.go` - Canonical external directory storage and revoked grants.
- `redeven:internal/codeapp/backend_test.go` - Canonical Space storage and symlink scope rejection.
