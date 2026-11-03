---
type: Desktop Contract
title: Desktop environment settings presentation
tags: [desktop, settings, interaction, themes]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop composes Floe dialogs/tabs/controls into one bounded settings surface. Theme tokens own material, product CSS grouping/geometry. Every page retains readable labels, reachable actions and draft ownership through loading/errors/disclosure. Settings sessions retain authority and persistence without styling state.

# Contract

- The panel is at most 50rem wide and 44.375rem high, capped by viewport/titlebar. Only viewport resizing changes that cap; tabs, loading and disclosures never recenter it or move actions.
- Use one Current connection card and consistent address reading edges. Text, diagnostics, paths and addresses remain selectable and wrap.
- Browser scope, sign-in protection and certificate tasks use matching rows, meaningful icons and published outline controls. Preserve their borders, hover/focus states and specialized QR/recovery-code geometry. Removal drafts never appear already committed.
- Separate footer feedback from actions; review never shows passwords. Floe owns focus trapping, nested Escape, restoration, variants and forced colors.
- SSH destination fields fill the same control column as adjacent fields in creation and settings. Loading and cached-host failure feedback occupies the field's trailing inset, preserving width, draft and focus; an idle indicator never consumes an external column or intercepts input clicks.
- Access configuration steps place equal flexible connectors directly after each non-final label. Narrow layouts stack aligned step badges without horizontal connectors.
- Floe owns modal presence and the 200ms tab underline; retained exit never blanks the closing panel. [Interaction continuity](desktop-interaction-continuity.md) owns invalidation, drafts and stale responses.

# Boundaries

Presentation adds no modal, focus manager, persistence or lifecycle owner.

# Evidence

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.css` - Source.
- `redeven:desktop/src/welcome/EnvironmentAccessWorkflow.css` - Source.
- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.tsx` - Source.
- `redeven:desktop/src/welcome/SSHDestinationCombobox.tsx` - Source.
- `redeven:desktop/scripts/check-welcome-form-alignment.mjs` - Tests.
