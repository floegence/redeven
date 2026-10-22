---
type: UI Contract
title: Plugin layout continuity
description: Preserve saved plugin components across runtime lifecycle changes, and open independently in the current display mode.
tags: [ui, plugins, workbench, persistence, recovery]
timestamp: 2026-09-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns saved Workbench placement; released ReDevPlugin owns live surface
authority. A saved component keeps its widget id, exact plugin instance and
surface, coordinates, size, and z-order through upgrade, disable, permissions,
reconnect, and failure. Only explicit component removal or confirmed uninstall
of its exact instance deletes it. Runtime recovery never focuses, recenters, or
rearranges the canvas. Unknown mutation outcomes require authoritative inventory
reconciliation before fresh authority can open; they never delete layout.

# Contract

## Independent display modes
Open always uses the mode active when the action is requested.

Neither path creates a plugin-center canvas widget.

## Placement and deletion
`workbench/actions/open_plugin` creates or reuses an exact instance-and-surface binding in one transaction in the existing Workbench database. A delayed request cannot reduce its saved management revision or substitute another surface.

A failure in product cleanup stays retryable as reconciliation and never replays uninstall.

## Runtime replacement
Product containers retain their identity while SDK leases are retired. Committed and unknown platform outcomes first invalidate the local slot registry without calling close after SDK revocation.

Disconnect follows the Shell's unified reconnect screen; the same layout resumes after authenticated session and inventory recovery.

## Layout failures and concurrent windows
An initial layout read failure keeps the canvas unready and autosave disabled, with explicit Retry.

Saved cards offer an explicit page reload to acquire fresh authority; they do not remain in an indefinite preparing state or reuse the retired session.

# Boundaries

Redeven layout operations never grant plugin authority or inspect platform stores. Layout retention does not reconstruct historically deleted placements or plugin memory that was never saved by the plugin itself.

# Evidence

- `redeven:internal/workbenchlayout/plugin_widgets.go:1` - Atomic placement, exact-instance removal, and layout event publication.

- `redeven:internal/workbenchlayout/plugin_widgets_test.go:1` - Idempotency, concurrency, rollback, metadata, and geometry preservation.

- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:1` - Read/save recovery, explicit placement, and in-place binding refresh.
