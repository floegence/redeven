---
type: UI Contract
title: Plugin layout continuity
description: Preserve saved plugin components across runtime lifecycle changes, and open independently in the current display mode.
tags: [ui, plugins, workbench, persistence, recovery]
timestamp: 2026-09-08T00:00:00Z
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

Open always uses the mode active when the action is requested. The target contains
plugin identity and surface, with no placement preference. Activity and Workbench
own separate SDK slots and iframes; opening, closing, or switching one mode cannot
retire the other. Repeated Open activates the existing target within that mode.
Versions, permissions, enable state, and plugin business data still belong to the
same platform instance. Retaining layout does not restore unsaved plugin memory.

Plugin Center uses the current mode's management container. Workbench keeps a
large retained dialog above its inert canvas, with the existing overlay, focus,
and keyboard contracts. Canvas shortcuts are suspended while the management
dialog covers it or its mode is inactive. Search, filters, scroll, and selection
survive closing.
Successful placement dismisses management and focuses the component; placement
failure retains management and error feedback. Activity retains its management
page. Neither path creates a plugin-center canvas widget.

## Placement and deletion

`workbench/actions/open_plugin` creates or reuses an exact instance-and-surface
binding in one transaction in the existing Workbench database. It commits widget
geometry and plugin state together, then publishes a complete layout event.
Concurrent or repeated placement requests reuse the existing widget and preserve
its geometry. Metadata refresh updates only that binding. A delayed request
cannot reduce its saved management revision or substitute another surface.

A lost response triggers a read of the same target; finding the complete binding
confirms placement. Otherwise the UI retains explicit pending/failed placement
with retry and dismissal. Retry submits the same target. A subsequent SDK load
failure does not roll back a saved component; the original card offers Retry.

`workbench/actions/remove_plugin` removes all saved widgets of one exact plugin
instance, with their states, in one layout transaction. It is idempotent and emits
the normal layout event for other windows. The Shell invokes this only after
uninstall is confirmed by current Host inventory; it works without a mounted
Workbench page. A failed or unknown uninstall retains layout. Keep plugin data
still removes canvas components; the confirmation explains this and shows the
current affected count when the layout read succeeds. A failure in product
cleanup stays retryable as reconciliation and never replays uninstall.

## Runtime replacement

Product containers retain their identity while SDK leases are retired. During a
management command, existing content is hidden and inert under a progress notice;
no new lease opens from a background inventory update while submission is pending.
Committed and unknown platform outcomes first invalidate the local slot registry
without calling close after SDK revocation. Inventory reconciliation then resolves
the original surface from all Host-verified view surfaces, including non-default
surfaces. A fresh slot is created at the current management revision and session.
Permission invalidation also renews slots when management revision is unchanged.

External updates that require pre-close await normal SDK close of all affected
slots before submitting. A close failure blocks update and preserves containers.
Not-committed failures may restore the old authoritative target. Committed errors
refresh current authority; unknown outcomes remain unavailable until their result
is proved. Recovery actions re-read the result rather than resubmitting mutations.
Transient presentation and lease generation are process-local, not a second
persistent plugin lifecycle model.

Cards distinguish disabled, required permission, missing original surface,
inventory failure, unknown outcome, loading, and runtime failure. They expose only
currently authorized Enable, Manage permissions, Retry, or Details actions.
Technical errors are collapsed. Missing surfaces are never silently replaced by
the new default. Disconnect follows the Shell's unified reconnect screen; the
same layout resumes after authenticated session and inventory recovery.

## Layout failures and concurrent windows

An initial layout read failure keeps the canvas unready and autosave disabled,
with explicit Retry. Saving fails visibly while retaining local changes. Revision
conflicts fetch current authority and merge local field edits relative to the
submitted base; they do not overwrite the complete remote layout. Remote removal
wins over local editing, local removal remains a removal, and unrelated remote
changes survive. Retry saves against the newly read revision. A response from an
old environment or disposed layout owner cannot modify the new canvas.

# Boundaries

Redeven layout operations never grant plugin authority or inspect platform stores.
The released SDK owns slots, bridge messages, revocation, and exact-close recovery.
Layout retention does not reconstruct historically deleted placements or plugin
memory that was never saved by the plugin itself.

# Evidence

- `redeven:internal/workbenchlayout/plugin_widgets.go:1` - Atomic placement, exact-instance removal, and layout event publication.
- `redeven:internal/workbenchlayout/plugin_widgets_test.go:1` - Idempotency, concurrency, rollback, metadata, and geometry preservation.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:1` - Read/save recovery, explicit placement, and in-place binding refresh.
- `redeven:internal/envapp/ui_src/src/ui/workbench/workbenchLayoutMerge.test.ts:1` - Concurrent field merge and remote-removal protection.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginSurfaceContainer.test.tsx:1` - Stable containers across lease and permission transitions.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx:1` - Mode independence and confirmed-uninstall reconciliation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx:1` - Browser modal geometry, retained state, keyboard, focus, and reduced motion.
