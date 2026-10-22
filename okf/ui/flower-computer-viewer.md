---
type: Architecture Contract
title: Flower computer viewer presentation
description: Present decoded computer frames with shared window geometry, accessible status and explicit recovery.
tags: [ui, flower, computer-use, media]
timestamp: 2026-09-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe owns Stage window geometry and launcher interaction; Flower owns
canonical visual status and presentation scope. Users can view decoded pixels,
move or restore the Stage, and retain geometry across visibility changes. Opening
and closing affect viewing only, never target or execution authority. Missing,
interrupted or private frames retain explicit recovery and cannot borrow an
unrelated public image. Media authorization and sampling remain with the
[Computer use media contract](../ai/computer-use-media.md).

# Contract

The Stage uses the published Floe `FloatingWindow` for its title bar, drag, resize, maximize, and close controls. Screenshots use the entire content box with proportional, centered fit; non-live notices never share or reduce the image's horizontal space.

Later actions cannot reopen an explicitly hidden viewer.

# Boundaries

The viewer cannot authorize actions or own execution lifecycle. Published Floe remains the only geometry, focus and gesture owner; product status comes from matching canonical thread/run facts.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerStage.window.browser.test.tsx` - real published Floe window and launcher interaction, geometry retention, status, and safe boundaries.

- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - decoded Blob URL viewing.
