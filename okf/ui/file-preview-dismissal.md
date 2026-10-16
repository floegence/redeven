---
type: UI Contract
title: File preview dismissal
description: Retire a file preview without replacing its document during exit or delaying user actions.
tags: [ui, files, preview, lifecycle, motion]
timestamp: 2026-10-16T00:00:00Z
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

The global preview host binds its controller's content lifetime to the mounted
preview panel. Accepted close immediately publishes the closed state, cancels
pending connection work and active reads, and invalidates asynchronous loads and
saves. It does not clear the live document, title, draft, bytes, or object URL
while that panel remains present for Floe's exit animation. Dirty-close
confirmation retains its existing authority; confirmed discard closes the
confirmation and preview together without switching the exiting editor back to
a read-only renderer. Closed previews cannot start edits, retries, or resource
probes.

Floe remains the only presence and animation owner, including reduced motion and
mobile dialogs. Panel disposal releases its presentation token; the closed
controller then clears document data and revokes its object URL. A controller
without a mounted presentation still cleans up synchronously. Controller disposal
always releases resources. Rapid reopen uses the same presence owner, and an
older presentation release cannot clear a currently open or retained preview.

## Responsiveness

Retention stores only a constant-size presentation token and existing references.
It adds no timer, polling, snapshot, duplicated document, extra read, or close
delay. Five-cycle browser coverage verifies immediate underlying-page actions,
close handling and exit frame intervals below 50ms, and empty controller data
after each exit. Image URLs are revoked only after presentation release; reads
are cancelled immediately and post-read work rechecks the request generation.

The HTML regression checks original iframe identity, source and title on every
exit frame in light/dark themes and normal/reduced motion. Pixel sampling of a
bright HTML page fading onto a dark background must show no brightness rebound.
These measurements qualify the tested browser fixture; they do not substitute
for packaged Desktop release qualification.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns file actions and
unsaved-change confirmation. The [viewport contract](file-preview-viewport-and-rendering.md)
owns renderer geometry and asynchronous rendering. Retaining controller content
must not duplicate Floe's presence state or alter animation timing and styling.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/createFilePreviewController.ts` - Cancels work immediately and releases retained document resources at the presentation boundary.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewHost.tsx` - Binds the global controller to the mounted preview surface.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Releases retained content when the published presence owner disposes the panel.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewHost.dismissal.browser.test.tsx` - Verifies live document continuity, pixel brightness, response time, mobile exit and rapid reopen.
- `redeven:internal/envapp/ui_src/src/ui/widgets/createFilePreviewController.test.ts` - Verifies cancellation, dirty confirmation, URL release, stale work and owner disposal.
