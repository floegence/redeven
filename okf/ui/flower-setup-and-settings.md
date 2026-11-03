---
type: UI Contract
title: Flower setup and settings
tags: [ai, flower, settings, onboarding]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Shared setup/settings serve both Flower carriers. Unconfigured profiles offer setup; configured new chats offer editable starters without launching. Retained modal preserves saves/errors and makes covered chat inert without read acknowledgement; existing model/permission/recovery owns policy.

# Contract

## First-time setup
Welcome setup requires no selected thread, configured provider or usable model, and absent/`not_configured`/`empty` Desktop source. Desktop `local_host` opens the current surface's settings, never another Welcome window or a remote destination. Artwork has no glow or continuous animation.

## Starter tasks
Four editable drafts cover current-folder understanding, connected computer, installed applications and folder organization. Names/dates alone never justify deletion. The [companion](flower-activity-companion.md) omits the grid.

## Settings composition
Settings edit the environment profile even with a Desktop model source. Flat sections preserve identity/drafts. Immediate switches block duplicate edits and roll back on failure.

## Provider configuration
[Provider configuration](flower-provider-configuration.md) owns authentication, layout and connection-before-model sequencing.

## Retained panels
FlowerSurface retains chat/extensions and a lazily loaded settings form in a bounded scrollable modal. Covered chat/navigation remain inert through close and do not acknowledge reads. Settings interactions belong to the companion: dialog close keeps it expanded; host collapse closes both while retaining form/progress/errors.

## Saving and ownership
Independent adapter operations save permission, model profile and default model. Permission uses a serialized 700 ms coalescing controller, fences older responses and restores the last confirmed value on failure. Computer-use failures restore the confirmed switch and expose errors.

# Boundaries

Starter-task selection creates an editable draft, never a turn.

Permission descriptions sit outside the single-line selection buttons and are linked through accessible descriptions; arrow-key selection and autosave retain their existing owner.

# Evidence

- `redeven:internal/flower_ui/src/i18n/flowerSurfaceMessages.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.starterTasks.browser.test.tsx` - Tests.
