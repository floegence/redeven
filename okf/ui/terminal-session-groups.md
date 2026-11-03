---
type: UI Contract
title: Terminal session groups
tags: [ui, terminal, groups, activity, workbench, sqlite]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Runtime catalogs own groups, assignments and named views; Activity/Workbench share environment projection with local expansion/active view. Default is immutable and every session has one known group_id. Membership is independent of placement, cwd, controller and recovery.

# Contract

## Stores and authority
Open versioned apps/terminal/groups.sqlite and views.sqlite before readiness; future/wrong-kind/drifted state stays unchanged. Atomically reorder full non-Default list; Default stays zero.

View thumbnail opens layout picker, name activates; footer targets active view, row picker may change inactive view.2–32 slot choices preserve members/vacancies/selection. Thumbnails omit visible labels but keep accessible names/keyboard.

Views: terminal_view_catalog v3; RPC2024–2027 list/put/delete/notify,2028 atomic batch, process-launch/access-gate protected. Store ID/name/published SplitWorkspace geometry/occupancy/revision/timestamps. Pane empty:true means vacancy, no session claim. Limits64 views/32 panes/depth16/64KiB layout/128-byte IDs/64-character names. Validate shape/unique nodes/axis/ratio. Check touched views/catalog revision atomically; reject duplicate ownership/stale transfer. Cross-view transfer writes both and emits one snapshot; view deletion preserves PTYs.

Contiguous v1→v2 keeps session in highest-revision view, then newest creation, then lexical ID; prune older duplicate leaves/empty aliases without modifying sessions. v2→v3 validates existing records unchanged and enables vacancies. Close atomically replaces owned slot with fresh vacancy identity, retains geometry and emits catalog before closure event. Invalid stores remain untouched.

## Projection and UI
Navigation calls collection Groups. Icon-only plus matches Views with New group tooltip/name; scoped New session in {group} remains. Editors call default path Startup directory; membership never implies cwd.

One provider owns membership/order. Sessions/groups/views wait for current-channel Shell access and process permission, not transport/cache alone. Restored access hydrates; retirement fences replies and retains presentation. Late replies cannot undo moves/deletes; unknown groups refresh without reassignment. Deletion closes/hides members first; failures name sessions without guessed success/retry.

Search groups/paths/session presentation, temporarily reveal folded matches; views search names. Sidebar defaults258px, persists per environment/panel220–480px and reserves space. Floe ResizeHandle owns drag; arrows/Home/End keyboard; overlays have independent width.

Search/refresh replaces Quick switch. Desktop rows32px, larger mobile targets. Yellow Floe folder/disclosure/create/actions; rounded fill-selected session tiles, no rail. No view/group count badges; paths tooltip, secondary actions menu. Close visible hover/focus/touch; desktop24px actions/compact gap/indent, empty activity no title width. Reveal without title shift.

Rows/icons drag separately from buttons. Session preview follows scaled Workbench pointer; group preview stays sidebar. Split changes placement, group target membership/order. Metadata never remounts Runtime.

# Boundaries

No duplicate membership maps, path-inferred groups or unknown→Default assignment. [Workspace](../architecture/env-app-terminal-and-surface-composition.md) owns selection/autosave/rendering.

# Evidence

- redeven:internal/terminal/group_catalog.go
- redeven:internal/terminal/view_catalog.go
- redeven:internal/terminal/view_catalog_test.go
