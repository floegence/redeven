---
type: Architecture Contract
title: Flower computer viewer presentation
tags: [ui, flower, computer-use, media]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floe owns Stage geometry/launcher; Flower projects canonical status and decoded media. Viewing, moving, closing or restoring grants no target/execution authority. Interrupted/private frames retain recovery and cannot borrow unrelated images. The media contract remains the sole authorization/sampling owner.

# Contract

The Stage uses the published Floe `FloatingWindow` for its title bar, drag, resize, maximize, and close controls. Screenshots use the entire content box with proportional, centered fit; non-live notices never share or reduce the image's horizontal space.

Later actions cannot reopen an explicitly hidden viewer.

# Boundaries

The viewer cannot authorize actions or own execution lifecycle. Published Floe remains the only geometry, focus and gesture owner; product status comes from matching canonical thread/run facts.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerStage.window.browser.test.tsx` - Tests.
- `redeven:internal/flower_ui/src/FlowerComputerStage.tsx` - Source.
