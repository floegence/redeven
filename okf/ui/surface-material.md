---
type: UI Contract
title: Shared surface material
tags: [ui, desktop, flower, themes, performance]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Published Floe owns material and motion. Env App/Welcome select soft-neumorphic roles while business content stays flat. Preserve input, portals, widget identity and hot interaction ownership. Resolve conflicts at the product override source without copying shadow logic or introducing another theme/dependency owner.

# Contract

## Configuration and ownership
Both first-party renderers set `theme.defaultSurfaceStyle` to `soft-neumorphic`. The [published dependency contract](../architecture/env-app-upstream-web-dependencies.md) owns exact package versions and registry requirements.

## Activity icon states
Published Floe owns the 24-unit rounded rail family, 1.5-unit strokes, 13% idle faces and filled selected silhouettes. Desktop Activity Bar and mobile tabs pass their real active or expanded state; hover changes ink without selecting. Monitoring remains a rounded pulse with a soft area and Switch Environment keeps slender opposing arrows. Web Services remains a globe. Plugin launcher disclosure fills while open without changing the selected page; environment switching is momentary.

Redeven's adapters consume the published icons subpath. Flower reuses the product's canonical five-petal artwork: each petal meets beneath the yellow center. Its navigation variant follows the host's size and active state, with outlined idle petals and selected ink-filled petals separated by visible surface-colored seams. Geometry remains stable through selection; ordinary brand and Workbench artwork retain their existing treatment. Shared icon detail masks reveal each theme's actual surface, and forced colors use system navigation ink. Verify live selection, disclosure, mobile editor retention, petal-seam contrast and icon contrast; never replace these with static SVG-only checks.

## Product presentation
Ordinary shared Buttons, Cards, Radio, Checkbox, Switch, Tabs, progress controls, Dialogs, and FloatingWindows use their released component treatment. Hover must preserve the selected fill and text.

The plugin launcher keeps its existing action and localized name; artwork owns no input or navigation behavior.

# Boundaries

Use restrained static depth and short functional control motion. The progress disclosure remains clickable; failure and confirmation use static attention. Existing Workbench activation, wheel, text-selection, and preview/commit contracts remain authoritative.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - Source.

- `redeven:internal/envapp/ui_src/src/ui/icons/ActivityBarDockIcons.tsx` - Source.
