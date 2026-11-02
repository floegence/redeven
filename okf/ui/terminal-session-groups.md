---
type: UI Contract
title: Terminal session groups
tags: [ui, terminal, groups, activity, workbench, sqlite]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Runtime catalogs own groups, assignments and named views. Activity/Workbench share environment projection; expansion/active view stay local. Default is immutable; every session has one known group_id. Membership is independent of placement, cwd, controller identity and recovery.

# Contract

## Persistence and permissions

Redeven owns versioned apps/terminal/groups.sqlite and views.sqlite, opened before readiness. Future/wrong-kind/drifted stores remain unchanged. Group reorder atomically persists the full non-Default order; Default stays at zero.

Views use schema kind terminal_view_catalog, version 1. RPC 2024–2027 list/put/delete/notify use process-launch permission and the access gate. Records store ID, name, published SplitWorkspace JSON, revision and timestamps. Bounds: 64 views, 32 panes, depth 16, 64KiB layout, 128-byte IDs, 64-character names. Validate shape, unique nodes, axis and ratio. Atomic writes check per-view and database catalog revisions. Notifications carry full snapshots. Deleting views preserves sessions.

## Projection and interaction

One Terminal Session Catalog Provider owns membership/display order. Lifecycle fences prevent stale replies overwriting moves/deletes; unknown groups refresh without reassignment. Group deletion closes/hides members first; failures identify sessions without fabricated success or silent retry.

Search matches group names/paths and session presentation, revealing folded matches temporarily. Views filter by name. Sidebar defaults to 258px, persists per environment/panel within 220–480px and reserves content space. Floe ResizeHandle owns pointer resizing; arrows/Home/End support keyboards. Overlays retain independent width.

Search/refresh replaces Quick switch. Desktop rows are 32px; mobile targets are larger. Groups show Floe yellow folder icons, disclosure, creation and actions. Rounded session tiles use fill selection without rails. View/group rows have no quantity badges. Paths stay in tooltips; actions use accessible menus.

Rows/icons drag independently of buttons. Session previews follow the pointer across scaled Workbench; group previews remain in the sidebar. Split drops change placement only; group targets own membership/order. Metadata must not remount runtimes.

# Boundaries

Never duplicate membership maps, infer groups from paths or assign unknown groups to Default. [Workspace composition](../architecture/env-app-terminal-and-surface-composition.md) owns view selection/autosave/rendering.

# Evidence

- redeven:internal/terminal/group_catalog.go - Protected Default and atomic writes.
- redeven:internal/terminal/view_catalog.go - Validated versioned view store.
- redeven:internal/terminal/view_catalog_test.go - Persistence, conflicts, incompatible stores and permissions.
