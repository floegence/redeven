---
type: UI Contract
title: File preview dismissal
tags: [ui, files, preview, lifecycle, motion]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

The preview owner cancels reads immediately; Floe owns exit presence. Accepted close retains document/title through motion and releases resources at unmount, without blank iframes, brighter intermediate surfaces, extra reads or delays. Disposal always cleans up and late responses cannot revive closed content.

# Contract

## Accepted close and resource release
The global preview host binds each document controller's content lifetime to its retained panel. Switching tabs never closes the controller; accepted tab close retires only that document, while window close retains all presentation resources through the shared exit. Closed previews cannot start edits, retries, or resource probes.

Rapid reopen uses the same presence owner, and an older presentation release cannot clear a currently open or retained preview.

## Responsiveness
Retention stores only a constant-size presentation token and existing references.

Pixel sampling of a bright HTML page fading onto a dark background must show no brightness rebound. These measurements qualify the tested browser fixture; they do not substitute for packaged Desktop release qualification.

# Boundaries

The [window actions contract](file-preview-window-actions.md) owns file actions and unsaved-change confirmation. Retaining controller content must not duplicate Floe's presence state or alter animation timing and styling.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/createFilePreviewController.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Source.
