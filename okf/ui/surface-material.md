---
type: UI Contract
title: Shared surface material
description: Apply Floe's lightweight material to Redeven controls, product boundaries, and floating surfaces without duplicating decoration or input ownership.
tags: [ui, desktop, flower, themes, performance]
timestamp: 2026-09-15T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floe Webapp owns shared material and control motion. Redeven selects
`soft-neumorphic` in Env App and Desktop Welcome, maps product boundaries to the
released surface roles, and keeps business content flat. Native input, local
portals, widget identity, and hot interaction ownership do not change. A visual
conflict is resolved by removing the product override at its source; there is
no copied shadow engine, local dependency overlay, or second theme owner.

# Contract

## Configuration and ownership
Both first-party renderers set `theme.defaultSurfaceStyle` to `soft-neumorphic`. The [published dependency contract](../architecture/env-app-upstream-web-dependencies.md) owns exact package versions and registry requirements.

## Product presentation
Ordinary shared Buttons, Cards, Radio, Checkbox, Switch, Tabs, progress controls, Dialogs, and FloatingWindows use their released component treatment. Hover must preserve the selected fill and text.

The plugin launcher keeps its existing action and localized name; artwork owns no input or navigation behavior.

# Boundaries

Use restrained static depth and short functional control motion. The progress disclosure remains clickable; failure and confirmation use static attention. Existing Workbench activation, wheel, text-selection, and preview/commit contracts remain authoritative.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Env App material configuration.

- `redeven:desktop/src/welcome/App.tsx` - Welcome configuration and floating toast boundary.

- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - Opaque product surfaces and independent control boundary mapping.
