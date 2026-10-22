---
type: UI Contract
title: Files context menus
description: Keep file operations reachable inside the complete Files workspace across Activity, floating windows, Workbench, and touch layouts.
tags: [ui, files, menus, mobile, workbench]
timestamp: 2026-09-23T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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

Files diff inspection uses a nonmodal desktop Activity window, a saved Workbench component, or the shared mobile modal. Missing files or diffs keep a stable empty/error state with explicit refresh.

## Layout ownership
The directory tree and file content share the outer `BrowserWorkspaceShell` boundary.

Files measures its root on resize and before input triggers so a later open uses current client geometry.

## Input and navigation
Desktop menus open near the pointer.

The release click after a long press cannot navigate the tree or execute a menu item.

Size and orientation changes close the current menu; the next trigger starts a fresh placement.

# Boundaries

## Diff inspection
Shell owns View Diff routing and captures the repository, workspace section, and exact old/new file paths at activation. Later Files navigation cannot retarget an existing inspection.

A modal height ceiling alone cannot establish this scroll boundary.

## Mutation results
Successful creation closes the name dialog, inserts the entry into the loaded parent directory, and reveals the new entry. Users do not need to refresh a loaded root to see a successful creation or copy.

## Menu ownership
Existing context-event target snapshots, multi-selection, permissions, file operations, and confirmation owners are unchanged. [Workbench surface lifecycle](workbench-surface-lifecycle.md) owns the common projected host and local interaction contract.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.e2e.test.tsx` - Verifies that Files passes a stable diff target to Shell in Activity and Workbench without preloading content.

- `redeven:internal/gitrepo/diff_content_availability_test.go` - Checks disappeared changes, staged former untracked files, exact whitespace paths, and valid tracked deletions.

- `redeven:internal/workbenchlayout/git_diff_widgets_test.go` - Verifies atomic placement, exact identity, geometry reuse, unavailable targets, and rollback.
