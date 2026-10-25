---
type: Desktop Contract
title: Desktop environment settings presentation
description: Apply one theme-aware visual hierarchy, fixed window geometry and responsive controls across settings tasks.
tags: [desktop, settings, interaction, themes]
timestamp: 2026-10-12T06:30:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop composes published Floe Dialog, Tabs, controls and presence into one Environment settings surface. Theme tokens own material and contrast; product CSS owns grouping and geometry. Every page preserves readable labels, reachable actions and a fixed viewport. Loading, failure and disclosures retain the draft owner. [Settings sessions](desktop-environment-settings.md) own authority, persistence and recovery; styling adds no operation state.

# Contract

- The panel is at most 50rem wide and 44.375rem high, capped by viewport/titlebar. Only viewport resizing changes that cap; tabs, loading and disclosures never recenter it or move actions.
- Use one Current connection card and consistent address reading edges. Text, diagnostics, paths and addresses remain selectable and wrap.
- Browser scope, sign-in protection and certificate tasks use matching rows, meaningful icons and published outline controls. Preserve their borders, hover/focus states and specialized QR/recovery-code geometry. Removal drafts never appear already committed.
- Separate footer feedback from actions; review never shows passwords. Floe owns focus trapping, nested Escape, restoration, variants and forced colors.
- Floe owns modal presence and the 200ms tab underline; retained exit never blanks the closing panel. [Interaction continuity](desktop-interaction-continuity.md) owns invalidation, drafts and stale responses.

# Boundaries

Presentation adds no modal, focus manager, persistence or lifecycle owner.

# Evidence

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.css` - Shared theme material, fields, target sizes and responsive geometry.

- `redeven:desktop/src/welcome/EnvironmentAccessWorkflow.css` - Connection grouping, access tasks, password and workflow hierarchy.

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.tsx` - Released Dialog, retained panels and fixed scrolling/actions.
