---
type: UI Contract
title: Shared surface material
tags: [ui, desktop, flower, themes, performance]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Published Floe owns material and motion. Env App/Welcome select soft-neumorphic roles while business content stays flat. Preserve input, portals, widget identity and hot interaction ownership. Resolve conflicts at the product override source without copying shadow logic or introducing another theme/dependency owner.

# Contract

## Configuration and ownership
Both first-party renderers set `theme.defaultSurfaceStyle` to `soft-neumorphic`. The [published dependency contract](../architecture/env-app-upstream-web-dependencies.md) owns exact package versions and registry requirements.

## Product presentation
Ordinary shared Buttons, Cards, Radio, Checkbox, Switch, Tabs, progress controls, Dialogs, and FloatingWindows use their released component treatment. Hover must preserve the selected fill and text.

The plugin launcher keeps its existing action and localized name; artwork owns no input or navigation behavior.

# Boundaries

Use restrained static depth and short functional control motion. The progress disclosure remains clickable; failure and confirmation use static attention. Existing Workbench activation, wheel, text-selection, and preview/commit contracts remain authoritative.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - Source.
