---
type: UI Contract
title: Flower setup and settings
tags: [ai, flower, settings, onboarding]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Shared setup/settings serve both Flower carriers. The unconfigured surface is one open, canvas-level composition using published Floe ink and Button interaction, with no card, icon tile, heavy heading or filled call-to-action. It contains the Flower mark, setup title, one short explanation and the available settings destinations.

# Contract

## First-time setup
Welcome setup requires no selected thread, configured provider or usable model, and absent/`not_configured`/`empty` Desktop source. Desktop `local_host` opens the current surface's settings, never another Welcome window or a remote destination. Artwork has no glow or continuous animation.

Local setup has one text action; remote Desktop setup keeps distinct Desktop and environment text actions with concise localized labels. No model-sync control or starter-task previews appear before configuration. Existing settings updates restore the retained composer and draft when a model becomes usable; configured-model recovery remains in its existing settings/menu owner.

## Starter tasks
Four editable drafts cover current-folder understanding, connected computer, installed applications and folder organization. Names/dates alone never justify deletion. The [companion](flower-activity-companion.md#companion) omits the grid.

## Settings composition
Settings edit the environment profile even with a Desktop model source. Flat sections preserve identity/drafts. Immediate switches block duplicate edits and roll back on failure.

## Provider configuration
[Provider configuration](flower-provider-configuration.md#provider-configuration) owns authentication, layout and connection-before-model sequencing.

## Retained panels
Product settings commands enter the global [Settings host](runtime-settings.md#host-and-destinations), preserving Flower chat, composer, thread and extension owners. Standalone Flower retains its bounded fallback modal. Covered transcripts never acknowledge reads through modal exit. One canonical FlowerSettingsPanel/FlowerSettingsSurface owns provider/default edits; host adapters cannot duplicate its account or secret controller.

## Saving and ownership
Independent adapter operations save permission, model profile and default model. Permission uses a serialized 700 ms coalescing controller, fences older responses and restores the last confirmed value on failure. Computer-use failures restore the confirmed switch and expose errors.

# Boundaries

Starter-task selection creates an editable draft, never a turn.

Permission descriptions sit outside the single-line selection buttons and are linked through accessible descriptions; arrow-key selection and autosave retain their existing owner.

# Evidence

- `redeven:internal/flower_ui/src/i18n/flowerSurfaceMessages.ts` - Source.
- `redeven:internal/flower_ui/src/chat/FlowerSetupWelcome.tsx` - Shared setup composition.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.setupGuide.browser.test.tsx` - Settings routing and retained draft transition.
