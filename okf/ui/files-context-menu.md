---
type: UI Contract
title: Files context menus
tags: [ui, files, menus, mobile, workbench]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe owns file-menu placement, scrolling, gestures and dismissal; Redeven supplies bounds/actions/locales. Keep menus eight CSS pixels inside Files/surface/visible viewport intersection. Invalid bounds close; never escape global layers or duplicate Workbench transforms.

# Contract

## Layout ownership
Directory tree/content share `BrowserWorkspaceShell`. Measure on resize and before triggers for current client geometry.

## Input and navigation
Desktop menus open near the pointer. Long-press release cannot navigate or execute an item. Size/orientation changes close menus; the next trigger creates fresh placement.

# Boundaries

## Diff inspection
Shell owns View Diff routing and captures the repository, workspace section, and exact old/new file paths at activation. Later Files navigation cannot retarget an existing inspection.

Diff uses nonmodal desktop Activity windows, persisted Workbench widgets or the mobile modal; unavailable targets retain empty/error state and explicit refresh.

## Mutation results
Successful creation closes the name dialog, inserts the entry into the loaded parent directory, and reveals the new entry. Users do not need to refresh a loaded root to see a successful creation or copy.

## Menu ownership
Existing context-event target snapshots, multi-selection, permissions, file operations, and confirmation owners are unchanged. [Workbench surface lifecycle](workbench-surface-lifecycle.md) owns the common projected host and local interaction contract.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.e2e.test.tsx` - Tests.
