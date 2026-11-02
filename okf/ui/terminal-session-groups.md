---
type: UI Contract
title: Terminal session groups
tags: [ui, terminal, groups, activity, workbench, sqlite]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

The runtime catalog owns groups and session assignments. Activity/Workbench share a two-level tree with local expansion/placement. Default is immutable; every session has one known group_id. Paths affect startup only. Stale replies cannot regress; unknown groups refresh without reassignment. Delete closes/hides members first.

# Contract

## Catalog and Session assignment
Redeven owns `apps/terminal/groups.sqlite` as a versioned product database. Future versions, wrong kinds, and schema drift fail closed without replacing the file.

Reorder persists one complete non-Default order in a single database transaction and revision; Default remains protected at order zero.

## Activity, Workbench, and view-local state
One Terminal Session Catalog Provider owns browser projection, display order, and the `session_id -> group_id` membership map per Environment. Membership/lifecycle fences prevent stale lists overwriting moves or notifications.

Search matches Group name, Group path, and Session presentation; a matching folded child is revealed temporarily without changing that saved preference.

## Interaction and asynchronous lifecycle
Sidebar width defaults to 258px, persists per environment/panel, and resizes within 220–480px while reserving content space. Floe ResizeHandle owns pointer resizing; arrows/Home/End support keyboards. Overlays retain their own width. A search/refresh row replaces title/count and Quick switch. Desktop rows are single-line, 32px. Groups use Floe yellow FolderIcon/FolderOpenIcon, count, disclosure, scoped create and actions. Session icons are rounded tiles; selection uses fill without a rail. Actions share an accessible overflow menu. Paths stay in tooltips; no desktop path rows or tree rails. Mobile keeps larger touch targets.

Rows/icons start drags independently of action buttons. Session previews follow the pointer across the panel, including scaled Workbench; group previews stay in the sidebar. SplitWorkspace drops change placement only; group targets retain catalog membership/order authority. Default stays first.

Failures return explicit Session IDs; those sessions remain hidden without fabricated success or silent retries.

# Boundaries

Membership is independent of placement, cwd, controller/attachment identity and recovery. Activity/Workbench must not duplicate membership maps, infer groups from paths, or assign unknown groups to Default. Disclosure and metadata must not remount `TerminalSessionRuntime`.

# Evidence

- `redeven:internal/terminal/group_catalog.go` - Revisioned group catalog and protected default/atomic writes.

- `redeven:internal/terminal/groups.go` - Paths and serialized group mutations/order, bounded close, RPC 2017–2023.
