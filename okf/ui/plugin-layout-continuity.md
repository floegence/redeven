---
type: UI Contract
title: Plugin layout continuity
tags: [ui, plugins, workbench, persistence, recovery]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven persists exact widget/instance/surface geometry; ReDevPlugin owns authority. Upgrade/disable/permission/reconnect errors retain placement. Only explicit removal or confirmed exact uninstall deletes. Unknown outcomes reconcile without moving canvas or recreating authority.

# Contract

## Independent display modes
Open uses the mode captured at request time with independent SDK slots; neither mode creates a Plugin Center widget.

## Placement and deletion
`workbench/actions/open_plugin` atomically creates/reuses exact instance/surface binding. Late requests cannot lower management revision or substitute surfaces. Failed product cleanup retries reconciliation, never uninstall.

## Runtime replacement
Containers retain identity as SDK leases retire. Committed/unknown platform outcomes invalidate slot registry first, without close after revocation. Shell reconnect owns disconnection; authenticated inventory recovery restores the same layout.

## Layout failures and concurrent windows
Failed initial reads keep canvas unready/autosave off with Retry. Saved cards offer explicit reload for fresh authority rather than indefinite preparation or retired-session reuse.

# Boundaries

Redeven layout operations never grant plugin authority or inspect platform stores. Layout retention does not reconstruct historically deleted placements or plugin memory that was never saved by the plugin itself.

# Evidence

- `redeven:internal/workbenchlayout/plugin_widgets.go:1` - Source.
- `redeven:internal/workbenchlayout/plugin_widgets_test.go:1` - Tests.
