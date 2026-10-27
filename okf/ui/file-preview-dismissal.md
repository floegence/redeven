---
type: UI Contract
title: File preview dismissal
description: Retire a file preview without replacing its document during exit or delaying user actions.
tags: [ui, files, preview, lifecycle, motion]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The file-preview controller owns document state and immediate cancellation;
published Floe owns window and mobile dialog presence. Accepted close must keep
the live document and title unchanged throughout exit, then release all retained
content when the panel unmounts. It must not create a blank iframe, a brighter gray
intermediate surface, extra reads, or an additional close delay. Owner disposal
always releases resources, and stale asynchronous work cannot revive a closed
preview.

# Contract

## Accepted close and resource release
The global preview host binds its controller's content lifetime to the mounted preview panel. Closed previews cannot start edits, retries, or resource probes.

Rapid reopen uses the same presence owner, and an older presentation release cannot clear a currently open or retained preview.

## Responsiveness
Retention stores only a constant-size presentation token and existing references.

Pixel sampling of a bright HTML page fading onto a dark background must show no brightness rebound. These measurements qualify the tested browser fixture; they do not substitute for packaged Desktop release qualification.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns file actions and unsaved-change confirmation. Retaining controller content must not duplicate Floe's presence state or alter animation timing and styling.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/createFilePreviewController.ts` - Cancels work immediately and releases retained document resources at the presentation boundary.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Releases retained content when the published presence owner disposes the panel.
