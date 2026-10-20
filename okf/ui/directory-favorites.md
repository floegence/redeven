---
type: Product Contract
title: Personal directory favorites
description: Persist and share authorized directory shortcuts across Runtime clients without changing navigation or conversation defaults.
tags: [filesystem, ui, storage, security, desktop, flower]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Runtime owns one directory-favorites store. Each authenticated namespace, endpoint
and user has an independent ordered path set and revision. Env App and Desktop
supply this metadata to published Floe controlled pickers and product menus; the
existing filesystem navigator remains the only path validation and selection owner.

# Contract

## Persistence and authentication

The Runtime opens apps/filesystem/directory-favorites.sqlite through sqliteutil
before service readiness and closes it with Code App. Schema v1 is initialized
transactionally; existing tables, objects and records are verified and unsupported
or future schemas fail before a writable open. This store is independent of AI
readiness, conversation databases and personal new-conversation preferences.

The authenticated HTTP resource /_redeven_proxy/api/fs/directory_favorites accepts
GET, PUT and DELETE. Mutation bodies contain only path; queries and additional
fields are rejected. The server derives namespace, endpoint and user from the
accepted session and requires environment read permission. PUT validates an existing
readable directory and its real target against filesystem scope. Write and execute
grants are unnecessary. DELETE accepts normalized paths even when their targets no
longer exist or are accessible. Normalized logical absolute addresses remain distinct
for symlink aliases; realpath is authorization evidence, not stored identity.

Each item mutation and returned snapshot share one transaction. New favorites sort
first; adding an existing path preserves its order. No-op additions/removals retain
revision. Concurrent changes to different paths cannot overwrite each other. There
is no ten-item cap, automatic deletion, move tracking, grouping or custom naming.

## Client ownership and interaction

One in-memory client per authenticated environment supplies every mounted entry.
Successful mutation snapshots update all local consumers. Revision ordering rejects
older reads; retiring a client aborts requests, clears its views and prevents captured
old actions from writing. Connection binding changes create a new client; Desktop
keys the owner by target environment and Runtime session. Focus, picker opening and
reconnection refresh the server snapshot without polling or a persistent event stream.

Initial load failure offers retry; refresh failure retains displayed paths. Failed
mutations preserve confirmed state and expose localized feedback. Per-path pending
state prevents duplicate submissions. Ordinary browsing remains usable if favorites
are unavailable. Choosing a favorite navigates and validates, then permits explicit
confirmation; it never silently confirms a form or edits conversation defaults.
Unavailable destinations retain their requested path and normal recovery. Users can
remove an invalid favorite without navigating there.

Captured menus keep their target path and environment client even when selection
changes. Stars and navigation buttons are siblings, with full-path accessible labels,
keyboard menu access, Escape/focus restoration and visible touch actions. Favorites
filter only the current list and scroll in bounded local viewports.

Files places favorites immediately after Home and Computer in the same sidebar
locations group, before the directory tree. Each shortcut uses the standard
FileItemIcon folder and compact single-line root-row spacing. The parent path
shrinks with an ellipsis before the final directory name; an unusually long final
name truncates only when it cannot fit by itself. Hover and keyboard focus show
the complete absolute path in a tooltip. Full-path accessible labels, current-path
highlighting, keyboard navigation, bounded scrolling and list filtering remain
available. A separate More button opens the captured directory menu, including
removal, on touch and pointer devices without navigating. No separate title card,
second path line or persistent favorite star occupies the sidebar.

## Compatibility

Runtime compatibility epoch 69 requires this exact authenticated resource and Desktop
route allowlist. Older Runtimes use the established upgrade flow. Floret APIs, domain
schema, conversation lifecycle, file-operation authorization and Runtime Service
protocol version remain unchanged.

# Boundaries

Favorites are personal navigation metadata owned by Redeven. They grant no access,
contain no directory contents, and do not modify Flower defaults or conversation
state. Floe owns controlled picker presentation and filesystem navigation; the host
owns authenticated snapshots and refresh. Floret does not participate in this feature.

# Evidence

- redeven:internal/directoryfavorites/store.go — transactional scoped persistence and schema verification.
- redeven:internal/directoryfavorites/store_test.go — isolation, persistence, concurrency, rollback and invalid schemas.
- redeven:internal/codeapp/appserver/directory_favorites_api.go — authenticated read-only directory admission and item mutations.
- redeven:internal/codeapp/appserver/directory_favorites_api_test.go — path, symlink, identity and read-permission checks.
- redeven:internal/flower_ui/src/filePicker/directoryFavorites.ts — shared snapshots, revision fencing, pending actions and disposal.
- redeven:internal/envapp/ui_src/src/ui/services/sessionHTTP.ts — authenticated Env App lifetime.
- redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSidebarTree.tsx — shared root and favorite locations group.
- redeven:internal/envapp/ui_src/src/ui/widgets/DirectoryFavoritesSection.browser.test.tsx — compact rows, tail visibility, tooltip, menus and scrolling.
- redeven:desktop/src/welcome/App.tsx — shared target-Runtime owner for Desktop Flower surfaces.
- redeven:desktop/src/main/runtimeFlowerRoutes.ts — exact method and resource admission.
