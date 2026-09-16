---
type: UI Contract
title: Shared surface material
description: Apply Floe's lightweight material to Redeven controls, product boundaries, and floating surfaces without duplicating decoration or input ownership.
tags: [ui, desktop, flower, themes, performance]
timestamp: 2026-09-15T00:00:00Z
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

Both first-party renderers set `theme.defaultSurfaceStyle` to
`soft-neumorphic`. Floe ThemeContext and its existing persistence adapter own
the effective material and root attribute. The Desktop main-process source and
per-mode preset snapshot remain the authority for palette selection. Material
does not introduce IPC, a competing persisted palette, or a remount boundary.
The [published dependency contract](../architecture/env-app-upstream-web-dependencies.md)
owns exact package versions and registry requirements.

## Product presentation

Ordinary shared Buttons, Cards, Radio, Checkbox, Switch, Tabs, progress controls,
Dialogs, and FloatingWindows use their released component treatment. Product
neutral panel and divider roles mix 11.5% and 8.5% foreground into their
opaque owning surface. Control boundaries use the independent input role and
focus uses the ring role; input fill mixes background and card equally.
Semantic status hues and selected text remain explicit. Selected product segments, Desktop library filters, and
appearance choices change their fill immediately without an additional contour.
High Contrast Light and forced colors retain their explicit boundaries.

Files toolbars reserve the strong input boundary for filtering or active path
editing. Read-mode breadcrumbs and ordinary actions have no input frame. The
Files/Git rail and its moving selection face use shared flat fills without a
second border, inset highlight, or contact shadow. The actual controls, path
draft, filter, selection and focus owners stay mounted during palette changes.
Porcelain Light's folder and file-type paints preserve the original Classic
Light colors through Floe's independent file-icon roles; status text contrast
changes must not desaturate those identification paints.

Viewport-filling Plugin update reviews use opacity-only entry/exit at mobile
widths through Floe's offset tokens, so footer actions remain inside the viewport
even during intermediate frames. Shared presence still owns exit disposal.

Desktop environment cards retain layout, actions, and featured/open status
fills. Their existing perimeter remains opaque through the shared Card material
cascade. Light themes use a neutral foreground blend against the page to keep
each card distinct, including open cards and warmer canvases. This one outline
replaces the inset highlight; the shared raised-shadow override suppresses extra
relief. They do not add translating card hover, animated shadows, or a second
outer frame. Dialog decoration belongs to Floe; Desktop only adapts titlebar
safe area, dimensions, and content layout. Anchored Desktop overlays, toasts,
the Env App appearance picker, scoped WindowModal panels, and Flower command
and subagent menus declare `data-floe-surface="floating"` on the existing
visible boundary. Their product geometry and portal owners remain unchanged.
Large backdrop blur and copied window perimeter shadows are removed.

Flower's expanded composer declares one `inset` input boundary. A collapsed
companion stays `flat` and retains its existing ownership of the collapsed
outline. The [input focus contract](input-focus-boundaries.md) continues to
require border-color-only focus with stable geometry and decoration. Debug
Console settings consume the native shared Switch instead of a product knob.

Flower's empty-state suggestions use the available panel width to choose one
or two columns. A narrow Workbench widget retains readable text even when the
outer browser viewport is wide; this changes neither widget geometry nor
navigation state. Empty welcome content keeps its reading position; automatic
tail following requires messages, live progress, or pending submissions.

Env App's bottom Activity Bar utilities use 18px monochrome line art: an
interlocking chain for switching environments and three outlined sliders for
Runtime Settings. Rounded strokes inherit the Activity Bar foreground token.
The published buttons retain their full hit area, hover and keyboard-focus
treatment, localized names, and existing navigation actions; decorative icons
never own input or Desktop bridge availability.

The Containers Workbench identity uses three rounded isometric modules with
fixed cyan-blue facets on the standard 48-unit Dock tile. Its rounded base
derives from the active card token, while neutral highlights use the shared
lighting token. The source color guard admits only the three authored facet
colors in SVG paint attributes. The artwork is decorative; the existing Dock
control owns the localized accessible name and all activation behavior.

Web Services, Composition Mode, and the plugin launcher share a restrained
blue-gray identity: a network globe, a nearly frontal partitioned artboard,
and nine application cards. Their 48-unit rounded tiles derive from the active
card token. Authored light/dark SVG paints follow the shell color scheme, with
narrow gradients and shallow static shadows instead of thick sides or strong
highlights. Every rendered instance owns unique gradient and clipping IDs.
Composition artwork enters the published `WorkbenchSurface.dockModeIcons`
contract, so the mode trigger and menu share one product icon. The plugin
launcher keeps its existing action and localized name; artwork owns no input
or navigation behavior.

# Boundaries

Use restrained static depth and short functional control motion. Ordinary hover
feedback takes 120ms, content changes 180ms, floating entry 220ms with at most
6px travel, and floating exit 160ms. Theme colors update immediately. The
existing 90/100/140ms selection-control motion and reversible 360ms Flower
companion geometry keep their component owners. Reduced motion enters the
final state while preserving status and completion feedback. Brand icons,
ordinary status text, cards, and action buttons have no breathing, sweep, or
colored halo. Only genuine progress may animate a small local symbol. Do not animate
container shadows, add pointer-following decoration, or promote entire reading
subtrees into compositor layers. Dense prose, files, terminal output, and editor
content remain flat; material is never injected into third-party frames or
Monaco/terminal internals. Floe owns floating entry/exit timing and local hot
shadows. Existing Workbench activation, wheel, text-selection, and preview/commit
contracts remain authoritative.

# Verification

The source guard checks the production opt-in, removed decoration overrides,
and shared Switch boundary. Browser coverage exercises the published package
with real product styles, light/dark controls and dialogs, unchanged draft
selection and focus geometry, and the 26-preset settings hierarchy in both
materials. Relevant Flower, terminal, and Workbench tests validate existing
interaction ownership. Screenshots supplement computed behavior; the upstream
component gallery alone is not downstream acceptance evidence.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/App.tsx` - Env App material configuration.
- `redeven:desktop/src/welcome/App.tsx` - Welcome configuration and floating toast boundary.
- `redeven:internal/envapp/ui_src/src/styles/redeven.css` - Opaque product surfaces and independent control boundary mapping.
- `redeven:internal/envapp/ui_src/src/ui/icons/ActivityBarDockIcons.tsx` - Theme-inheriting bottom utility artwork.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Runtime Settings and Desktop environment-switch entry points.
- `redeven:internal/envapp/ui_src/src/ui/icons/ContainersIcon.tsx` - Containers artwork and theme-derived Dock tile.
- `redeven:internal/envapp/ui_src/src/ui/icons/WorkbenchSoftIcons.tsx` - Shared shallow-depth artwork for Web Services, Composition Mode, and the plugin launcher.
- `redeven:internal/envapp/ui_src/src/ui/workbench/surface/RedevenWorkbenchSurface.tsx` - Published mode artwork integration.
- `redeven:internal/envapp/ui_src/scripts/checkThemeColorSources.mjs` - Bounded authored-palette exception.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Composer and floating menu roles.
- `redeven:scripts/check_soft_surface_integration.test.mjs` - Shared ownership guard.
- `redeven:internal/envapp/ui_src/src/styles/softSurfacesVisual.browser.test.tsx` - Real control and scoped overlay checks.
- `redeven:internal/envapp/ui_src/src/styles/settingsThemeHierarchyVisual.browser.test.tsx` - Full preset hierarchy coverage.
- `redeven:desktop/scripts/check-welcome-cards.mjs` - Checks actual published Cards with Welcome CSS across every theme and material, including open and new states.
