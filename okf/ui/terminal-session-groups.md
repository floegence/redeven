---
type: UI Contract
title: Terminal session groups
tags: [ui, terminal, groups, activity, workbench, sqlite]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Runtime catalog alone owns group identity/order/revision and each Session assignment. Activity/Workbench share a two-level tree with independent expansion/placement. Default always exists, immutable; every session has one known group_id, and group paths affect new startup only. Stale replies cannot regress; unknown groups refresh without reassignment. Delete closes/hides members first.

# Contract

## Catalog and Session assignment
Redeven owns `apps/terminal/groups.sqlite` as a versioned product database. Future versions, wrong kinds, and schema drift fail closed without replacing the file.

Reorder persists one complete non-Default order in a single database transaction and revision; Default remains protected at order zero.

## Activity, Workbench, and view-local state
One Terminal Session Catalog Provider owns the browser projection, the live in-memory Session display order, and the Redeven-specific `session_id -> group_id` membership map for the Environment. List requests carry membership and lifecycle fences, so an older response cannot overwrite a local move or newer notification.

Search matches Group name, Group path, and Session presentation; a matching folded child is revealed temporarily without changing that saved preference.

## Interaction and asynchronous lifecycle
The 258px sidebar starts with one search/refresh row, without a redundant title/count. One-line Group headers and Session rows are 32px on desktop. Groups use the published yellow Floe FolderIcon/FolderOpenIcon, count, disclosure, scoped create and action menu. Session actions share one accessible overflow menu. Full paths remain in tooltips; no secondary desktop path row or decorative tree rails. Mobile retains larger touch targets.

Session/group reorder and cross-group moves retain the catalog mutation contracts; Default remains first. Disclosure and metadata never remount terminal instances.

Individual failures are returned as explicit Session IDs; those Sessions remain hidden, no success is fabricated, and no silent retry loop is introduced.

# Boundaries

Group membership is not Workbench placement, shell working directory, controller ownership, attachment identity, or persistent Session recovery. No Activity or Workbench component may maintain a second membership map, infer membership from paths, or repair an unknown Group by changing a Session to Default. Group disclosure and metadata updates remain renderer-neutral UI state and must not remount `TerminalSessionRuntime`.

# Evidence

- `redeven:internal/terminal/group_catalog.go` - Revisioned group catalog and protected default/atomic writes.

- `redeven:internal/terminal/groups.go` - Paths and serialized group mutations/order, bounded close, RPC 2017–2023.
