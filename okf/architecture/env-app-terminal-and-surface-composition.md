---
type: Frontend Contract
title: Env App terminal and surface composition
tags: [architecture, env-app, terminal, ui]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Env App adapts Floeterm PTY facts and Floe shell, focus, selection and KeepAlive. File preview defaults to main surface. A session owns <=one view. Selecting it activates/focuses that view, even from standalone/another view; unowned sessions appear alone.

# Contract

Chunked history remains an atomic canonical-dimension snapshot; compound controls use Floe CSS.

## Placement
Published SplitWorkspace owns splits/adaptive layouts/docking/swaps/accessible resize. Split creates backend view; subsequent placement edits update it. Named independent views have thumbnails, layout/rename/delete controls and creation above Groups.

Cross-view drag atomically moves membership, leaving vacancy. Pane/sidebar close terminates named session without deleting view/collapsing geometry. Only Delete view releases members without stopping them. New views create fresh sessions.

Footer layout targets current view; row picker targets its view without activation. Preserve members, unavailable sessions, vacancies, reading order and selection. Published adaptive options deduplicate balanced rows/columns/grids/four main directions for2–32 slots; disable standalone/single-slot pickers. Geometry gallery has Adjust layout heading, accessible names/current selection/keyboard. Resolve latest target membership on apply, never stale snapshot. Add only by explicit split/drag/vacancy creation. Split uses target group and verified local cwd or group startup directory; group/cwd remain independent.

Desktop begins at pane headers with preference-controlled Workbench indicators. Footer keeps layout/search/clear/settings/create; Groups scoped creation and overlay toolbar/drawer remain. Split/attach never globally covers panes. Environment/view changes fence placement. Mobile tabs do not rewrite desktop trees. No maximize mode; Alt+Shift+Left/Right cycles.

Pane chrome uses terminal foreground/background, not ANSI blue; sidebar shell tokens. Session tiles14px, fine borders/neutral fills; headers28px. Rename preselects existing name via Floe autofocus. Idle hover pointer; dragging grabbing. Sidebar close hover/focus/touch. Previews use foreground border/background isolation/contrasting fill; no shared geometry notices.

## Projection
One environment provider atomically revision-checks affected source/destination views. Edits survive acknowledgement; conflict retains draft for explicit reload/discard. Catalog waits for shell-confirmed access/current transport. Reconnect pauses requests, retains drafts and reloads after restored access. One lifecycle resets environment/permission authority; unchanged permission retains readiness/drafts, retired connections cannot publish. Edits await readiness.

Active view is panel-local. Import unowned legacyv1 local splits once, clearing only after backend acknowledgement. Missing sessions become vacancies without pruning geometry; close persists fresh vacancy IDs and keeps even empty view selected. Each vacancy offers localized creation/exact drag target. Within-view moves leave vacancy. Local progress/errors preserve failed-close session; empty selection never chooses unrelated session. Views never restart PTYs.

# Boundaries

Redeven supplies placement/permission/local-path capability/copy, not parsing/echo/history/rendering or duplicate shell token/layer/focus/recovery. Browser/semantic carriers verify integration; packaged Desktop qualification remains separate.

# Evidence

- redeven:internal/envapp/ui_src/src/ui/widgets/terminalWorkspace.ts
- redeven:internal/envapp/ui_src/src/ui/services/terminalViewCatalog.ts
- redeven:internal/envapp/ui_src/scripts/checkTerminalWorkspace.mjs: real PTYs, retained nodes, cross-browser views/mobile/reload.
