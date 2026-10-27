---
type: UI Contract
title: Terminal session groups
description: Persist one environment-wide terminal group catalog while Activity and Workbench render placement-specific trees.
tags: [ui, terminal, groups, activity, workbench, sqlite]
timestamp: 2026-09-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
The sidebar renders Group headers with explicit expand/collapse and scoped create-Session actions.

Header decoration must not offset that geometry on desktop or under Workbench scaling.

Individual failures are returned as explicit Session IDs; those Sessions remain hidden, no success is fabricated, and no silent retry loop is introduced.

# Boundaries

Group membership is not Workbench placement, shell working directory, controller ownership, attachment identity, or persistent Session recovery. No Activity or Workbench component may maintain a second membership map, infer membership from paths, or repair an unknown Group by changing a Session to Default. Group disclosure and metadata updates remain renderer-neutral UI state and must not remount `TerminalSessionRuntime`.

# Evidence

- `redeven:internal/terminal/group_catalog.go` - Owns the revisioned catalog, protected Default Group, and atomic product mutations.

- `redeven:internal/terminal/groups.go` - Resolves paths, serializes membership changes, deletion, and Group order, bounds closes, and registers Terminal group types 2017-2023.
