---
type: UI Contract
title: Files context menus
description: Keep file operations reachable inside the complete Files workspace across Activity, floating windows, Workbench, and touch layouts.
tags: [ui, files, menus, mobile, workbench]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

Published Floe Webapp owns file-menu placement, visible-viewport intersection,
measurement, scrolling, submenu navigation, gesture handling, and dismissal.
Redeven supplies the complete Files workspace boundary, product actions, and
localized labels. Menus stay at least 8 CSS px inside the usable intersection of
Files, the owning surface, and the visible viewport. Invalid or unavailable explicit boundaries close the menu. Files does
not raise its global layer or duplicate Workbench coordinate conversion to make
an obscured action reachable.

# Contract

Files diff inspection uses a nonmodal desktop Activity window, a saved Workbench
component, or the shared mobile modal. Every presentation has a constrained
patch viewport with access to the last diff line. Missing files or diffs keep
a stable empty/error state with explicit refresh.

## Layout ownership

The directory tree and file content share the outer `BrowserWorkspaceShell`
boundary. Activity, Files floating windows, and Workbench keep their existing
shared portal ownership. The upstream layer measures actual menu content before
showing it, moves it left or up when necessary, and constrains width and height.
Long labels wrap; oversized menus scroll internally with their action order,
groups, and destructive styling intact.

Mobile has no persistent Flower accessory rail, so Files needs no product-specific
bottom cutout. The shared Floe visible-viewport mechanism accounts for browser
chrome and screen safe areas. Files measures its root on resize and before input
triggers so a later open uses current client geometry.

## Input and navigation

Desktop menus open near the pointer. Submenus prefer lateral placement and flip
when needed. Touch layouts and insufficient lateral space navigate the same
menu tree inside one panel with a localized Back action. Touch menu items and
Back are at least 44 CSS px high. Input capability and the configured mobile
layout query remain upstream decisions.

File rows, tiles, and the directory tree use the same upstream long-press
handlers. Movement, cancellation, and additional pointers cancel a pending long
press. The release click after a long press cannot navigate the tree or execute
a menu item. The menu is above the mobile tree drawer and scrim, and menu actions
do not close the drawer through click propagation.

Menu-local scroll remains open. The actual constrained menu viewport receives
the exported Redeven local-scroll props. [Workbench input ownership](workbench-input-ownership.md)
continues to decide whether a selected widget owns scrolling; unselected widgets
cannot acquire wheel ownership by displaying a menu.

Arrow keys, Home/End, Enter, Escape, and Tab retain shared menu semantics. Escape
in a submenu returns to its parent; root Escape and Tab restore trigger focus.
External pointer/focus/scroll, resize, visual-viewport changes, window blur, and
hidden or inactive owners dismiss the menu. Size and orientation changes close
the current menu; the next trigger starts a fresh placement.

# Boundaries

## Diff inspection

Shell owns View Diff routing and captures the repository, workspace section,
and exact old/new file paths at activation. Later Files navigation cannot retarget
an existing inspection. Desktop Activity uses `PreviewWindow`; Workbench uses
`redeven.git-diff` with the standard projected widget header, movement, resizing,
selection, removal, and input ownership. Activity windows are hidden while
Workbench is active. Mobile retains the viewport-sized modal. All presentations
consume the same request, mode, and selection contracts as
[Git diff inspection](git-browser-visual-states.md).

Workbench atomically saves target identity and geometry through its runtime
layout owner. Reopening the same repository, section, and paths focuses the
existing component without replacing its geometry; a different section is a
distinct target. Saved targets contain no patch snapshot. Restoration reads
current Git content, even if the current filesystem path is absent: tracked
deletions remain valid diffs. Untracked inspection verifies current Git section
membership before synthesizing a no-index patch, so staging a file cannot leave
a phantom untracked diff. Unavailable repositories/files/diffs keep their
component and present a recoverable error; successful responses without a file
settle as empty and never retain a loading overlay or obsolete patch. Refresh
invalidates both patch and full-context requests, and late results cannot replace
the refreshed selection. Browser restoration may load the saved layout before
RPC connects; the shared diff panel waits for its transport and follows the
connection and error ownership rules in Git diff inspection above. Restoring a
target must not turn this ordering into a missing-file error or require manual
refresh after connection succeeds.

The window, canvas widget, or modal supplies a definite height and a shrinkable content body.
The patch owns vertical scrolling, while the title, mode controls, and patch
actions stay outside that viewport. The persistent horizontal scrollbar and
Show All Lines action stay inside the visible surface. Expanding a long patch,
loading full context, and resizing the surface must keep its last line
reachable. A modal height ceiling alone cannot establish this scroll boundary.

## Mutation results

Successful creation closes the name dialog, inserts the entry into the loaded
parent directory, and reveals the new entry. Creation, duplication, and moves
use the same concrete directory-node tree as loaded snapshots: scoped roots,
including `/`, contain entries in their children rather than as sibling nodes.
Insertion requires a loaded parent and does not duplicate an existing path.
Users do not need to refresh a loaded root to see a successful creation or copy.

## Menu ownership

Existing context-event target snapshots, multi-selection, permissions, file
operations, and confirmation owners are unchanged. The menu does not add backend
APIs, perform mutations outside the existing callbacks, or replace deletion
confirmation. [Workbench surface lifecycle](workbench-surface-lifecycle.md) owns
the common projected host and local interaction contract.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.e2e.test.tsx` - Verifies that Files passes a stable diff target to Shell in Activity and Workbench without preloading content.
- `redeven:internal/gitrepo/diff_content_availability_test.go` - Checks disappeared changes, staged former untracked files, exact whitespace paths, and valid tracked deletions.
- `redeven:internal/workbenchlayout/git_diff_widgets_test.go` - Verifies atomic placement, exact identity, geometry reuse, unavailable targets, and rollback.
- `redeven:internal/envapp/ui_src/src/ui/workbench/WorkbenchGitDiffWidget.browser.test.tsx` - Verifies projected scrolling, resizing, selection, removal, and unavailable-target recovery.
- `redeven:internal/envapp/ui_src/src/ui/widgets/GitDiffDialog.browser.test.tsx` - Checks long-patch expansion, both scroll axes, modal and floating containment, background interaction, resizing, and closing.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserShared.test.ts` - Verifies root-node insertion, duplicate suppression, and loaded-parent requirements against the snapshot tree shape.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.tsx` - Supplies the complete workspace boundary and local-scroll props to published FileContextMenu.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Derives the Activity content bottom limit from the existing mobile Flower rail style.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSidebarTree.tsx` - Reuses upstream long-press and release-click suppression for directory rows.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.contextMenu.browser.test.tsx` - Covers collision, final-action hit testing, narrow layouts, gestures, scrolling, and projected or floating hosts.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Checks Files against the actual mobile rail and changed keyboard viewport.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserWorkspace.e2e.test.tsx` - Preserves target, selection, background, and Workbench interaction behavior.
- `redeven:internal/envapp/ui_src/package.json` - Pins the published Floe Webapp release that owns the shared menu behavior.
