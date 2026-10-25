---
type: UI Contract
title: Plugin layout continuity
description: Preserve saved plugin components across runtime lifecycle changes, and open independently in the current display mode.
tags: [ui, plugins, workbench, persistence, recovery]
timestamp: 2026-09-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven persists exact plugin widget/instance/surface identity and geometry; ReDevPlugin owns live authority. Upgrade, disable, permission/reconnect failures retain placement. Only explicit removal or confirmed exact-instance uninstall deletes it. Recovery reconciles unknown outcomes without focusing/rearranging the canvas or silently recreating authority.

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

- `redeven:internal/workbenchlayout/plugin_widgets.go:1` - Atomic placement, exact-instance removal, and layout event publication.

- `redeven:internal/workbenchlayout/plugin_widgets_test.go:1` - Idempotency, concurrency, rollback, metadata, and geometry preservation.

- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:1` - Read/save recovery, explicit placement, and in-place binding refresh.
